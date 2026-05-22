import test from "node:test";
import assert from "node:assert/strict";
import { hasAdminAccess, canViewExampleReports } from "./adminAccess.js";

test("hasAdminAccess returns true for configured admin emails", () => {
  assert.equal(hasAdminAccess("ben20russell@gmail.com"), true);
  assert.equal(hasAdminAccess("CORINNE.APARIS@GMAIL.COM"), true);
  assert.equal(hasAdminAccess("corinne@corinneaparis.com"), true);
});

test("hasAdminAccess returns false for non-admin emails", () => {
  assert.equal(hasAdminAccess("person@example.com"), false);
  assert.equal(hasAdminAccess(""), false);
  assert.equal(hasAdminAccess(null), false);
});

test("canViewExampleReports allows admins even when assigned report is active", () => {
  assert.equal(
    canViewExampleReports({ email: "ben20russell@gmail.com", isReportActive: true }),
    true,
  );
});

test("canViewExampleReports allows all users when no active assigned report", () => {
  assert.equal(canViewExampleReports({ email: "person@example.com", isReportActive: false }), true);
});

test("canViewExampleReports blocks non-admins when assigned report is active", () => {
  assert.equal(canViewExampleReports({ email: "person@example.com", isReportActive: true }), false);
});
