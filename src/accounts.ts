import type { AccountConfig } from "./types.js";

// Account configs — loaded from env or hardcoded for now
// Phase 2: load from Supabase configs table
export function getAccounts(): AccountConfig[] {
  const accounts: AccountConfig[] = [
    {
      id: "gmail",
      name: "Gmail (SL168)",
      email: "successlabour168@gmail.com",
      imap: { host: "imap.gmail.com", port: 993, secure: true },
      smtp: { host: "smtp.gmail.com", port: 465, secure: true },
      auth: {
        user: "successlabour168@gmail.com",
        pass: process.env.GMAIL_APP_PASSWORD || "",
      },
    },
    {
      id: "hostinger",
      name: "Hostinger (SL168)",
      email: "successlabour168@successlabour168.com",
      imap: { host: "imap.hostinger.com", port: 993, secure: true },
      smtp: { host: "smtp.hostinger.com", port: 465, secure: true },
      auth: {
        user: "successlabour168@successlabour168.com",
        pass: process.env.HOSTINGER_EMAIL_PASS || "",
      },
    },
    {
      id: "smartlabour",
      name: "SmartLabour",
      email: "smartlabour@successlabour168.com",
      imap: { host: "imap.hostinger.com", port: 993, secure: true },
      smtp: { host: "smtp.hostinger.com", port: 465, secure: true },
      auth: {
        user: "smartlabour@successlabour168.com",
        pass: process.env.SMARTLABOUR_EMAIL_PASS || "",
      },
    },
  ];

  return accounts.filter((a) => a.auth.pass);
}

export function getAccount(id: string): AccountConfig | undefined {
  return getAccounts().find((a) => a.id === id);
}

export function getDefaultAccount(): AccountConfig | undefined {
  return getAccounts()[0];
}