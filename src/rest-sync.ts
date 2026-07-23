// REST-based mail sync — replaces the broken IMAP /sync path.
// Hostinger Agentic-Mail webhook does not fire on real inbound mail (only the test
// button), and the old IMAP poll socket-times-out. The Hostinger REST API is reliable,
// so /sync pulls the newest DOE/FutureSky mail via REST and upserts into doe_emails,
// which is exactly what doe-bridge fetchOtp() reads.
import { upsertDoeEmails, type DoeEmailRow } from './supabase.js';

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
    '/api/v1/mailboxes/' + MAILBOX + '/folders/INBOX/messages/search?perPage=20&sort=-date',
    { method: 'POST', body: JSON.stringify({ since: sinceDate }) },
  );
  const msgs: any[] = Array.isArray(search?.data) ? search.data : [];
  const rows: Partial<DoeEmailRow>[] = [];
  for (const m of msgs) {
    const from = addr(m.from);
    if (!/futuresky|doe\.go\.th/i.test(from)) continue;
    let text = '';
    try {
      const t = await api('/api/v1/mailboxes/' + MAILBOX + '/folders/INBOX/messages/' + m.uid + '/text');
      text = String(t?.data?.text || '').slice(0, 1200);
    } catch { /* body optional */ }
    rows.push({
      uid: Number(m.uid), account: ACCOUNT, date: m.date, sender: from,
      recipient: addr(m.to), subject: String(m.subject || ''), source: 'rest-sync',
      type: '', request_no: '', employer: '', applicant: '', reviewer: '',
      reviewed_date: '', body_snippet: text, id_card: '', ticket_id: '',
    });
  }
  return rows.length ? upsertDoeEmails(rows) : 0;
}
