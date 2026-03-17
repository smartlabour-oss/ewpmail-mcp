export interface AccountConfig {
  id: string;           // "gmail", "hostinger", "smartlabour"
  name: string;         // display name
  email: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  auth: { user: string; pass: string };
}

export interface EmailMessage {
  uid: number;
  account: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  flags: string[];
}

export interface DoeEmailParsed {
  request_no: string;
  type: string;         // "อนุมัติ" | "พิจารณา" | "ตรวจสอบเอกสาร" | "แก้ไขเอกสาร"
  employer: string;
  applicant: string;
  submitted_date: string;
  reviewer: string;
  reviewer_title: string;
  reviewed_date: string;
}

export interface SearchOptions {
  account?: string;
  from?: string;
  to?: string;
  subject?: string;
  search?: string;
  since?: string;
  before?: string;
  unread_only?: boolean;
  limit?: number;
  folder?: string;
}