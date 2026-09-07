import { timingSafeEqual } from "node:crypto";

/**
 * ด่านตรวจ token ของ /mcp
 *
 * ทำไมต้องมี: ตรวจ 2026-09-07 — POST /mcp รับ initialize + tools/list จากใครก็ได้บนอินเทอร์เน็ต
 * (ทั้งผ่านโดเมนและ http://<ip>:3457) โดยไม่มี auth · tools read_email / search_emails คืนเนื้อเมล
 * ทั้งฉบับ = ใครก็อ่านลิงก์รีเซ็ตรหัสผ่านของกรม (ไม่หมดอายุ) ได้ทุกบัญชีคนงาน
 *
 * กติกา:
 *  - ต้องมี `Authorization: Bearer <EWPMAIL_MCP_TOKEN>` ทุก request ที่ /mcp (POST/GET/DELETE)
 *  - เทียบแบบ constant-time — ความยาวไม่เท่าถือว่าไม่ตรง ไม่โยน
 *  - fail-closed: ถ้า env ไม่ได้ตั้ง = ปิด /mcp ทั้งเส้น (503) ไม่ใช่เปิดโล่งแบบเดิม
 *    ต่างจาก /webhook และ /reset-link ที่ยอมรับแบบไม่ยืนยันเมื่อ secret ว่าง — บทเรียนคือ
 *    "ไม่ตั้ง env แล้วเปิดโล่ง" เงียบมาเป็นเดือน ไม่มีใครเห็น
 */

export type McpAuthVerdict = "ok" | "unauthorized" | "disabled";

/** ดึง token จาก header Authorization: Bearer <token> · ไม่ใช่รูปแบบนี้ → "" */
export function bearerFrom(authorization: string | string[] | undefined): string {
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  const s = String(raw || "");
  return s.startsWith("Bearer ") ? s.slice(7).trim() : "";
}

/** เทียบ token แบบ constant-time · expected ว่าง = ด่านปิด (disabled) */
export function checkMcpToken(presented: string, expected: string): McpAuthVerdict {
  if (!expected) return "disabled";
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return "unauthorized";
  return timingSafeEqual(a, b) ? "ok" : "unauthorized";
}
