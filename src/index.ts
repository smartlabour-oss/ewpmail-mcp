import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { registerTools } from "./tools.js";

const PORT = parseInt(process.env.PORT || "3457");
const SERVER_NAME = "ewpmail-mcp";
const VERSION = "2.1.1";

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
