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
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  me: () => request("/auth/me"),

  getMe: () => request("/me"),
  getStartups: () => request("/startups"),
  getStartup: (id) => request(`/startups/${id}`),
  getRetailers: () => request("/retailers"),
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
  // The backend route redirects (302) to a short-lived signed Supabase
  // Storage URL. A plain <a href> can't carry the Authorization header
  // this route needs, so this fetches it manually (following the
  // redirect) and hands back the final URL for the caller to window.open.
  async openSupportingMaterial(introId, index) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/introductions/${introId}/supporting-material/${index}`, {
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
  updateCommitStatus: (id, commitStatus) => request(`/introductions/${id}/commit-status`, { method: "PUT", body: { commitStatus } }),
  confirmRequest: (id) => request(`/introductions/${id}/confirm-request`, { method: "PUT" }),
  agreeIntroduction: (id) => request(`/introductions/${id}/agree`, { method: "PUT" }),
  logIntroduction: (id, payload) => request(`/introductions/${id}/log-introduction`, { method: "PUT", body: payload }),
  followUpIntroduction: (id, payload) => request(`/introductions/${id}/follow-up`, { method: "PUT", body: payload }),
  confirmSale: (id, payload) => request(`/introductions/${id}/confirm-sale`, { method: "PUT", body: payload }),
  closeIntroduction: (id, payload) => request(`/introductions/${id}/close`, { method: "PUT", body: payload }),
  getNotifications: () => request("/notifications"),
  ackNotification: (id) => request(`/notifications/${id}/ack`, { method: "PUT" }),

  // ---- Admin ----
  getSummary: () => request("/admin/summary"),
  listPartners: () => request("/admin/partners"),
  createPartner: (payload) => request("/admin/partners", { method: "POST", body: payload }),
  updatePartner: (id, payload) => request(`/admin/partners/${id}`, { method: "PUT", body: payload }),
  provisionPartnerLogin: (id, password) => request(`/admin/partners/${id}/provision-login`, { method: "POST", body: { password } }),
  deletePartner: (id) => request(`/admin/partners/${id}`, { method: "DELETE" }),
  listStartups: () => request("/admin/startups"),
  createStartup: (payload) => request("/admin/startups", { method: "POST", body: payload }),
  updateStartup: (id, payload) => request(`/admin/startups/${id}`, { method: "PUT", body: payload }),
  provisionStartupLogin: (id, password) => request(`/admin/startups/${id}/provision-login`, { method: "POST", body: { password } }),
  deleteStartup: (id) => request(`/admin/startups/${id}`, { method: "DELETE" }),
  listRetailersAdmin: () => request("/admin/retailers"),
  createRetailer: (payload) => request("/admin/retailers", { method: "POST", body: payload }),
  updateRetailer: (id, payload) => request(`/admin/retailers/${id}`, { method: "PUT", body: payload }),
  deleteRetailer: (id) => request(`/admin/retailers/${id}`, { method: "DELETE" }),
  approveRetailer: (id) => request(`/admin/retailers/${id}/approve`, { method: "PUT" }),
  rejectRetailer: (id, reason) => request(`/admin/retailers/${id}/reject`, { method: "PUT", body: { reason } }),
  markRetailerInProcess: (id) => request(`/admin/retailers/${id}/mark-in-process`, { method: "PUT" }),
  listIntroductionsAdmin: (status) => request(`/admin/introductions${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createIntroductionAdmin: (payload) => request("/admin/introductions", { method: "POST", body: payload }),
  updateIntroductionAdmin: (id, payload) => request(`/admin/introductions/${id}`, { method: "PUT", body: payload }),
  approveIntroduction: (id) => request(`/admin/introductions/${id}/approve`, { method: "PUT" }),
  rejectIntroduction: (id) => request(`/admin/introductions/${id}/reject`, { method: "PUT" }),
  listInvoices: () => request("/admin/invoices"),
  createInvoice: (payload) => request("/admin/invoices", { method: "POST", body: payload }),
  updateInvoice: (id, payload) => request(`/admin/invoices/${id}`, { method: "PUT", body: payload }),
  listPayouts: () => request("/admin/payouts"),
  createPayout: (payload) => request("/admin/payouts", { method: "POST", body: payload }),
  updatePayout: (id, payload) => request(`/admin/payouts/${id}`, { method: "PUT", body: payload }),
};
