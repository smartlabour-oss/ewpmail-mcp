// REST-based mail sync — replaces the broken IMAP /sync path.
// Hostinger Agentic-Mail webhook does not fire on real inbound mail (only the test
// button), and the old IMAP poll socket-times-out. The Hostinger REST API is reliable,
// so /sync pulls the newest DOE/FutureSky mail via REST and upserts into doe_emails,
// which is exactly what doe-bridge fetchOtp() reads.
import { upsertDoeEmails, existingDoeUids, type DoeEmailRow } from './supabase.js';
import { classifyDoeMail, extractTicketId } from './classify.js';
import { parseDoeEmail, extractAlienRef } from './doe-parser.js';
import type { EmailMessage } from './types.js';

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
  return r.json();
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

  // /sync ถูก poll ถี่มากระหว่างรอ OTP (ทุก 8 วิ) — แถวที่มีแล้วข้ามทั้งการดึง body
  // และการ upsert เพื่อไม่ยิง Hostinger ซ้ำ และไม่เขียนทับ type/source ที่จัดหมวดไปแล้ว
  const known = await existingDoeUids(ACCOUNT, wanted.map((m) => Number(m.uid)));
  const rows: Partial<DoeEmailRow>[] = [];
  for (const m of wanted) {
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
      body_snippet: text.slice(0, 1200),
      id_card: ref?.column === 'id_card' ? ref.value : '',
      ticket_id: type === 'helpdesk' ? extractTicketId(subject) : '',
    });
  }
  return rows.length ? upsertDoeEmails(rows) : 0;
}
