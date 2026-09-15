import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRecipient, recipientList, partitionByRelease } from "./release-filter.js";

// ⚠️ ที่อยู่ทดสอบสมมติทั้งหมด (รูปแบบเดียวกับของจริงแต่เลขปลอมชัด ๆ)
const A = "ra00000000000000001@successlabour168.com";
const B = "ra00000000000000002@successlabour168.com";

test("normalizeRecipient: ตัดชื่อหน้า แล้วลดเป็นตัวเล็ก", () => {
  assert.equal(normalizeRecipient("Worker <RA00000000000000001@SuccessLabour168.com>"), A);
  assert.equal(normalizeRecipient(A), A);
  assert.equal(normalizeRecipient("  " + A + "  "), A);
  assert.equal(normalizeRecipient(""), "");
  assert.equal(normalizeRecipient(null), "");
});

test("recipientList: เห็นผู้รับครบทุกคน ไม่ใช่แค่คนแรก", () => {
  // ของเดิม addr() คืนแค่ v[0] — เมลถึงคนงานเรา 2 คนจะถูกตรวจแค่คนแรก
  assert.deepEqual(recipientList([{ address: A }, { address: B }]), [A, B]);
  assert.deepEqual(recipientList({ address: "RA00000000000000001@SuccessLabour168.com" }), [A]);
  assert.deepEqual(recipientList(`${A}, ${B}`), [A, B]);
  assert.deepEqual(recipientList([{ address: A }, { address: A }]), [A], "ที่อยู่ซ้ำต้องเหลือตัวเดียว");
  assert.deepEqual(recipientList(null), []);
});

test("partitionByRelease: ผู้รับที่ปล่อยแล้วไปกอง drop ที่เหลืออยู่ keep", () => {
  const msgs = [{ uid: 1, to: [A] }, { uid: 2, to: [B] }, { uid: 3, to: ["c@successlabour168.com"] }];
  const addrs = (m: (typeof msgs)[number]) => recipientList(m.to);
  const r = partitionByRelease(msgs, new Set([B]), addrs);
  assert.deepEqual(r.drop.map((m) => m.uid), [2]);
  assert.deepEqual(r.keep.map((m) => m.uid), [1, 3]);
});

test("ชุดว่าง = ไม่ทิ้งอะไรเลย (กันกรณีอ่าน view ไม่ได้แล้วเผลอทิ้งหมด)", () => {
  const msgs = [{ uid: 1, to: [A] }, { uid: 2, to: [B] }];
  const r = partitionByRelease(msgs, new Set(), (m) => recipientList(m.to));
  assert.equal(r.drop.length, 0);
  assert.equal(r.keep.length, 2);
});

test("เมลถึงหลายคน: ทิ้งเฉพาะตอนที่ปล่อยแล้วครบทุกคน", () => {
  const both = [{ uid: 1, to: [A, B] }];
  const addrs = (m: (typeof both)[number]) => recipientList(m.to);

  // ปล่อยแค่คนเดียว → ยังมีคนที่เราดูแลอยู่ในเมลฉบับนี้ ต้องเก็บ
  assert.equal(partitionByRelease(both, new Set([B]), addrs).drop.length, 0);
  // ปล่อยครบทั้งสองคน → ทิ้งได้
  assert.equal(partitionByRelease(both, new Set([A, B]), addrs).drop.length, 1);
});

test("แกะที่อยู่ไม่ออก = เก็บไว้ ไม่เดา", () => {
  const msgs = [{ uid: 9, to: null }];
  const r = partitionByRelease(msgs, new Set([A]), (m) => recipientList(m.to));
  assert.equal(r.drop.length, 0);
  assert.equal(r.keep.length, 1);
});
