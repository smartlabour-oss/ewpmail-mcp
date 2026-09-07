import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerFrom, checkMcpToken } from "./mcp-auth.js";

test("bearerFrom: ดึง token จาก Bearer header · รูปอื่นได้ค่าว่าง", () => {
  assert.equal(bearerFrom("Bearer abc123"), "abc123");
  assert.equal(bearerFrom("Bearer  abc123 "), "abc123");
  assert.equal(bearerFrom(["Bearer first", "Bearer second"]), "first");
  assert.equal(bearerFrom("Basic abc123"), "");
  assert.equal(bearerFrom("bearer abc123"), "");
  assert.equal(bearerFrom(undefined), "");
  assert.equal(bearerFrom(""), "");
});

test("checkMcpToken: env ว่าง = disabled ไม่ว่าจะส่งอะไรมา (fail-closed)", () => {
  assert.equal(checkMcpToken("", ""), "disabled");
  assert.equal(checkMcpToken("anything", ""), "disabled");
});

test("checkMcpToken: ตรงเป๊ะเท่านั้นถึง ok", () => {
  const secret = "s3cr3t-token-with-64-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(checkMcpToken(secret, secret), "ok");
  assert.equal(checkMcpToken("", secret), "unauthorized");
  assert.equal(checkMcpToken(secret.slice(0, -1), secret), "unauthorized");
  assert.equal(checkMcpToken(secret + "x", secret), "unauthorized");
  assert.equal(checkMcpToken(secret.toUpperCase(), secret), "unauthorized");
});

test("checkMcpToken: ความยาวไม่เท่าไม่โยน (timingSafeEqual ต้องการ buffer เท่ากัน)", () => {
  assert.doesNotThrow(() => checkMcpToken("short", "much-longer-secret"));
  assert.equal(checkMcpToken("short", "much-longer-secret"), "unauthorized");
});
