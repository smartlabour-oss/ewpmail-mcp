import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { registerTools } from "./tools.js";
import { extractAlienRef, extractTempPassword } from "./doe-parser.js";
import { fillEwpEmail } from "./supabase.js";

const PORT = parseInt(process.env.PORT || "3457");
const SERVER_NAME = "ewpmail-mcp";
const VERSION = "2.1.1";

// Shared secret ที่ Hostinger แนบมาทุก webhook (Authorization: Bearer <secret>)
// ตั้งใน Coolify env — ถ้าไม่ตั้ง จะรับแบบไม่ยืนยัน (ปลอดภัยน้อย ควรตั้งเสมอ)
const WEBHOOK_SECRET = process.env.EWPMAIL_WEBHOOK_SECRET || "";

const app = express();
app.use(express.json());

// CORS — required for Claude Code (VSCode) MCP session
app.use((req: Request, res: Response, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/** ดึงอีเมลออกจากฟิลด์ที่อาจเป็น string / {address} / array (Hostinger ส่ง to เป็น array of {address,name}) */
function pickAddress(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v.toLowerCase().trim();
  if (Array.isArray(v)) return pickAddress(v[0]);
  if (typeof v === "object" && "address" in (v as Record<string, unknown>))
    return String((v as { address: unknown }).address).toLowerCase().trim();
  return "";
}

// Session store
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  registerTools(server);
  return server;
}

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", server: SERVER_NAME, version: VERSION });
});

// Hostinger Agentic Mail webhook (event: message.received)
// เมลกรมส่งถึงบัญชี eWP ของคนงาน → เติม workers.ewp_email ให้อัตโนมัติ
// รองรับอีเมลบัญชี 3 รูปแบบ (เลข13 / RA / พาสปอร์ต) ที่เจอจากการกวาดกล่องเมล 2026-07-17
app.post("/webhook", async (req: Request, res: Response) => {
  // 1) กันของปลอม — Hostinger แนบ Authorization: Bearer <secret> มาทุกครั้ง
  if (WEBHOOK_SECRET) {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  } else {
    console.warn("[ewpmail] /webhook: EWPMAIL_WEBHOOK_SECRET ไม่ได้ตั้ง — รับแบบไม่ยืนยัน (ควรตั้ง)");
  }

  // 2) ตอบ 200 ทันที เพื่อไม่ให้ Hostinger retry — งานจริงทำหลังตอบ (service รันยาว ไม่ใช่ serverless)
  res.json({ ok: true });

  // 3) ประมวลผลนอก request cycle
  try {
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const msg = (payload.data ?? payload.message ?? payload) as Record<string, unknown>;
    const to = pickAddress(msg.to);
    const from = pickAddress(msg.from);
    const subject = String(msg.subject ?? "");

    if (!to || !from) {
      // ยังไม่รู้ทรง payload แน่ชัด — log โครงครั้งแรกไว้ปรับ (ไม่ log เนื้อหา/PII)
      console.log("[ewpmail] /webhook payload shape:", {
        payloadKeys: Object.keys(payload),
        msgKeys: Object.keys(msg),
      });
      return;
    }
    if (!from.includes("doe.go.th")) return; // เฉพาะเมลจากกรม

    const ref = extractAlienRef(to);
    if (!ref) {
      console.log("[ewpmail] /webhook: แกะคนงานจากผู้รับไม่ได้");
      return;
    }

    // เมล "ลงทะเบียนสำเร็จ" อาจมีรหัสในเนื้อ — เก็บถ้าจับได้ (best-effort)
    // Hostinger payload ใช้ field `plainBody` (≤200 ตัว) — fallback เผื่อ shape อื่น
    const password = subject.includes("ลงทะเบียน")
      ? extractTempPassword(String(msg.plainBody ?? msg.body ?? msg.text ?? ""))
      : null;

    const result = await fillEwpEmail(ref, to, password);
    console.log(
      `[ewpmail] /webhook fill: ${ref.column} → ${result.updated ? "FILLED" : result.reason ?? "skip"}${
        result.alien_id ? ` (${result.alien_id})` : ""
      }`,
    );
  } catch (e) {
    console.error("[ewpmail] /webhook error:", e instanceof Error ? e.message : e);
  }
});

// MCP HTTP transport
app.post("/mcp", async (req: Request, res: Response) => {
  // Fix Accept header for clients that don't send text/event-stream
  const rawAccept = req.headers.accept || "";
  if (!rawAccept.includes("text/event-stream")) {
    req.headers.accept = "application/json, text/event-stream";
    const idx = req.rawHeaders?.findIndex((h) => h.toLowerCase() === "accept");
    if (idx !== undefined && idx >= 0 && req.rawHeaders) {
      req.rawHeaders[idx + 1] = "application/json, text/event-stream";
    }
  }

  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });
      const server = createServer();

      // Guard against recursive close (SDK 1.29.0 bug)
      let closing = false;
      transport.onclose = () => {
        if (closing) return;
        closing = true;
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
        server.close().catch(() => {});
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      const sid = transport.sessionId;
      if (sid) sessions.set(sid, { transport, server });
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session" },
      id: null,
    });
  } catch (error: any) {
    console.error(`[${SERVER_NAME}] MCP error:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: error.message },
        id: null,
      });
    }
  }
});

// SSE not supported — return 405
app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).set("Allow", "POST, DELETE").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "SSE notifications not supported — use JSON response mode" },
    id: null,
  });
});

// Session cleanup
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
    sessions.delete(sessionId);
    return;
  }
  res.sendStatus(200);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[${SERVER_NAME}] HTTP mode — http://localhost:${PORT}/mcp`);
  console.log(`[${SERVER_NAME}] Health:    http://localhost:${PORT}/health`);
});
