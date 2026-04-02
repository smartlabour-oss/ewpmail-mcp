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
 */
export function extractIdCardFromRecipient(to: string): string | null {
  const match = to.match(/(\d{13})@successlabour168\.com/);
  return match?.[1] ?? null;
}