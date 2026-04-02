import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAccounts, getAccount } from "./accounts.js";
import { searchEmails, readEmail } from "./imap-client.js";
import { parseDoeEmail, isDoeEmail, extractIdCardFromRecipient } from "./doe-parser.js";
import { parseFutureSkyEmail, isFutureSkyEmail } from "./futuresky-parser.js";
import { getLastSyncedDate, upsertDoeEmails } from "./supabase.js";
import type { AccountConfig } from "./types.js";
import type { DoeEmailRow } from "./supabase.js";

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }) }],
    isError: true,
  };
}

function jsonResponse(data: any) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function resolveAccounts(accountId?: string): AccountConfig[] {
  if (accountId) {
    const acc = getAccount(accountId);
    return acc ? [acc] : [];
  }
  return getAccounts();
}

export function registerTools(server: McpServer) {
  // --- list_accounts ---
  server.tool(
    "list_accounts",
    "ดูบัญชีอีเมลที่เชื่อมต่ออยู่",
    {},
    async () => {
      const accounts = getAccounts();
      return jsonResponse({
        success: true,
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
        })),
      });
    }
  );

  // --- search_emails ---
  server.tool(
    "search_emails",
    "ค้นหาอีเมล — รองรับหลายบัญชี, กรองตาม keyword/ผู้ส่ง/วันที่/unread",
    {
      account: z.string().optional().describe("บัญชี: gmail, hostinger, smartlabour (ว่าง = ค้นทุกบัญชี)"),
      search: z.string().optional().describe("คำค้นหา"),
      from: z.string().optional().describe("กรองผู้ส่ง"),
      to: z.string().optional().describe("กรองผู้รับ"),
      subject: z.string().optional().describe("กรอง subject"),
      since: z.string().optional().describe("ตั้งแต่วันที่ (YYYY-MM-DD)"),
      before: z.string().optional().describe("ก่อนวันที่ (YYYY-MM-DD)"),
      unread_only: z.boolean().optional().default(false).describe("เฉพาะยังไม่ได้อ่าน"),
      folder: z.string().optional().default("INBOX").describe("โฟลเดอร์"),
      limit: z.number().optional().default(10).describe("จำนวน (default 10)"),
    },
    async ({ account, ...opts }) => {
      try {
        const accounts = resolveAccounts(account);
        if (accounts.length === 0) return errorResponse(`Account "${account}" not found`);

        const allMessages = [];
        for (const acc of accounts) {
          try {
            const msgs = await searchEmails(acc, opts);
            allMessages.push(...msgs);
          } catch (err: any) {
            allMessages.push({ account: acc.id, error: err.message });
          }
        }

        // Sort combined results newest first
        allMessages.sort((a: any, b: any) => {
          const da = a.date ? new Date(a.date).getTime() : 0;
          const db = b.date ? new Date(b.date).getTime() : 0;
          return db - da;
        });

        const limited = allMessages.slice(0, opts.limit || 10);
        return jsonResponse({ success: true, total: limited.length, messages: limited });
      } catch (err: any) {
        return errorResponse(err.message);
      }
    }
  );

  // --- read_email ---
  server.tool(
    "read_email",
    "อ่านเมลเต็มตาม UID",
    {
      account: z.string().describe("บัญชี: gmail, hostinger, smartlabour"),
      uid: z.number().describe("UID ของเมล"),
      folder: z.string().optional().default("INBOX"),
    },
    async ({ account, uid, folder }) => {
      try {
        const acc = getAccount(account);
        if (!acc) return errorResponse(`Account "${account}" not found`);
        const msg = await readEmail(acc, uid, folder);
        if (!msg) return errorResponse(`Email UID ${uid} not found`);
        return jsonResponse({ success: true, message: msg });
      } catch (err: any) {
        return errorResponse(err.message);
      }
    }
  );

  // --- doe_check_emails ---
  server.tool(
    "doe_check_emails",
    "ดึงเมลจาก DOE แล้ว parse อัตโนมัติ — ได้เลขคำขอ, ประเภท, นายจ้าง, สถานะ",
    {
      account: z.string().optional().describe("บัญชี (ว่าง = ค้นทุกบัญชี)"),
      limit: z.number().optional().default(20).describe("จำนวน (default 20)"),
      since: z.string().optional().describe("ตั้งแต่วันที่ (YYYY-MM-DD)"),
    },
    async ({ account, limit, since }) => {
      try {
        const accounts = resolveAccounts(account);
        if (accounts.length === 0) return errorResponse(`Account "${account}" not found`);

        const allParsed = [];
        for (const acc of accounts) {
          try {
            const msgs = await searchEmails(acc, {
              from: "doe.go.th",
              limit: limit || 20,
              since,
            });
            for (const msg of msgs) {
              if (isDoeEmail(msg)) {
                const parsed = parseDoeEmail(msg);
                allParsed.push({
                  account: acc.id,
                  uid: msg.uid,
                  date: msg.date,
                  subject: msg.subject,
                  ...parsed,
                });
              }
            }
          } catch (err: any) {
            allParsed.push({ account: acc.id, error: err.message });
          }
        }

        // Summary
        const types = allParsed.reduce((acc: any, e: any) => {
          if (e.type) acc[e.type] = (acc[e.type] || 0) + 1;
          return acc;
        }, {});

        return jsonResponse({
          success: true,
          total: allParsed.length,
          summary: types,
          emails: allParsed,
        });
      } catch (err: any) {
        return errorResponse(err.message);
      }
    }
  );

  // --- sync_doe_emails ---
  server.tool(
    "sync_doe_emails",
    "Sync เมล DOE + Future Sky จาก Hostinger IMAP → Supabase doe_emails table",
    {
      since: z.string().optional().describe("ตั้งแต่วันที่ (YYYY-MM-DD) — ว่าง = auto จาก last synced"),
      limit: z.number().optional().default(100).describe("จำนวนเมลสูงสุดต่อแหล่ง (default 100)"),
      full_sync: z.boolean().optional().default(false).describe("sync ทั้งหมด ไม่สนใจ last synced"),
    },
    async ({ since, limit, full_sync }) => {
      try {
        const acc = getAccount("hostinger");
        if (!acc) return errorResponse("Hostinger account not configured");

        // Determine since date
        let sinceDate = since;
        if (!sinceDate && !full_sync) {
          const lastDate = await getLastSyncedDate("hostinger");
          if (lastDate) {
            sinceDate = new Date(lastDate).toISOString().split("T")[0];
          }
        }

        const rows: Partial<DoeEmailRow>[] = [];
        const maxLimit = limit || 100;

        // Fetch DOE emails
        const doeMessages = await searchEmails(acc, {
          from: "doe.go.th",
          limit: maxLimit,
          since: sinceDate,
        });
        for (const msg of doeMessages) {
          if (!isDoeEmail(msg)) continue;
          const parsed = parseDoeEmail(msg);
          const idCard = extractIdCardFromRecipient(msg.to);
          rows.push({
            uid: msg.uid,
            account: "hostinger",
            date: msg.date,
            sender: msg.from,
            recipient: msg.to,
            subject: msg.subject,
            source: "doe",
            type: parsed?.type || "unknown",
            request_no: parsed?.request_no || "",
            employer: parsed?.employer || "",
            applicant: parsed?.applicant || "",
            reviewer: parsed?.reviewer || "",
            reviewed_date: parsed?.reviewed_date || "",
            body_snippet: msg.body.substring(0, 800),
            id_card: idCard || "",
            ticket_id: "",
          });
        }

        // Fetch Future Sky emails
        const fsMessages = await searchEmails(acc, {
          from: "futuresky",
          limit: maxLimit,
          since: sinceDate,
        });
        for (const msg of fsMessages) {
          if (!isFutureSkyEmail(msg)) continue;
          const parsed = parseFutureSkyEmail(msg);
          const idCard = extractIdCardFromRecipient(msg.to);
          rows.push({
            uid: msg.uid,
            account: "hostinger",
            date: msg.date,
            sender: msg.from,
            recipient: msg.to,
            subject: msg.subject,
            source: "futuresky",
            type: parsed.type,
            request_no: "",
            employer: "",
            applicant: "",
            reviewer: "",
            reviewed_date: "",
            body_snippet: msg.body.substring(0, 800),
            id_card: idCard || "",
            ticket_id: parsed.ticket_id,
          });
        }

        // Upsert to Supabase
        const upserted = await upsertDoeEmails(rows);

        // Summary by source and type
        const summary: Record<string, number> = {};
        for (const r of rows) {
          const key = `${r.source}:${r.type}`;
          summary[key] = (summary[key] || 0) + 1;
        }

        return jsonResponse({
          success: true,
          synced: upserted,
          doe: doeMessages.length,
          futuresky: fsMessages.length,
          since: sinceDate || "all",
          summary,
        });
      } catch (err: any) {
        return errorResponse(err.message);
      }
    }
  );
}