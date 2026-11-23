# ewpmail-mcp — AI Context

Email integration MCP server for Smart Labour 168 — DOE email parsing + Hostinger mailbox operations.

## Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 20+ / TypeScript 5 |
| Protocol | MCP (`@modelcontextprotocol/sdk`) + Express 5 |
| IMAP | `imapflow` |
| Email parsing | `mailparser` |
| Sending | none — `nodemailer` is in package.json but never imported (no send tool) |
| Backend | Supabase |
| Validation | `zod` |

## Deploy

→ **ewpmail.successlabour168.com** (Thai VPS — pm2 process `ewpmail-mcp`, bound to loopback behind Caddy; not on Coolify)

Public repo — the only public repo the org wrote itself (public forks may also exist; live list: `gh repo list smartlabour-oss --visibility public --json name,isFork`).

## Architecture

```
src/
├── index.ts            # Express + MCP server (/mcp, /sync, /webhook, /reset-link, /health)
├── accounts.ts         # Multi-account IMAP config (gmail / hostinger / smartlabour + catch-all getter)
├── classify.ts         # Classify DOE/FutureSky mail by subject prefix
├── doe-parser.ts       # Parse DOE notification emails (status/result, registration, verify-email, temp password)
├── futuresky-parser.ts # Parse Futuresky/agency emails
├── imap-client.ts      # IMAP connection wrapper (imapflow)
├── mcp-auth.ts         # Bearer-token gate for /mcp (fail-closed)
├── redact.ts           # Strip password-reset link fragments before writing body_snippet
├── release-filter.ts   # Drop DOE mail of released eWP accounts before ingest
├── reset-link.ts       # Extract the DOE password-reset link from a mail
├── rest-sync.ts        # /sync via Hostinger REST API → doe_emails
├── supabase.ts         # Save parsed emails → Supabase
├── tools.ts            # MCP tool definitions
└── types.ts
```

The tree can drift — `git ls-files src` gives the live list (`*.test.ts` sit next to their modules; run with `npm test`).

## Commands

```bash
npm run dev    # tsx src/index.ts
npm run build  # tsc → dist/
npm run start  # node dist/index.js
```

## Tools (samples — check tools.ts for full list)

- list_accounts — available IMAP accounts
- search_emails — by sender/subject/date
- read_email — one email by UID (text body truncated at 3000 chars, no attachments)
- doe_check_emails — latest DOE notifications
- sync_doe_emails — pull + parse → Supabase

## DO

- Use `imapflow` (NOT old `imap` package) — modern async API
- Parse emails with `mailparser` (`simpleParser`) to get a cleaned text body (attachments are not extracted)
- Store email metadata in Supabase (audit trail)
- Multi-account support — each DOE/agency account in `accounts.ts`

## DON'T

- ❌ Commit credentials — use env vars (`GMAIL_APP_PASSWORD`, `HOSTINGER_EMAIL_PASS`, `SMARTLABOUR_EMAIL_PASS`, `HOSTINGER_MAIL_API_TOKEN`, `SUPABASE_ANON_KEY`, `EWPMAIL_MCP_TOKEN`, `EWPMAIL_WEBHOOK_SECRET`; live list: `git grep -o "process.env.[A-Z_0-9]*" -- src`)
- ❌ Auto-reply based on email content (prompt injection risk)
- ❌ Send bulk emails without rate limiting (no send code exists today — `nodemailer` is an unused dependency; this applies if a send path is ever added)
- ❌ Store full email body in logs (PII risk — mask/truncate)

## Source of Truth

- **Code:** github.com/smartlabour-oss/ewpmail-mcp (PUBLIC repo)
- **Email data:** Supabase `doe_emails` table (dropped mail is logged in `doe_mail_dropped`) + Hostinger mailbox (canonical)

## Security Notes

- Public repo — NEVER commit:
  - IMAP passwords
  - Supabase service_role key
  - Email body samples with PII
- Use `.env` + `.gitignore` for all secrets — `.gitignore` ignores only the exact name `.env` (a copy such as `.env.bak-*` is not ignored), and the app does not load `.env` itself (no dotenv / `--env-file`; it reads `process.env` only), so the values must be in the process environment (e.g. pm2 env)
- Review PRs carefully (public visibility)

## Related

- gh-pages branch (last deployed 2026-04-09; `git log -1 origin/gh-pages` for the live date) hosts a static `index.html` unrelated to the MCP server (see /infra Recent Events)
- Integration with DOE workflow: email → parse → sync to Supabase → webapp displays status
- gmail-mcp was renamed to ewpmail-mcp (2026-04-02) — there is no separate gmail-mcp; ewpmail-mcp covers the business Gmail account (active only when `GMAIL_APP_PASSWORD` is set) plus the Hostinger mailboxes (see `accounts.ts`)
