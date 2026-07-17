import type { DoeEmailParsed, EmailMessage } from "./types.js";

/**
 * Parse DOE email body into structured data
 * Handles: ผลการอนุมัติ, ผลการพิจารณา, ผลการตรวจสอบเอกสาร, แจ้งเอกสารที่ต้องแก้ไข
 */
export function parseDoeEmail(email: EmailMessage): DoeEmailParsed | null {
  const { subject, body } = email;
  if (!subject && !body) return null;

  // Detect type from subject
  let type = "unknown";
  if (subject.includes("ผลการอนุมัติ")) type = "อนุมัติ";
  else if (subject.includes("ผลการพิจารณา")) type = "พิจารณา";
  else if (subject.includes("ผลการตรวจสอบเอกสาร")) type = "ตรวจสอบเอกสาร";
  else if (subject.includes("แจ้งเอกสารที่ต้องแก้ไข")) type = "แก้ไขเอกสาร";
  else if (subject.includes("ลงทะเบียนสำเร็จ")) type = "ลงทะเบียน";
  else if (subject.includes("ยืนยันที่อยู่อีเมล")) type = "ยืนยันอีเมล";

  // Extract request number (เลขที่คำขอ)
  const requestNoMatch = body.match(
    /เลขที่คำขอ\s*[:\s]*(\d{14,17})/
  );
  const request_no = requestNoMatch?.[1] || "";

  // Extract employer name
  const employerMatch = body.match(
    /(?:ชื่อผู้ยื่นคำขอ|เรียน)\s*[:\s]*((?:บริษัท|ห้างหุ้นส่วน|นาย|นาง|นางสาว)[^\n]*?)(?:\s*(?:บริษัทนำเข้า|วันที่|เลขที่))/
  );
  const employer = employerMatch?.[1]?.trim() || "";

  // Extract applicant (ชื่อผู้ยื่นคำขอ)
  const applicantMatch = body.match(
    /ชื่อผู้ยื่นคำขอ\s*[:\s]*(.*?)(?:\s*(?:บริษัทนำเข้า|วันที่))/
  );
  const applicant = applicantMatch?.[1]?.trim() || employer;

  // Extract submitted date
  const submitDateMatch = body.match(
    /วันที่และเวลาที่ยื่น\s*[:\s]*([\d]+\s+\S+\s+\d{4}\s+[\d:]+)/
  );
  const submitted_date = submitDateMatch?.[1] || "";

  // Extract reviewer
  const reviewerMatch = body.match(
    /ชื่อผู้ตรวจสอบ\s*\/?\s*พิจารณา\s*[:\s]*(.*?)(?:\s*ตำแหน่ง)/
  );
  const reviewer = reviewerMatch?.[1]?.replace(/-/g, "").trim() || "";

  // Extract reviewer title
  const titleMatch = body.match(
    /ตำแหน่ง\s*[:\s]*(.*?)(?:\s*วันที่และเวลาที่ตรวจสอบ)/
  );
  const reviewer_title = titleMatch?.[1]?.trim() || "";

  // Extract reviewed date
  const reviewDateMatch = body.match(
    /วันที่และเวลาที่ตรวจสอบ\s*\/?\s*พิจารณา\s*[:\s]*([\d]+\s+\S+\s+\d{4}\s+[\d:]+)/
  );
  const reviewed_date = reviewDateMatch?.[1] || "";

  return {
    request_no,
    type,
    employer,
    applicant,
    submitted_date,
    reviewer,
    reviewer_title,
    reviewed_date,
  };
}

export function isDoeEmail(email: EmailMessage): boolean {
  return email.from.includes("doe.go.th");
}

/**
 * Extract 13-digit ID card from catch-all recipient address
 * e.g. "8500652001091@successlabour168.com" → "8500652001091"
 *
 * @deprecated ครอบคลุมแค่รูปแบบเลข 13 หลัก — ใช้ extractAlienRef แทนสำหรับ webhook
 * (บัญชี eWP มีอีเมล 3 รูปแบบ เห็นจากการกวาดกล่องเมล 2026-07-17)
 */
export function extractIdCardFromRecipient(to: string): string | null {
  const match = to.match(/(\d{13})@successlabour168\.com/);
  return match?.[1] ?? null;
}

/** คอลัมน์ใน workers ที่ใช้จับคู่คนงานจาก local-part ของอีเมลผู้รับ */
export type AlienRef = {
  column: "id_card" | "alien_id" | "stay_permis_no";
  value: string;
};

/**
 * แกะ "ตัวอ้างอิงคนงาน" จากที่อยู่ผู้รับ (กล่องเมล catch-all)
 *
 * กรมออกบัญชี eWP ให้คนงานภายใต้อีเมล 3 รูปแบบ (ยืนยันจากกวาดกล่องเมล 2026-07-17):
 *   <เลข13หลัก>@successlabour168.com  → workers.id_card        เช่น 6985000017523
 *   <RA…>@successlabour168.com         → workers.alien_id       เช่น RA17607805364907514
 *   <พาสปอร์ต>@successlabour168.com    → workers.stay_permis_no เช่น CC7096585 (พาสปอร์ตพม่า)
 *
 * บาง local-part ของพาสปอร์ตมีชื่อต่อท้าย (CC7991748MYOTHAN) → ตัดเอาแต่แกนพาสปอร์ต
 * ตรวจ 13 หลักก่อน (ตัวเลขล้วน) แล้วค่อย RA แล้วค่อยพาสปอร์ต เพื่อไม่ให้ชนกัน
 */
export function extractAlienRef(to: string): AlienRef | null {
  // จับ local-part ที่เป็นตัวอักษร/ตัวเลขติดกับ @domain — ทนต่อรูปแบบ "Name <local@domain>"
  // (bracket/ช่องว่างนำหน้าถูกตัดออกเอง) · 3 รูปแบบเป้าหมายเป็น alnum ล้วนทั้งหมด
  const local = to.match(/([A-Za-z0-9]+)@successlabour168\.com/i)?.[1];
  if (!local) return null;
  if (/^\d{13}$/.test(local)) return { column: "id_card", value: local };
  if (/^RA\d+$/i.test(local)) return { column: "alien_id", value: local.toUpperCase() };
  const passport = local.match(/^([A-Za-z]{1,3}\d{5,})/);
  if (passport) return { column: "stay_permis_no", value: passport[1].toUpperCase() };
  return null;
}

/**
 * ดึงรหัสผ่านชั่วคราวจากเนื้อเมล "ลงทะเบียนสำเร็จ" ของกรม (best-effort)
 * รูปแบบเนื้อเมลอาจต่างกัน — คืน null ถ้าจับไม่ได้ (ไม่ทำให้ webhook ล้ม)
 */
export function extractTempPassword(body: string): string | null {
  if (!body) return null;
  const m =
    body.match(/(?:รหัสผ่าน|password)\s*[:：]?\s*([^\s<>\n]{6,32})/i) ?? null;
  return m?.[1] ?? null;
}