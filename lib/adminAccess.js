export const ADMIN_EMAILS = [
  "ben20russell@gmail.com",
  "corinne.aparis@gmail.com",
  "corinne@corinneaparis.com",
];

const ADMIN_EMAIL_SET = new Set(ADMIN_EMAILS.map((email) => email.toLowerCase()));

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function hasAdminAccess(email) {
  return ADMIN_EMAIL_SET.has(normalizeEmail(email));
}

export function canViewExampleReports({ email, isReportActive }) {
  return !Boolean(isReportActive) || hasAdminAccess(email);
}
