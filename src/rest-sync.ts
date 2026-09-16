// REST-based mail sync — replaces the broken IMAP /sync path.
// Hostinger Agentic-Mail webhook does not fire on real inbound mail (only the test
// button), and the old IMAP poll socket-times-out. The Hostinger REST API is reliable,
// so /sync pulls the newest DOE/FutureSky mail via REST and upserts into doe_emails,
// which is exactly what doe-bridge fetchOtp() reads.
import {
  upsertDoeEmails,
  existingDoeUids,
  fetchReleasedEmails,
  logDroppedMails,
  type DoeEmailRow,
} from './supabase.js';
import { partitionByRelease, recipientList } from './release-filter.js';
import { classifyDoeMail, extractTicketId } from './classify.js';
import { parseDoeEmail, extractAlienRef } from './doe-parser.js';
import type { EmailMessage } from './types.js';
import { snippetForDb } from './redact.js';

const API = 'https://api.mail.hostinger.com';
const TOKEN = process.env.HOSTINGER_MAIL_API_TOKEN || '';
const MAILBOX = process.env.HOSTINGER_MAILBOX_ID || 'AC8809684543a10c304864d361f127';
const ACCOUNT = process.env.HOSTINGER_EMAIL || 'successlabour168@successlabour168.com';

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error('hostinger ' + r.status);
  return parseApiBody(r.status, r.status === 204 ? '' : await r.text());
}

/**
 * แปลง body ของ Hostinger เป็น object — คืน null เมื่อไม่มีเนื้อ
 *
 * DELETE ตอบ 204 ไม่มี body: ของเดิมเรียก r.json() ตรง ๆ จึงโยน SyntaxError ทุกครั้งที่
 * "ลบสำเร็จ" แล้วถูก catch ข้างนอกนับเป็นความล้มเหลว — log จะขึ้น delete failed ทั้งที่ลบได้
 * แยกออกมาเป็นฟังก์ชันล้วนเพื่อเทสต์ได้โดยไม่ต้องยิงเน็ต
 */
export function parseApiBody(status: number, body: string): any {
  if (status === 204 || !body.trim()) return null;
  return JSON.parse(body);
}

function addr(v: any): string {
  if (!v) return '';
  if (Array.isArray(v)) return addr(v[0]);
  if (typeof v === 'object') return String(v.address || '');
  return String(v);
}

/** Pull recent DOE/FutureSky mail via REST into doe_emails. Idempotent (upsert on account,uid). */
export async function syncViaRest(sinceMinutes = 20): Promise<number> {
  if (!TOKEN) throw new Error('HOSTINGER_MAIL_API_TOKEN not set');
  const sinceDate = new Date(Date.now() - sinceMinutes * 60000).toISOString().slice(0, 10);
  const search = await api(
    '/api/v1/mailboxes/' + MAILBOX + '/folders/INBOX/messages/search?perPage=50&sort=-date',
    { method: 'POST', body: JSON.stringify({ since: sinceDate }) },
  );
  const msgs: any[] = Array.isArray(search?.data) ? search.data : [];
  const wanted = msgs.filter((m) => /futuresky|doe\.go\.th/i.test(addr(m.from)));

  // ── บัญชีที่ปล่อยแล้ว: ไม่เก็บเนื้อเมลของคนงานที่ออกจากเราไปแล้ว ──
  // ต้องคัดก่อน existingDoeUids/ดึง body เพื่อไม่ให้เนื้อเมลเข้ามาในหน่วยความจำเลย
  // fetchReleasedEmails() โยนเมื่ออ่าน view ไม่ได้ → /sync ล้มดัง ๆ (ตั้งใจ ดูหมายเหตุที่ supabase.ts)
  const released = await fetchReleasedEmails();
  const { keep, drop } = partitionByRelease(wanted, released, (m) => recipientList(m.to));
  if (drop.length) {
    await logDroppedMails(
      drop.map((m) => ({
        email: recipientList(m.to)[0] ?? '',
        uid: Number(m.uid),
        mail_date: m.date ?? null,
        mail_type: classifyDoeMail(String(m.subject || ''), addr(m.from)).type,
      })),
    );
    // ลบของจริงออกจากกล่อง = ลบถาวร กู้ไม่ได้ (Hostinger ไม่ย้ายลง Trash ให้)
    // จึงเป็น opt-in: ตั้ง RELEASE_DELETE_MAIL=1 เมื่อ owner ดู doe_mail_dropped แล้วพอใจ
    // ค่าปริยายคือ "ไม่เก็บเข้าฐาน แต่ยังไม่ลบเมล" — ได้ผลตามโจทย์ PDPA แล้วโดยไม่ทำลายอะไร
    if (process.env.RELEASE_DELETE_MAIL === '1') {
      for (const m of drop) {
        try {
          await api('/api/v1/mailboxes/' + MAILBOX + '/folders/INBOX/messages/' + m.uid, { method: 'DELETE' });
        } catch (e) {
          console.error('[release] delete uid failed', m.uid, String((e as Error).message));
        }
      }
    }
    console.error(`[release] dropped ${drop.length} mail(s) for released accounts`);
  }

  // /sync ถูก poll ถี่มากระหว่างรอ OTP (ทุก 8 วิ) — แถวที่มีแล้วข้ามทั้งการดึง body
  // และการ upsert เพื่อไม่ยิง Hostinger ซ้ำ และไม่เขียนทับ type/source ที่จัดหมวดไปแล้ว
  const known = await existingDoeUids(ACCOUNT, keep.map((m) => Number(m.uid)));
  const rows: Partial<DoeEmailRow>[] = [];
  for (const m of keep) {
    if (known.has(Number(m.uid))) continue;
    const from = addr(m.from);
    const recipient = addr(m.to);
    const subject = String(m.subject || '');
    let text = '';
    try {
      const t = await api('/api/v1/mailboxes/' + MAILBOX + '/folders/INBOX/messages/' + m.uid + '/text');
      text = String(t?.data?.text || '');
    } catch { /* body optional */ }

    const { type, source } = classifyDoeMail(subject, from);
    const parsed = parseDoeEmail({ subject, body: text } as EmailMessage);
    const ref = extractAlienRef(recipient);
    rows.push({
      uid: Number(m.uid), account: ACCOUNT, date: m.date, sender: from,
      recipient, subject, source, type,
      request_no: parsed?.request_no || '',
      employer: parsed?.employer || '',
      applicant: parsed?.applicant || '',
      reviewer: parsed?.reviewer || '',
      reviewed_date: parsed?.reviewed_date || '',
      body_snippet: snippetForDb(text, 1200),
      id_card: ref?.column === 'id_card' ? ref.value : '',
      ticket_id: type === 'helpdesk' ? extractTicketId(subject) : '',
    });
  }
  return rows.length ? upsertDoeEmails(rows) : 0;
}
