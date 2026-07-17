import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { AlienRef } from "./doe-parser.js";

let instance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!instance) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    instance = createClient(url, key);
  }
  return instance;
}

export interface DoeEmailRow {
  uid: number;
  account: string;
  date: string;
  sender: string;
  recipient: string;
  subject: string;
  source: string;
  type: string;
  request_no: string;
  employer: string;
  applicant: string;
  reviewer: string;
  reviewed_date: string;
  body_snippet: string;
  id_card: string;
  ticket_id: string;
}

export async function getLastSyncedUid(account: string): Promise<number> {
  const sb = getSupabase();
  const { data } = await sb
    .from("doe_emails")
    .select("uid")
    .eq("account", account)
    .order("uid", { ascending: false })
    .limit(1)
    .single();
  return data?.uid ?? 0;
}

export async function getLastSyncedDate(account: string): Promise<string | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from("doe_emails")
    .select("date")
    .eq("account", account)
    .order("date", { ascending: false })
    .limit(1)
    .single();
  return data?.date ?? null;
}

export type FillEwpResult = {
  matched: boolean;   // เจอคนงานใน DB ไหม
  updated: boolean;   // เพิ่งเติมอีเมลไหม (false = มีอยู่แล้ว / ไม่เจอ / กำกวม)
  alien_id?: string;
  reason?: string;
};

/**
 * จับคู่คนงานจาก AlienRef แล้วเติม workers.ewp_email ถ้ายังว่าง
 *
 * เรียกผ่าน RPC `fill_ewp_email` (SECURITY DEFINER) แทนเขียน workers ตรงๆ เพราะ:
 * - repo นี้ public + ใช้ anon key (anon ไม่มีสิทธิ์ workers โดยตรง — least privilege)
 * - logic no-overwrite ทำใน DB แบบ atomic (กัน race)
 *
 * กติกา (บังคับในฟังก์ชัน DB):
 * - ไม่ทับอีเมลเดิม · พาสปอร์ตจับ case-insensitive · เจอ >1 คน = ไม่เติม
 * - เติม ewp_password เฉพาะตอนส่งมาและช่องยังว่าง
 */
export async function fillEwpEmail(
  ref: AlienRef,
  email: string,
  password?: string | null,
): Promise<FillEwpResult> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("fill_ewp_email", {
    p_column: ref.column,
    p_value: ref.value,
    p_email: email,
    p_password: password ?? null,
  });
  if (error) return { matched: false, updated: false, reason: error.message };
  const r = (data ?? {}) as FillEwpResult;
  return {
    matched: Boolean(r.matched),
    updated: Boolean(r.updated),
    alien_id: r.alien_id,
    reason: r.reason,
  };
}

export async function upsertDoeEmails(rows: Partial<DoeEmailRow>[]): Promise<number> {
  if (rows.length === 0) return 0;
  const sb = getSupabase();
  let upserted = 0;
  const chunkSize = 50;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await sb
      .from("doe_emails")
      .upsert(chunk, { onConflict: "account,uid", ignoreDuplicates: false });
    if (error) throw new Error(`Upsert failed: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}
