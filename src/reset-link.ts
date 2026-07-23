import { simpleParser } from "mailparser";
import { withImap } from "./imap-client.js";
import type { AccountConfig } from "./types.js";

const SENDGRID_RE = /https:\/\/u56672202\.ct\.sendgrid\.net\/[^\s"'()<>]+/;

/**
 * Pull the DOE password-reset SendGrid link out of a decoded email string
 * (a MIME part's text, already decoded from quoted-printable/base64 — not
 * the raw RFC822 source, which can split long URLs across `=\r\n` soft
 * line-breaks before this regex ever runs).
 */
export function extractResetLink(text: string): string | null {
  const m = text.match(SENDGRID_RE);
  return m ? m[0] : null;
}

/** Find the newest unseen reset email TO `recipient` (since `sinceIso`) and return its link. */
export async function findResetLink(
  account: AccountConfig,
  recipient: string,
  sinceIso: string,
): Promise<string | null> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const result = await client.search({
        to: recipient,
        seen: false,
        since: new Date(sinceIso),
      });
      const uids: number[] = Array.isArray(result) ? result : [];
      if (uids.length === 0) return null;

      // IMAP UIDs increase monotonically — take the most recent ones, newest first.
      const newest = uids.slice(-5).sort((a, b) => b - a);

      const sources: { uid: number; source: Buffer }[] = [];
      for await (const msg of client.fetch(newest, { source: true })) {
        if (msg.source) sources.push({ uid: msg.uid, source: msg.source });
      }
      sources.sort((a, b) => b.uid - a.uid);

      // Decode each MIME part (mailparser handles quoted-printable/base64) BEFORE
      // regexing — the raw RFC822 source can split long SendGrid URLs across
      // soft line-breaks, silently hiding the link from a plain-source regex.
      for (const { source } of sources) {
        const parsed = await simpleParser(source);
        const link = extractResetLink(parsed.html || "") || extractResetLink(parsed.text || "");
        if (link) return link;
      }
      return null;
    } finally {
      lock.release();
    }
  });
}
