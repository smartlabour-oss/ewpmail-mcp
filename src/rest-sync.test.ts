import { test } from "node:test";
import assert from "node:assert/strict";
import { parseApiBody } from "./rest-sync.js";

// 204 = สิ่งที่ Hostinger ตอบตอนลบเมลสำเร็จ (ยืนยันจาก OpenAPI: "Message deleted successfully")
// ของเดิมเรียก r.json() ตรง ๆ → โยน SyntaxError ทุกครั้งที่ลบ "สำเร็จ" แล้ว log ขึ้นว่า failed
test("204 (ลบเมลสำเร็จ) = null ไม่ใช่โยน error", () => {
  assert.equal(parseApiBody(204, ""), null);
});

test("body ว่าง/ช่องว่างล้วน = null (เผื่อปลายทางตอบ 200 ตัวเปล่า)", () => {
  assert.equal(parseApiBody(200, ""), null);
  assert.equal(parseApiBody(200, "   \n "), null);
});

test("body ปกติยังแปลงเป็น object เหมือนเดิม", () => {
  assert.deepEqual(parseApiBody(200, '{"data":[{"uid":7}]}'), { data: [{ uid: 7 }] });
});

test("JSON เสียยังโยน — ไม่กลืนเงียบ", () => {
  assert.throws(() => parseApiBody(200, "{not json"));
});
