// จัดหมวดเมล DOE/FutureSky จาก subject prefix — เมลกรมเป็น template คงที่
// rule ชุดนี้ derive จาก audit เมลจริงทั้งตาราง doe_emails 5,111 ฉบับ (2026-07-24)
// ครอบคลุม 100% ณ วันนั้น · เมลที่ไม่เข้า rule ไหนเลย = 'unknown' (template ใหม่ของกรม
// หรือรูปแบบที่ไม่เคยเห็น — watcher ฝั่ง n8n จะ alert เมื่อเจอ unknown เพื่อให้มาเติม rule)
//
// type 6 ค่าแรกตรงกับของ parseDoeEmail เดิม (webapp filter ใช้อยู่) — ห้ามเปลี่ยนสตริง

export interface MailClass {
  type: string;
  source: "doe" | "futuresky";
}

export function classifyDoeMail(subject: string, sender: string): MailClass {
  const s = (subject || "").trim();
  const type = s.startsWith("ยืนยันที่อยู่อีเมล")
    ? "ยืนยันอีเมล"
    : s.startsWith("ลงทะเบียนสำเร็จ")
      ? "ลงทะเบียน"
      : s.startsWith("ผลการอนุมัติ")
        ? "อนุมัติ"
        : s.startsWith("ผลการพิจารณา")
          ? "พิจารณา"
          : s.startsWith("ผลการตรวจสอบเอกสาร")
            ? "ตรวจสอบเอกสาร"
            : s.includes("แจ้งเอกสารที่ต้องแก้ไข")
              ? "แก้ไขเอกสาร"
              : s.startsWith("รีเซ็ตรหัสผ่าน")
                ? "รีเซ็ตรหัสผ่าน"
                : s.startsWith("เปลี่ยนรหัสผ่าน")
                  ? "เปลี่ยนรหัสผ่าน"
                  : s.includes("กู้คืนบัญชี")
                    ? "กู้คืนบัญชี"
                    : s.includes("นัดหมาย")
                      ? "นัดหมาย"
                      : /ticket/i.test(s) || /helpdesk/i.test(sender)
                        ? "helpdesk"
                        : "unknown";

  // กล่องบนเว็บแยกตามความหมาย ไม่ใช่ผู้ส่ง: เมลระบบ eWP (สถานะคำขอ/บัญชี) = กล่อง DOE
  // แม้ผู้ส่งเป็น e-WorkPermit@futuresky.co.th (vendor ส่งแทนกรม) · เฉพาะ helpdesk/ticket
  // และของแปลกที่มาจาก futuresky เท่านั้นที่เข้ากล่อง FutureSky
  const source: MailClass["source"] =
    type === "helpdesk" || type === "unknown"
      ? /doe\.go\.th/i.test(sender)
        ? "doe"
        : "futuresky"
      : "doe";

  return { type, source };
}

/** ดึงเลข Ticket จาก subject ของเมล helpdesk เช่น "Ticket Received - Ticket ID:195604 ..." */
export function extractTicketId(subject: string): string {
  return subject?.match(/Ticket\s*ID\s*[:#]?\s*(\d+)/i)?.[1] ?? "";
}
