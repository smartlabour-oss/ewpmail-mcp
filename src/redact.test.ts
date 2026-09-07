import { test } from "node:test";
import assert from "node:assert/strict";
import { LINK_REMOVED, hasResetLinkTrace, snippetForDb, stripResetLinks } from "./redact.js";

// โครงเมลรีเซ็ตจริงของกรม (ค่าในลิงก์สมมติ) — Hostinger /text คืน plain text แบบนี้
const RESET_MAIL = [
  "เรียน ผู้ใช้งาน",
  "ท่านได้ทำการขอรีเซ็ตรหัสผ่านสำหรับระบบ e-Work Permit",
  "กรุณากดที่ลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่",
  "https://u56672202.ct.sendgrid.net/ls/click?upn=u001.AbCdEfGh-2BiJkLmNoPqRsTuVwXyZ0123456789-3DAbCd",
  "หากท่านไม่ได้เป็นผู้ขอ กรุณาละเว้นอีเมลฉบับนี้",
  "กรมการจัดหางาน https://eworkpermit.doe.go.th",
  "",
  "https://u56672202.ct.sendgrid.net/wf/open?upn=u001.XyZ",
].join("\n");

test("เมลรีเซ็ตของกรม: ไม่เหลือร่องรอยลิงก์ แต่ข้อความไทยและลิงก์พอร์ทัลอยู่ครบ", () => {
  const out = stripResetLinks(RESET_MAIL);
  assert.equal(hasResetLinkTrace(out), false);
  assert.ok(out.includes("ท่านได้ทำการขอรีเซ็ตรหัสผ่านสำหรับระบบ e-Work Permit"));
  assert.ok(out.includes("หากท่านไม่ได้เป็นผู้ขอ กรุณาละเว้นอีเมลฉบับนี้"));
  assert.ok(out.includes("https://eworkpermit.doe.go.th"), "ลิงก์พอร์ทัลไม่ใช่ลิงก์รีเซ็ต ต้องคงไว้");
  assert.ok(out.includes(LINK_REMOVED));
});

test("ลิงก์ปลายทางหลัง redirect (resetpassword?user_id&ref_id) หายทั้งก้อน", () => {
  const out = stripResetLinks(
    "ตั้งรหัสที่ https://eworkpermit.doe.go.th/login/resetpassword?user_id=123456&ref_id=abc-def-789 ภายใน 24 ชม.",
  );
  assert.equal(out, `ตั้งรหัสที่ ${LINK_REMOVED} ภายใน 24 ชม.`);
});

test("ชิ้นส่วนที่ไม่มี scheme (โดเมนเปล่า / พารามิเตอร์โดด) ก็หาย", () => {
  for (const bare of [
    "u56672202.ct.sendgrid.net/ls/click?upn=u001.AbC",
    "ref_id=abc-def user_id=123",
    "ls/click?upn=u001.AbC",
    "upn=u001.AbC",
  ]) {
    const out = stripResetLinks(`เนื้อความ ${bare} ต่อท้าย`);
    assert.equal(hasResetLinkTrace(out), false, bare);
    assert.ok(out.startsWith("เนื้อความ "), bare);
    assert.ok(out.endsWith(" ต่อท้าย"), bare);
  }
});

test("URL ติดอักษรไทยโดยไม่เว้นวรรค — ตัดแค่ URL ไม่กินคำไทย", () => {
  const out = stripResetLinks("กดที่นี่https://u56672202.ct.sendgrid.net/ls/click?upn=AbCเพื่อตั้งรหัส");
  assert.equal(out, `กดที่นี่${LINK_REMOVED}เพื่อตั้งรหัส`);
});

test("ป้ายซ้อนติดกัน (ปุ่ม + pixel) ยุบเหลือป้ายเดียว", () => {
  const out = stripResetLinks(
    "https://u56672202.ct.sendgrid.net/ls/click?upn=A https://u56672202.ct.sendgrid.net/wf/open?upn=B",
  );
  assert.equal(out, LINK_REMOVED);
});

test("เมลที่ไม่มีลิงก์รีเซ็ต → คงเดิมทุกตัวอักษร (OTP, ลงทะเบียนสำเร็จ, เจ้าหน้าที่, helpdesk)", () => {
  for (const plain of [
    "รหัส OTP ของท่านคือ 482913 (Ref: AB12) มีอายุ 5 นาที",
    "ลงทะเบียนสำเร็จ(นาย ตัวอย่าง) บัญชีของท่านพร้อมใช้งาน",
    "เจ้าหน้าที่ตรวจสอบ: เอกสารหน้า 2 ไม่ชัด กรุณาแนบใหม่ (เลขคำขอ 69125200695566)",
    "ดู ticket ที่ https://futuresky.freshdesk.com/helpdesk/tickets/123",
    "เข้าระบบที่ https://eworkpermit.doe.go.th/login แล้วเลือกเมนูคำขอ",
    "อีเมล worker.001@example.com ยืนยันแล้ว · ยอด 1,900.00 บาท",
    "",
  ]) {
    assert.equal(stripResetLinks(plain), plain, plain);
  }
});

test("snippetForDb: ตัดลิงก์ก่อนหั่นความยาว — ลิงก์ที่จะถูกหั่นครึ่งต้องไม่เหลือชิ้นส่วน", () => {
  const head = "ก".repeat(1190);
  const body = `${head} https://u56672202.ct.sendgrid.net/ls/click?upn=u001.AbCdEfGh ท้าย`;
  const out = snippetForDb(body, 1200);
  assert.ok(out.length <= 1200);
  assert.equal(hasResetLinkTrace(out), false);
  // ถ้าหั่นก่อนตัด จะเหลือ "https://u" ค้าง — พิสูจน์ว่าลำดับถูก
  assert.equal(body.slice(0, 1200).includes("https://u"), true);
  assert.equal(out.includes("https://u"), false);
});

test("snippetForDb: ค่าว่าง/undefined ไม่โยน", () => {
  assert.equal(snippetForDb("", 800), "");
  assert.equal(snippetForDb(undefined as unknown as string, 800), "");
});

test("hasResetLinkTrace จับทุกชิ้นส่วนที่รู้จัก และไม่จับข้อความสะอาด", () => {
  for (const t of ["sendgrid", "ls/click", "wf/open", "resetpassword", "ref_id", "user_id", "upn="]) {
    assert.equal(hasResetLinkTrace(`ก ${t} ข`), true, t);
  }
  assert.equal(hasResetLinkTrace("ลงทะเบียนสำเร็จ 482913 https://eworkpermit.doe.go.th"), false);
});
