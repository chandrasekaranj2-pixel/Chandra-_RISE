// This app has exactly one login (a user is admin, partner, or startup —
// never more than one role at a time), so — unlike the RIOS monorepo,
// which juggles several isolated module sessions in one browser tab —
// there's just one token/session here. No key-namespacing needed.
const TOKEN_KEY = "rise-gtm-token";
const USER_KEY = "rise-gtm-user";

// In local dev, Vite proxies /api/* to the backend (see vite.config.js) —
// no env var needed. In production, set VITE_API_URL at build time to the
// backend's public URL, e.g. https://rise-gtm-backend.onrender.com
const API_BASE = import.meta.env.VITE_API_URL || "";

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// 24 Nov 2026 (sheet 24-11, admin defect "session did not time out") — a
// 401 from any signed-in call means the server has ended this session
// (idle timeout, session lifetime, force sign-out, or Inactive). Before
// this, the app just showed the error text and kept looking signed in.
// Now the stored session is cleared and the app shell (App.jsx root)
// listens for this event and drops back to the login screen with the
// server's message. The /auth/request-code and /auth/verify-code calls
// are excluded: a 401 there just means "wrong code", not "signed out".
export const SESSION_EXPIRED_EVENT = "rise-session-expired";
function isSignInCall(path) {
  return path.startsWith("/auth/") && path !== "/auth/session-status" && path !== "/auth/me";
}
function handleUnauthorized(path, status, message) {
  if (status !== 401 || isSignInCall(path) || !getToken()) return;
  clearSession();
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }));
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch {}
    handleUnauthorized(path, res.status, message);
    throw new Error(message);
  }
  return res.json();
}

