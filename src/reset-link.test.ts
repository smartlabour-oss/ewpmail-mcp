import { test } from "node:test";
import assert from "node:assert/strict";
import { extractResetLink } from "./reset-link.js";

test("extractResetLink pulls the sendgrid click url from the body", () => {
  const raw = "reset here: https://u56672202.ct.sendgrid.net/ls/click?upn=abc-123 thanks";
  assert.equal(extractResetLink(raw), "https://u56672202.ct.sendgrid.net/ls/click?upn=abc-123");
});

test("extractResetLink checks html when body has none", () => {
  const raw = `<a href="https://u56672202.ct.sendgrid.net/ls/click?x=1">reset</a>`;
  assert.equal(extractResetLink(raw), "https://u56672202.ct.sendgrid.net/ls/click?x=1");
});

test("extractResetLink returns null when no sendgrid link", () => {
  assert.equal(extractResetLink("no link here"), null);
});

test("extractResetLink finds the link inside an anchor href embedded in surrounding html", () => {
  const raw = `<table><tr><td><a href="https://u56672202.ct.sendgrid.net/ls/click?upn=abc&utm=1" style="color:red">Reset Password</a></td></tr></table>`;
  assert.equal(extractResetLink(raw), "https://u56672202.ct.sendgrid.net/ls/click?upn=abc&utm=1");
});
