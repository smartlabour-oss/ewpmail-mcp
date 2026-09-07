/**
 * ตัดชิ้นส่วน "ลิงก์รีเซ็ตรหัสผ่าน" ออกจากเนื้อเมลก่อนเขียนลง doe_emails.body_snippet
 *
 * ทำไม: เมลรีเซ็ตของกรมพกลิงก์ SendGrid (/ls/click → eworkpermit.doe.go.th/login/resetpassword
 * ?user_id=..&ref_id=..) ที่ไม่หมดอายุ — ทดสอบ 2026-08-28 ลิงก์อายุ 5 สัปดาห์ยังเปิดฟอร์มตั้งรหัสใหม่ได้
 * ทุกฉบับที่ sync เข้าตารางจึงพกกุญแจเปลี่ยนรหัสบัญชีคนงานติดมาด้วย (สะสม 500+ แถวก่อนแก้)
 * (รายงาน docs/2026-08-28-reset-link-exposure-report.md ข้อ 3.5 — "ล้างของเก่าอย่างเดียว พรุ่งนี้สะสมใหม่")
 *
 * ขอบเขตที่ตั้งใจ (แคบกว่าตัวตัดฝั่งเว็บแอปที่ตัดทุก URL):
 *  - ตัดเฉพาะชิ้นส่วนที่ประกอบกลับเป็นลิงก์รีเซ็ตได้: โดเมน sendgrid, path ls/click และ pixel wf/open,
 *    resetpassword, พารามิเตอร์ user_id / ref_id / upn · ลิงก์หน้าพอร์ทัลและข้อความอื่นคงเดิม —
 *    เพราะที่นี่คือ "ต้นทาง" ของข้อมูล ตัดแล้วไม่มีทางกู้คืน จึงตัดให้น้อยที่สุดที่ปิดความเสี่ยงได้
 *  - ตัดทั้งก้อนที่ติดกันเป็นอักขระ URL (ไม่ใช่ \S) — อักษรไทยที่เขียนติด URL ต้องไม่ถูกกินไปด้วย
 *  - ตัด "ก่อน" หั่นความยาว — ถ้าหั่นก่อน ลิงก์ที่ถูกหั่นครึ่งจะเหลือชิ้นส่วนที่ regex จับไม่ครบ
 *
 * ผู้อ่าน body_snippet ที่ต้องไม่กระทบ (ตรวจ 2026-09-07):
 *  - doe-bridge src/ewp-register/otp.ts อ่านเลข OTP + คำว่า "ลงทะเบียนสำเร็จ" — ไม่ใช่ URL
 *  - ท่อ reset (reset-link.ts / batch_reset_worker.py) อ่านลิงก์จาก IMAP ตรง ไม่ผ่านตารางนี้
 *  - v_doe_mail_watch (Telegram) กรอง type 5 แบบ ไม่มีเมลรีเซ็ต
 *
 * regex ตัวเดียวกันนี้ใช้ล้างแถวเก่าใน DB ด้วย (regexp_replace ใน Postgres) — แก้ที่นี่ต้องแก้ที่นั่น
 */

/** ข้อความแทนลิงก์ — ให้คนอ่านรู้ว่า "ตรงนี้เคยมีลิงก์" ไม่ใช่เนื้อเมลหาย */
export const LINK_REMOVED = "[ลิงก์ถูกลบ]";

/** อักขระที่ URL ใช้ได้ (RFC 3986) — ตั้งใจไม่รวมอักษรไทย/ช่องว่าง/วงเล็บปิด/quote */
const URL_CHARS = "[A-Za-z0-9\\-._~:/?#@!$&*+,;=%'\\[\\]]";

/** ก้อนอักขระ URL ที่มีชิ้นส่วนลิงก์รีเซ็ตอยู่ข้างใน — ตัดทั้งก้อน */
const RESET_LINK_RE = new RegExp(
  `${URL_CHARS}*(?:sendgrid|ls/click|wf/open|resetpassword|ref_id=|user_id=|upn=)${URL_CHARS}*`,
  "gi",
);

/** ป้ายซ้อนกันติด ๆ (pixel ต่อจากปุ่ม) ยุบเหลือป้ายเดียว — ช่องว่างหลังป้ายสุดท้ายต้องคงอยู่ */
const LINK_REMOVED_RE = LINK_REMOVED.replace(/[[\]]/g, "\\$&");
const DUP_RE = new RegExp(`${LINK_REMOVED_RE}(?:\\s*${LINK_REMOVED_RE})+`, "g");

/** คืนข้อความที่ไม่มีชิ้นส่วนลิงก์รีเซ็ตเหลืออยู่ · ข้อความอื่นคงเดิมทุกตัวอักษร */
export function stripResetLinks(text: string): string {
  if (!text) return text;
  return text.replace(RESET_LINK_RE, LINK_REMOVED).replace(DUP_RE, LINK_REMOVED);
}

/**
 * เนื้อเมลที่พร้อมเขียนลง body_snippet: ตัดลิงก์รีเซ็ตก่อน แล้วค่อยหั่นความยาว
 * (ทางเข้าทุกทางของ doe_emails ต้องผ่านตัวนี้ — rest-sync และ MCP sync tools)
 */
export function snippetForDb(text: string, maxLen: number): string {
  return stripResetLinks(text ?? "").slice(0, maxLen);
}

/** ใช้ในเทสต์: ยังมีร่องรอยลิงก์รีเซ็ตไหม — เข้มกว่าตัวตัด (จับคำโดด ๆ ด้วย) ให้เทสต์ล้มก่อนของจริงหลุด */
export function hasResetLinkTrace(text: string): boolean {
  return /sendgrid|ls\/click|wf\/open|resetpassword|ref_id|user_id|upn=/i.test(text);
}
