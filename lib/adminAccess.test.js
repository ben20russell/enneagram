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

test("canViewExampleReports allows admins when authenticated", () => {
  assert.equal(
    canViewExampleReports({ email: "ben20russell@gmail.com", isAuthenticated: true }),
    true,
  );
});

test("canViewExampleReports allows all users when signed out", () => {
  assert.equal(canViewExampleReports({ email: "person@example.com", isAuthenticated: false }), true);
});

test("canViewExampleReports blocks non-admins when authenticated", () => {
  assert.equal(canViewExampleReports({ email: "person@example.com", isAuthenticated: true }), false);
});
