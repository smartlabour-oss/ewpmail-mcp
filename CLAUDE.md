# ewpmail-mcp — AI Context

Email integration MCP server for Smart Labour 168 — DOE email parsing + Hostinger mailbox operations.

## Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 20+ / TypeScript 5 |
| Protocol | MCP (`@modelcontextprotocol/sdk`) + Express 5 |
| IMAP | `imapflow` |
| Email parsing | `mailparser` |
| Sending | `nodemailer` |
| Backend | Supabase |
| Validation | `zod` |

## Deploy

→ **ewpmail.successlabour168.com** (Coolify VPS Singapore)

Public repo (only one in smartlabour-oss org that's public).

## Architecture

```
src/
├── index.ts            # Express + MCP server
├── accounts.ts         # Multi-account IMAP config (DOE + smartlabour.*)
├── doe-parser.ts       # Parse DOE notification emails (status updates, receipts)
├── futuresky-parser.ts # Parse Futuresky/agency emails
├── imap-client.ts      # IMAP connection wrapper (imapflow)
├── supabase.ts         # Save parsed emails → Supabase
├── tools.ts            # MCP tool definitions
└── types.ts
```

## Commands

```bash
npm run dev    # tsx src/index.ts
npm run build  # tsc → dist/
npm run start  # node dist/index.js
```

## Tools (samples — check tools.ts for full list)

- list_accounts — available IMAP accounts
- search_emails — by sender/subject/date
- read_email — full body + attachments
- doe_check_emails — latest DOE notifications
- sync_doe_emails — pull + parse → Supabase

## DO

- Use `imapflow` (NOT old `imap` package) — modern async API
- Parse emails with `mailparser` to extract attachments + cleaned body
- Store email metadata in Supabase (audit trail)
- Multi-account support — each DOE/agency account in `accounts.ts`

## DON'T

- ❌ Commit credentials — use env vars (`EWPMAIL_IMAP_USER`, `EWPMAIL_IMAP_PASS`)
- ❌ Auto-reply based on email content (prompt injection risk)
- ❌ Send bulk emails without rate limiting (Hostinger IMAP has limits)
- ❌ Store full email body in logs (PII risk — mask/truncate)

## Source of Truth

- **Code:** github.com/smartlabour-oss/ewpmail-mcp (PUBLIC repo)
- **Email data:** Supabase `emails` table + Hostinger IMAP (mailbox canonical)

## Security Notes

- Public repo — NEVER commit:
  - IMAP passwords
  - Supabase service_role key
  - Email body samples with PII
- Use `.env` + `.gitignore` for all secrets
- Review PRs carefully (public visibility)

## Related

- gh-pages branch deployed 2026-03-28 (see /infra Recent Events)
- Integration with DOE workflow: email → parse → sync to Supabase → webapp displays status
- gmail-mcp on Coolify = separate (personal Gmail), ewpmail-mcp = business DOE/Hostinger