// Same as request(), but sends a FormData body (multipart/form-data) with
// no Content-Type header set manually — the browser fills in the boundary
// itself. Used for endpoints that accept file uploads (Supporting Material
// on Request Intro, 18 Sep 2026 addendum).
async function requestMultipart(path, { method = "POST", formData }) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: formData });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).error || message; } catch {}
    handleUnauthorized(path, res.status, message);
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  // 24 Nov 2026 CS batch — api.login (email + password) removed. Password
  // sign-in was already unreachable from the login screen for every role
  // (20 Nov 2026 decision), and the backend route it called is gone too.
  // "Sign in with Google" (CEO request, Nov 2026) — sends the ID token
  // Google's own button hands back; the backend verifies it and matches
  // the email to an existing partner/startup/admin record.
  googleLogin: (credential) => request("/auth/google", { method: "POST", body: { credential } }),
  // Passwordless email sign-in (CEO request, Nov 2026) — same idea, no
  // password: request a one-time code, then verify it to log in.
  requestLoginCode: (email) => request("/auth/request-code", { method: "POST", body: { email } }),
  verifyLoginCode: (email, code) => request("/auth/verify-code", { method: "POST", body: { email, code } }),
  me: () => request("/auth/me"),
  // Polled by the app shell; never counts as activity (see auth.js).
  sessionStatus: () => request("/auth/session-status"),

  getMe: () => request("/me"),
  getStartups: () => request("/startups"),
  getStartup: (id) => request(`/startups/${id}`),
  getRetailers: ({ mine } = {}) => request(`/retailers${mine ? "?mine=true" : ""}`),
  addRetailer: (payload) => request("/retailers", { method: "POST", body: payload }),
  // initiatedBy: "Startup" (Tab 1 — Retailer Introductions Requested) or
  // "RIV Admin" (Tab 2 — Retailer Introductions Initiated by RIV). Omit to
  // get everything (used elsewhere, e.g. the GTM partner's requests tab).
  getIntroductions: (initiatedBy) => request(`/introductions${initiatedBy ? `?initiatedBy=${encodeURIComponent(initiatedBy)}` : ""}`),
  getIntroduction: (id) => request(`/introductions/${id}`),
  createIntroduction: (payload) => request("/introductions", { method: "POST", body: payload }),
  // Startup's "Request Intro" only (18 Sep 2026 addendum — Supporting
  // Material is now real file uploads, not a URL field). `files` is a
  // plain array of File objects (max 3 — see App.jsx's
  // MAX_SUPPORTING_MATERIAL_FILES). Sent as multipart/form-data, unlike
  // plain createIntroduction above (still JSON, used by the GTM partner's
  // "Introduce Startup to Retailers" form, which has no file field).
  createIntroductionWithFiles: (payload, files = []) => {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      formData.append(key, value);
    });
    files.forEach((file) => formData.append("supportingMaterial", file));
    return requestMultipart("/introductions", { formData });
  },
  // 24 Sep 2026 addendum: Supporting Material is admin-viewing-only now —
  // the partner/startup-scoped GET /introductions/:id/supporting-material/:index
  // route this used to call has been removed from the backend entirely
  // (see portal.js). openSupportingMaterialAdmin below, hitting the
  // /api/admin/... route (19 Sep 2026 addendum — admin can view any
  // introduction's supporting material; GTM partner intentionally still
  // cannot, per RIV's explicit call), is the only way to open these files
  // now, for any role.
  async openSupportingMaterialAdmin(introId, index) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/admin/introductions/${introId}/supporting-material/${index}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = `Could not open file (${res.status})`;
      try { message = (await res.json()).error || message; } catch {}
      throw new Error(message);
    }
    window.open(res.url, "_blank", "noopener");
  },
  // "Confirm Introduction" (18 Sep 2026 feedback) — pairings proposed TO
  // the logged-in partner (by RIV or a startup) that are ready for them to
  // act on/log. Must be requested before /introductions/:id would ever be
  // needed for this list, same route-ordering reasoning as the backend.
  getConfirmQueue: () => request("/introductions/confirm-queue"),
  updateOpportunity: (id, payload) => request(`/introductions/${id}/opportunity`, { method: "PUT", body: payload }),
  // Startup Commit Status — startup-editable again (24 Sep 2026 addendum);
  // updateIntroductionAdmin's startupCommitStatus field below still works
  // too, as Admin's phone/email fallback — both write the same column.
  updateCommitStatus: (id, commitStatus) => request(`/introductions/${id}/commit-status`, { method: "PUT", body: { commitStatus } }),
  confirmRequest: (id) => request(`/introductions/${id}/confirm-request`, { method: "PUT" }),
  agreeIntroduction: (id) => request(`/introductions/${id}/agree`, { method: "PUT" }),
  // "Submit Proof of Startup-Retailer Introduction" (19 Sep 2026 feedback)
  // — proof is now an attached screenshot/PDF, not free text, so this
  // sends multipart/form-data (like createIntroductionWithFiles above)
  // instead of JSON. `proofFile` is a single File object.
  logIntroductionWithProof: (id, { channel, introductionDate, declarationAccepted }, proofFile) => {
    const formData = new FormData();
    if (channel) formData.append("channel", channel);
    if (introductionDate) formData.append("introductionDate", introductionDate);
    if (declarationAccepted) formData.append("declarationAccepted", "true");
    if (proofFile) formData.append("proofAttachment", proofFile);
    return requestMultipart(`/introductions/${id}/log-introduction`, { method: "PUT", formData });
  },
  async openProofAttachment(introId) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/introductions/${introId}/proof-attachment`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = `Could not open file (${res.status})`;
      try { message = (await res.json()).error || message; } catch {}
      throw new Error(message);
    }
    window.open(res.url, "_blank", "noopener");
  },
  // Admin-scoped equivalent, same reasoning as openSupportingMaterialAdmin.
  async openProofAttachmentAdmin(introId) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/admin/introductions/${introId}/proof-attachment`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = `Could not open file (${res.status})`;
      try { message = (await res.json()).error || message; } catch {}
      throw new Error(message);
    }
    window.open(res.url, "_blank", "noopener");
  },
  followUpIntroduction: (id, payload) => request(`/introductions/${id}/follow-up`, { method: "PUT", body: payload }),
  confirmSale: (id, payload) => request(`/introductions/${id}/confirm-sale`, { method: "PUT", body: payload }),
  closeIntroduction: (id, payload) => request(`/introductions/${id}/close`, { method: "PUT", body: payload }),
  getNotifications: () => request("/notifications"),
  ackNotification: (id) => request(`/notifications/${id}/ack`, { method: "PUT" }),

  // ---- Admin ----
  getSummary: () => request("/admin/summary"),
  // 24 Nov 2026 CS batch — `archived` (same convention as
  // listIntroductionsAdmin below): omit/false for the normal active list,
  // true to view the archive instead.
  listPartners: (archived) => request(`/admin/partners${archived ? "?archived=true" : ""}`),
  createPartner: (payload) => request("/admin/partners", { method: "POST", body: payload }),
  updatePartner: (id, payload) => request(`/admin/partners/${id}`, { method: "PUT", body: payload }),
  provisionPartnerLogin: (id) => request(`/admin/partners/${id}/provision-login`, { method: "POST" }),
  deletePartner: (id) => request(`/admin/partners/${id}`, { method: "DELETE" }),
  archivePartner: (id) => request(`/admin/partners/${id}/archive`, { method: "PUT" }),
  unarchivePartner: (id) => request(`/admin/partners/${id}/unarchive`, { method: "PUT" }),
  // 23 Nov 2026 CS batch — these were called by AdminPartnersView's/
  // AdminStartupsView's "Resend welcome email" buttons but never actually
  // defined here, so the partner button has been throwing a runtime error
  // ("api.resendPartnerWelcome is not a function") rather than resending
  // anything. The backend routes (POST /admin/partners|startups/:id/
  // send-welcome-email) already existed and worked; this was purely a
  // missing client-side wrapper.
  resendPartnerWelcome: (id) => request(`/admin/partners/${id}/send-welcome-email`, { method: "POST" }),
  resendStartupWelcome: (id) => request(`/admin/startups/${id}/send-welcome-email`, { method: "POST" }),
  // 24 Nov 2026 CS batch — session-security Phase 2's manual "Force
  // sign-out" button.
  forcePartnerSignOut: (id) => request(`/admin/partners/${id}/force-signout`, { method: "POST" }),
  forceStartupSignOut: (id) => request(`/admin/startups/${id}/force-signout`, { method: "POST" }),
  // 24 Nov 2026 CS batch — session-security Phase 3's admin settings screen.
  getSettings: () => request("/admin/settings"),
  updateSettings: (payload) => request("/admin/settings", { method: "PUT", body: payload }),
  listStartups: (archived) => request(`/admin/startups${archived ? "?archived=true" : ""}`),
  createStartup: (payload) => request("/admin/startups", { method: "POST", body: payload }),
  updateStartup: (id, payload) => request(`/admin/startups/${id}`, { method: "PUT", body: payload }),
  provisionStartupLogin: (id) => request(`/admin/startups/${id}/provision-login`, { method: "POST" }),
  deleteStartup: (id) => request(`/admin/startups/${id}`, { method: "DELETE" }),
  archiveStartup: (id) => request(`/admin/startups/${id}/archive`, { method: "PUT" }),
  unarchiveStartup: (id) => request(`/admin/startups/${id}/unarchive`, { method: "PUT" }),
  listRetailersAdmin: (archived) => request(`/admin/retailers${archived ? "?archived=true" : ""}`),
  createRetailer: (payload) => request("/admin/retailers", { method: "POST", body: payload }),
  updateRetailer: (id, payload) => request(`/admin/retailers/${id}`, { method: "PUT", body: payload }),
  deleteRetailer: (id) => request(`/admin/retailers/${id}`, { method: "DELETE" }),
  archiveRetailer: (id) => request(`/admin/retailers/${id}/archive`, { method: "PUT" }),
  unarchiveRetailer: (id) => request(`/admin/retailers/${id}/unarchive`, { method: "PUT" }),
  approveRetailer: (id) => request(`/admin/retailers/${id}/approve`, { method: "PUT" }),
  rejectRetailer: (id, reason) => request(`/admin/retailers/${id}/reject`, { method: "PUT", body: { reason } }),
  markRetailerInProcess: (id) => request(`/admin/retailers/${id}/mark-in-process`, { method: "PUT" }),
  // `archived` (item 12, 9 Oct 2026 batch): omit/false for the normal
  // active list, true to view the archive instead — mirrors the backend's
  // own default (archived_at IS NULL unless asked otherwise).
  listIntroductionsAdmin: (status, archived) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (archived) params.set("archived", "true");
    const qs = params.toString();
    return request(`/admin/introductions${qs ? `?${qs}` : ""}`);
  },
  createIntroductionAdmin: (payload) => request("/admin/introductions", { method: "POST", body: payload }),
  updateIntroductionAdmin: (id, payload) => request(`/admin/introductions/${id}`, { method: "PUT", body: payload }),
  approveIntroduction: (id) => request(`/admin/introductions/${id}/approve`, { method: "PUT" }),
  rejectIntroduction: (id) => request(`/admin/introductions/${id}/reject`, { method: "PUT" }),
  archiveIntroductionAdmin: (id) => request(`/admin/introductions/${id}/archive`, { method: "PUT" }),
  unarchiveIntroductionAdmin: (id) => request(`/admin/introductions/${id}/unarchive`, { method: "PUT" }),
  // RIV-direct proof logging (item 8) — same shape as logIntroductionWithProof
  // above but no declaration checkbox (admin is already trusted).
  logRivProof: (id, { channel, introductionDate }, proofFile) => {
    const formData = new FormData();
    if (channel) formData.append("channel", channel);
    if (introductionDate) formData.append("introductionDate", introductionDate);
    if (proofFile) formData.append("proofAttachment", proofFile);
    return requestMultipart(`/admin/introductions/${id}/log-riv-proof`, { method: "PUT", formData });
  },
  async openRivProofAttachmentAdmin(introId) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/admin/introductions/${introId}/riv-proof-attachment`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = `Could not open file (${res.status})`;
      try { message = (await res.json()).error || message; } catch {}
      throw new Error(message);
    }
    window.open(res.url, "_blank", "noopener");
  },
  listInvoices: () => request("/admin/invoices"),
  createInvoice: (payload) => request("/admin/invoices", { method: "POST", body: payload }),
  updateInvoice: (id, payload) => request(`/admin/invoices/${id}`, { method: "PUT", body: payload }),
  listPayouts: () => request("/admin/payouts"),
  createPayout: (payload) => request("/admin/payouts", { method: "POST", body: payload }),
  updatePayout: (id, payload) => request(`/admin/payouts/${id}`, { method: "PUT", body: payload }),
};
