import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { AccountConfig, EmailMessage, SearchOptions } from "./types.js";

export async function withImap<T>(
  account: AccountConfig,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: account.auth,
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout();
  }
}

export async function searchEmails(
  account: AccountConfig,
  opts: SearchOptions
): Promise<EmailMessage[]> {
  return withImap(account, async (client) => {
    const folder = opts.folder || "INBOX";
    const lock = await client.getMailboxLock(folder);
    try {
      // Build IMAP search criteria
      const criteria: any = {};
      if (opts.from) criteria.from = opts.from;
      if (opts.to) criteria.to = opts.to;
      if (opts.subject) criteria.subject = opts.subject;
      if (opts.unread_only) criteria.seen = false;
      if (opts.since) criteria.since = new Date(opts.since);
      if (opts.before) criteria.before = new Date(opts.before);
      if (opts.search) {
        criteria.or = [{ subject: opts.search }, { body: opts.search }];
      }

      const hasFilter = Object.keys(criteria).length > 0;
      const limit = opts.limit || 10;
      const messages: EmailMessage[] = [];

      let uids: number[];
      if (hasFilter) {
        const result = await client.search(criteria);
        uids = Array.isArray(result) ? result : [];
      } else {
        // Get latest UIDs
        const mb = client.mailbox;
        const total =
          mb && typeof mb === "object" && "exists" in mb
            ? (mb as any).exists
            : 0;
        if (total === 0) return [];
        const startSeq = Math.max(1, total - limit + 1);
        const range = `${startSeq}:${total}`;
        const result = await client.search({ seq: range } as any);
        uids = Array.isArray(result) ? result : [];
      }

      if (uids.length === 0) return [];
      const sliced = uids.slice(-limit);

      for await (const msg of client.fetch(sliced, {
        envelope: true,
        bodyStructure: true,
        source: true,
      })) {
        const parsed = await parseMessage(msg, account.id);
        if (parsed) messages.push(parsed);
      }

      // Sort newest first
      messages.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      return messages;
    } finally {
      lock.release();
    }
  });
}

export async function readEmail(
  account: AccountConfig,
  uid: number,
  folder = "INBOX"
): Promise<EmailMessage | null> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      for await (const msg of client.fetch([uid], {
        envelope: true,
        bodyStructure: true,
        source: true,
      })) {
        return parseMessage(msg, account.id);
      }
      return null;
    } finally {
      lock.release();
    }
  });
}

async function parseMessage(
  msg: any,
  accountId: string
): Promise<EmailMessage | null> {
  const env = msg.envelope;
  if (!env) return null;

  let body = "";
  if (msg.source) {
    try {
      const parsed = await simpleParser(msg.source);
      body = parsed.text || "";
      if (!body && parsed.html) {
        body = parsed.html
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&#\d+;/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      // Truncate
      if (body.length > 3000) body = body.substring(0, 3000) + "...";
    } catch {
      body = "[parse error]";
    }
  }

  return {
    uid: msg.uid,
    account: accountId,
    date: env.date?.toISOString() || "",
    from:
      env.from
        ?.map((a: any) => `${a.name || ""} <${a.address}>`.trim())
        .join(", ") || "",
    to:
      env.to
        ?.map((a: any) => `${a.name || ""} <${a.address}>`.trim())
        .join(", ") || "",
    subject: env.subject || "",
    body,
    flags: msg.flags ? [...msg.flags] : [],
  };
}