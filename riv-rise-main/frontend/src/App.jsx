import React, { useState, useEffect, useCallback } from "react";
import {
  LogOut, Loader2, AlertCircle, Users, Building2, ArrowRight, Plus, X,
  FileText, DollarSign, Send, Briefcase, Handshake, ClipboardList,
  Paperclip, Trash2, CheckCircle2,
} from "lucide-react";
import {
  api, getStoredUser, setSession, clearSession,
} from "./api.js";
import { BRAND } from "./brand.js";

// RISE Portal — GTM Partner Introduction Workflow & Startup Introduction
// Request Workflow (PRD: "RISE Module", 10 Sep 2026). This is the root
// component of a standalone application (own repo, own backend, own
// database) — a separate app from the RIOS monorepo, under the same
// parent company (Retail Innovation Ventures / RIV), meant to live at
// rise.retailinnovation.ventures.

const FONT = "'Poppins',sans-serif";

// Same list as INTRODUCTION_STATUSES in backend/db.js — kept as a literal
// here (rather than fetched) since it's small and static.
const STATUS_COLORS = {
  "Requested": { bg: "#F3F1EE", fg: "#8A857F" },
  "Pending Startup Agreement": { bg: "#FFF4E0", fg: "#B8790A" },
  "Approved": { bg: "#E8F0FE", fg: BRAND.blue },
  "Introduced": { bg: "#E8F0FE", fg: BRAND.blue },
  "In Progress": { bg: "#FFF4E0", fg: "#B8790A" },
  "Closed - Won": { bg: "#E6F4EA", fg: "#1E7A34" },
  "Closed - Lost": { bg: "#FBEAEA", fg: BRAND.coralDark },
  "Stalled": { bg: "#F3F1EE", fg: "#8A857F" },
  "Invoiced": { bg: "#EFE9FB", fg: "#6B3FBF" },
  "Paid": { bg: "#E6F4EA", fg: "#1E7A34" },
  "Payout Complete": { bg: "#E6F4EA", fg: "#1E7A34" },
};

// Introduction Request Status (approval_status) — the new RIV approval
// chain, kept separate from STATUS_COLORS/legacy `status` above (see
// db.js's APPROVAL_STATUSES comment for why the two are different fields).
const APPROVAL_COLORS = {
  "Pending RIV Approval": { bg: "#FFF4E0", fg: "#B8790A" },
  "RIV Approved": { bg: "#E8F0FE", fg: BRAND.blue },
  "Rejected": { bg: "#FBEAEA", fg: BRAND.coralDark },
  "GTM Notified": { bg: "#E8F0FE", fg: BRAND.blue },
  "Startup Confirmed": { bg: "#EFE9FB", fg: "#6B3FBF" },
  "Introduced": { bg: "#E8F0FE", fg: BRAND.blue },
  "Proof Recorded": { bg: "#E6F4EA", fg: "#1E7A34" },
};
// 21 Sep 2026 addendum — the startup's "RIV Approval Status" column shows
// the real approval_status flag as-is (RIV's call), EXCEPT "GTM Notified":
// that's internal plumbing (RIV has approved and told the GTM partner) —
// from the startup's side it just reads as "RIV Approved". Admin/partner
// screens keep showing the raw "GTM Notified" flag; this relabeling is
// startup-display only.
function approvalStatusForStartup(approvalStatus) {
  return approvalStatus === "GTM Notified" ? "RIV Approved" : approvalStatus;
}
// Deal Status (18 Sep 2026 addendum — Startup Retailer Introductions
// two-tab split). Must match backend/db.js's DEAL_STATUSES exactly (kept
// as a literal here rather than fetched, same reasoning as STATUS_COLORS
// above).
const DEAL_STATUS_OPTIONS = ["Not Started", "In Discussion", "PoC/Evaluation", "Proposal", "Negotiation", "Closed - Won", "Closed - Lost", "Stalled"];

// Supporting Material upload (18 Sep 2026 addendum — real file upload,
// replacing the old free-text URL field). Must match
// backend/lib/supportingMaterialUpload.js exactly — keep the two in sync
// if this changes.
const MAX_SUPPORTING_MATERIAL_FILES = 3;
const MAX_FILE_SIZE_MB = 10;
const SUPPORTING_MATERIAL_ACCEPT = ".pdf,.ppt,.pptx,.doc,.docx";
const SUPPORTING_MATERIAL_EXTENSIONS = [".pdf", ".ppt", ".pptx", ".doc", ".docx"];
const DEAL_STATUS_COLORS = {
  "Not Started": { bg: "#F3F1EE", fg: "#8A857F" },
  "In Discussion": { bg: "#FFF4E0", fg: "#B8790A" },
  "PoC/Evaluation": { bg: "#FFF4E0", fg: "#B8790A" },
  "Proposal": { bg: "#E8F0FE", fg: BRAND.blue },
  "Negotiation": { bg: "#E8F0FE", fg: BRAND.blue },
  "Closed - Won": { bg: "#E6F4EA", fg: "#1E7A34" },
  "Closed - Lost": { bg: "#FBEAEA", fg: BRAND.coralDark },
  "Stalled": { bg: "#F3F1EE", fg: "#8A857F" },
};

// Startup Commit Status (Tab 2 — Retailer Introductions Initiated by RIV
// — only). Must match backend/db.js's COMMIT_STATUSES exactly.
const COMMIT_STATUS_OPTIONS = ["OK to introduce", "Already in touch", "Not a right customer"];
const COMMIT_STATUS_COLORS = {
  "OK to introduce": { bg: "#E6F4EA", fg: "#1E7A34" },
  "Already in touch": { bg: "#FFF4E0", fg: "#B8790A" },
  "Not a right customer": { bg: "#FBEAEA", fg: BRAND.coralDark },
};

// Retailer status colors (18 Sep 2026 feedback): Approved = green,
// In Process = yellow, Submitted for review (Prospect) = blue, Rejected =
// red. Duplicate keeps its own amber flag, distinct from In Process,
// since it's informational rather than a review stage.
const RETAILER_STATUS_COLORS = {
  "Active in network": { bg: "#E6F4EA", fg: "#1E7A34" },
  "In Process": { bg: "#FFF9DB", fg: "#8A6D00" },
  "Prospect": { bg: "#E8F0FE", fg: BRAND.blue },
  "Duplicate": { bg: "#FFF4E0", fg: "#B8790A" },
  "Rejected": { bg: "#FBEAEA", fg: BRAND.coralDark },
};
// Display-only label swap for the retailer status badge — the underlying
// value stays "Prospect" (schema/API), but the feedback wants it read as
// "Submitted for review" everywhere a partner or admin sees it.
const RETAILER_STATUS_LABELS = { "Prospect": "Submitted for review" };
function retailerStatusLabel(status) { return RETAILER_STATUS_LABELS[status] || status; }
// item 1 (25 Sep 2026 batch) — "My Retail Network" specific relabeling,
// distinct from retailerStatusLabel() above (used elsewhere, e.g. the
// startup's own view) and from the admin-facing labels (item 4, see
// ADMIN_RETAILER_STATUS_LABELS). Duplicate/Rejected are unchanged here.
const PARTNER_RETAILER_STATUS_LABELS = {
  "Prospect": "Submitted – Awaiting RIV Review",
  "In Process": "Under RIV Review",
  "Active in network": "Approved – Ready to Introduce",
};
function retailerStatusLabelForPartner(status) { return PARTNER_RETAILER_STATUS_LABELS[status] || status; }
// item 4 (25 Sep 2026 batch) — Admin Retailers tab's own status relabeling.
const ADMIN_RETAILER_STATUS_LABELS = {
  "Prospect": "New Submission",
  "In Process": "Under Review",
  "Active in network": "Approved",
  "Duplicate": "Duplicate – Compare Before Approving",
};
function retailerStatusLabelForAdmin(status) { return ADMIN_RETAILER_STATUS_LABELS[status] || status; }

// Simplified two-part status display (19 Sep 2026 feedback) — GTM/admin/
// startup all previously saw the raw approval_status chain (Pending RIV
// Approval / GTM Notified / Startup Confirmed / Proof Recorded / Rejected)
// and the separate legacy `status` column (Requested / Introduced / In
// Progress / ...) side by side, which was accurate but not businessfriendly.
// These two derived labels collapse each into a 2-3 value read the whole
// portal now shows consistently: "Introduction interest status" (from
// approval_status) and "Actual Introduction status" (from status). The
// underlying columns/values are unchanged — this is a display-only layer,
// so every other place that reads approval_status/status directly (e.g.
// gating which action a role can take) is untouched.
const INTEREST_STATUS_COLORS = {
  "Awaiting Startup interest": { bg: "#FFF4E0", fg: "#B8790A" },
  "Startup interested": { bg: "#EFE9FB", fg: "#6B3FBF" },
  "Startup Not interested": { bg: "#FBEAEA", fg: BRAND.coralDark },
};
function interestStatusFor(approvalStatus) {
  if (approvalStatus === "Rejected") return "Startup Not interested";
  if (["Startup Confirmed", "Introduced", "Proof Recorded"].includes(approvalStatus)) return "Startup interested";
  return "Awaiting Startup interest"; // Pending RIV Approval, RIV Approved, GTM Notified, anything else
}
const INTRODUCED_STATUS_COLORS = {
  "Yet to introduce": { bg: "#F3F1EE", fg: "#8A857F" },
  "Introduced": { bg: "#E8F0FE", fg: BRAND.blue },
};
// item 14 fix (25 Sep 2026 batch): a deal that has already reached a
// closed engagement_stage (Closed - Won/Lost, Stalled) must always read as
// "Introduced" here, even if the underlying `status` column was never
// advanced past a pre-introduction value — closed necessarily implies
// introduced. engagementStage is optional (older call sites can still omit
// it) so this stays backward compatible; pass it wherever available.
function introducedStatusFor(status, engagementStage) {
  if (["Closed - Won", "Closed - Lost", "Stalled"].includes(engagementStage)) return "Introduced";
  if (["Requested", "Pending Startup Agreement", "Approved"].includes(status)) return "Yet to introduce";
  return "Introduced"; // Introduced, In Progress, Closed - Won/Lost, Stalled, Invoiced, Paid, Payout Complete
}

/* =========================================================================
   UI PRIMITIVES
   ========================================================================= */
function PrimaryButton({ children, onClick, disabled, style, icon: Icon, type = "button" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
      fontFamily: FONT, fontWeight: 600, fontSize: 13.5, background: disabled ? "#E7B4B4" : BRAND.coral,
      color: "#fff", border: "none", borderRadius: 9, padding: "10px 18px",
      cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", ...style,
    }}>
      {Icon && <Icon size={14} />} {children}
    </button>
  );
}
function GhostButton({ children, onClick, style, icon: Icon, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
      fontFamily: FONT, fontWeight: 600, fontSize: 13, background: "#fff",
      color: disabled ? "#B7B2AE" : BRAND.ink, border: `1px solid ${BRAND.line}`, borderRadius: 9, padding: "9px 16px",
      cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", ...style,
    }}>
      {Icon && <Icon size={14} />} {children}
    </button>
  );
}
function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ border: `1px solid ${BRAND.line}`, borderRadius: 14, background: "#fff", ...style }}>{children}</div>;
}
function Field({ label, children, required, hint, style }) {
  return (
    <label style={{ display: "block", marginBottom: 16, ...style }}>
      <div style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: BRAND.ink, marginBottom: 6 }}>
        {label}{required && <span style={{ color: BRAND.coral }}> *</span>}
      </div>
      {children}
      {hint && <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#9B958F", marginTop: 5 }}>{hint}</div>}
    </label>
  );
}
const inputStyle = {
  width: "100%", fontFamily: FONT, fontSize: 13.5, padding: "10px 12px",
  borderRadius: 9, border: `1px solid ${BRAND.line}`, background: "#fff", color: BRAND.ink,
};
function ErrorBanner({ text }) {
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 12, background: "#FBEAEA", border: "1px solid #F3C6C6", marginBottom: 16 }}>
      <AlertCircle size={15} color={BRAND.coralDark} />
      <div style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>{text}</div>
    </div>
  );
}
// 9 Oct 2026 batch, item 1 — acknowledgement banner for a successful
// create action (new GTM partner, new retailer, etc.), same shape as
// ErrorBanner but green. Callers clear it themselves (e.g. on the next
// edit or after a short timeout) — see useSuccessMessage() below.
function SuccessBanner({ text }) {
  if (!text) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 12, background: "#E6F4EA", border: "1px solid #BFE3C9", marginBottom: 16 }}>
      <CheckCircle2 size={15} color="#1E7A34" />
      <div style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>{text}</div>
    </div>
  );
}
// Small helper: holds a success message and auto-clears it after a few
// seconds, so callers don't have to manage their own timers.
function useSuccessMessage() {
  const [message, setMessage] = useState("");
  function show(text) {
    setMessage(text);
    setTimeout(() => setMessage((m) => (m === text ? "" : m)), 4000);
  }
  return [message, show];
}
function Spinner({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", padding: "60px 20px", fontFamily: FONT, fontSize: 13, color: "#9B958F" }}>
      <Loader2 size={16} className="gtm-portal-spin" /> {label || "Loading…"}
    </div>
  );
}
function EmptyState({ icon: Icon, title, text }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", border: `1px dashed ${BRAND.line}`, borderRadius: 14 }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: BRAND.cream, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", border: `1px solid ${BRAND.line}` }}>
        <Icon size={20} color={BRAND.coral} />
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 15, color: BRAND.ink }}>{title}</div>
      <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#9B958F", marginTop: 6, maxWidth: 360, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}
function StatusBadge({ status, colors = STATUS_COLORS, label }) {
  const c = colors[status] || { bg: "#F3F1EE", fg: "#8A857F" };
  return (
    <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 11, padding: "4px 10px", borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>
      {label || status}
    </span>
  );
}
function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(39,37,37,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: width, maxHeight: "88vh", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 17, color: BRAND.ink }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9B958F" }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function money(n) {
  if (n === null || n === undefined || n === "") return "—";
  return `₹${Number(n).toLocaleString("en-IN")}`;
}
// Expected GTM Success Fee only (19 Sep 2026 feedback) — the underlying
// partner_fee_amount is stored/computed in ₹ same as every other amount
// in this app; this converts just that one display to $ at a fixed
// ₹83 = $1 rate. Nothing else in the app uses this — everywhere else
// still shows ₹ via money() above.
const USD_PER_INR = 1 / 83;
function usdFee(n) {
  if (n === null || n === undefined || n === "") return "—";
  return `$${(Number(n) * USD_PER_INR).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dateStr(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/* =========================================================================
   LOGIN
   ========================================================================= */
function LoginView({ onAuthed }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const { token, user } = await api.login(email.trim(), password);
      if (!["partner", "startup", "admin"].includes(user.role)) {
        throw new Error("This login doesn't have RISE Portal access.");
      }
      setSession(token, user);
      onAuthed(user);
    } catch (err) {
      setError(err.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BRAND.cream, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img src="/riv-logo-full.png" alt="Retail Innovation Ventures" style={{ height: 48, marginBottom: 10 }} />
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 22, color: BRAND.ink }}>RISE Portal</div>
          <div style={{ fontFamily: FONT, fontSize: 13, color: "#9B958F", marginTop: 6 }}>Retail Innovation Scaling Engine</div>
        </div>
        <Card style={{ padding: 26 }}>
          <form onSubmit={submit}>
            <ErrorBanner text={error} />
            <Field label="Email" required>
              <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password" required>
              <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <PrimaryButton type="submit" disabled={loading} style={{ width: "100%", padding: "12px 18px" }}>
              {loading ? "Signing in…" : "Sign in"}
            </PrimaryButton>
          </form>
        </Card>
      </div>
    </div>
  );
}

/* =========================================================================
   NAV
   ========================================================================= */
// Shared by NavBar (the tab strip) and the page header (the title above
// each view) so a tab's label only has to be written once.
function navItemsFor(role) {
  return role === "partner" ? [
    { id: "startups", label: "RIV Portfolio Startups" }, { id: "retailers", label: "My Retail Network" },
    { id: "introduce", label: "Introduce Startup to Retailers" }, { id: "dashboard", label: "Dashboard" },
  ] : role === "startup" ? [
    { id: "retailers", label: "Retailer Directory" },
    { id: "introductions-requested", label: "Retailer Introductions Requested" },
    { id: "introductions-initiated", label: "Retailer Introductions Initiated by RIV" },
  ] : [
    { id: "overview", label: "Overview" }, { id: "partners", label: "Partners" }, { id: "startups", label: "Startups" },
    { id: "retailers", label: "Retailers" }, { id: "introductions", label: "Introductions" },
    { id: "invoices", label: "Invoices" }, { id: "payouts", label: "Payouts" },
  ];
}

function NavBar({ view, setView, user, onLogout }) {
  const items = navItemsFor(user.role);
  return (
    <div style={{ borderBottom: `1px solid ${BRAND.line}`, background: "#fff", position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 62 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: BRAND.ink, display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/riv-logo-full.png" alt="Retail Innovation Ventures" style={{ height: 26 }} />
            RISE Portal
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {items.map((it) => (
              <button key={it.id} onClick={() => setView(it.id)} style={{
                fontFamily: FONT, fontWeight: 600, fontSize: 13, padding: "8px 12px", borderRadius: 8,
                border: "none", cursor: "pointer",
                background: view === it.id ? BRAND.cream : "transparent",
                color: view === it.id ? BRAND.coral : "#7A756F",
              }}>
                {it.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#7A756F" }}>{user.name}</div>
          <GhostButton onClick={onLogout} icon={LogOut} style={{ padding: "8px 12px" }}>Log out</GhostButton>
        </div>
      </div>
    </div>
  );
}
/* =========================================================================
   SHARED: introduction cards + detail drawer
   ========================================================================= */
function IntroCard({ intro, onOpen }) {
  return (
    <Card onClick={() => onOpen(intro)} style={{ padding: 16, cursor: "pointer", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>
            {intro.startup_name} <ArrowRight size={12} style={{ margin: "0 4px", verticalAlign: "middle" }} /> {intro.retailer_name}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 4 }}>
            {intro.partner_name ? `via ${intro.partner_name}` : "RIV direct"} · Requested {dateStr(intro.request_date)}
            {intro.deal_value ? ` · Deal ${money(intro.deal_value)}` : ""}
          </div>
        </div>
        <StatusBadge status={intro.status} />
      </div>
    </Card>
  );
}

// item 15/2b helper — "Initiated by: ..." label, shared by the GTM
// partner's unified feed, the Partner Dashboard tags, and this modal's
// own "Initiated by" row. "RIV Admin" reads as "RIV" everywhere a human
// sees it; the raw value is unchanged.
function initiatorLabel(initiatedBy) {
  return initiatedBy === "RIV Admin" ? "RIV" : initiatedBy;
}

// item 5 (25 Sep 2026 batch) — consolidated introduction detail modal,
// replacing the two previous components (the legacy action-taking
// IntroDetailModal, used via root's openIntro state for partner/startup,
// and the admin-only read-only IntroViewDetailsModal with its
// isAdmin-hardcoded-true file-list gating). isAdmin is now a real prop
// every call site passes explicitly. `user` is optional — when present
// (today, only the GTM partner's "Check Introduction Interest" list),
// the interactive follow-up/confirm-sale/confirm-introduction actions
// from the old IntroDetailModal render for that partner/startup; call
// sites that only need a read-only "View Details" (items 6, 7, and
// admin's own use) omit `user` and get pure display, same as the old
// IntroViewDetailsModal did.
function IntroDetailModal({ intro, onClose, isAdmin = false, user, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [engagementStage, setEngagementStage] = useState(intro.engagement_stage || "");
  const [dealValue, setDealValue] = useState("");
  const [poDocument, setPoDocument] = useState("");
  const [proofFileError, setProofFileError] = useState("");
  const [rivProofFileError, setRivProofFileError] = useState("");
  const [fileError, setFileError] = useState("");

  const isPartner = !isAdmin && user?.role === "partner";
  const isStartup = !isAdmin && user?.role === "startup";
  const isRivInitiated = intro.initiated_by === "RIV Admin";

  async function run(fn) {
    setError(""); setBusy(true);
    try { await fn(); if (onRefresh) await onRefresh(); onClose(); }
    catch (err) { setError(err.message || "Something went wrong."); }
    finally { setBusy(false); }
  }

  // 19 Sep 2026 feedback — logging proof of introduction moved out of this
  // modal onto its own page-level "Submit Proof of Startup-Retailer
  // Introduction" section (see SubmitProofOfIntroductionSection), since
  // proof is now an attached file rather than free text. This modal just
  // shows what was logged, with a link to open the attachment.
  function openProofFile() {
    setProofFileError("");
    const opener = isAdmin ? api.openProofAttachmentAdmin : api.openProofAttachment;
    opener(intro.id).catch((e) => setProofFileError(e.message));
  }
  // item 3 (25 Sep 2026 batch) — RIV-direct proof (item 8), admin-only.
  function openRivProofFile() {
    setRivProofFileError("");
    api.openRivProofAttachmentAdmin(intro.id).catch((e) => setRivProofFileError(e.message));
  }
  function openSupportingFile(index) {
    if (!isAdmin) return;
    setFileError("");
    api.openSupportingMaterialAdmin(intro.id, index).catch((e) => setFileError(e.message));
  }

  const rows = [
    ["Retailer", intro.retailer_name],
    ["Startup", intro.startup_name],
    ["Category", intro.retailer_category],
    ["Network", intro.partner_name ? `via ${intro.partner_name}` : "RIV direct"],
    ["Initiated by", initiatorLabel(intro.initiated_by)],
    [isRivInitiated ? "Initiated Date" : "Requested Date", dateStr(intro.request_date)],
    ...(isRivInitiated ? [] : [["Introduction interest status", interestStatusFor(intro.approval_status)]]),
    ["Actual Introduction status", introducedStatusFor(intro.status, intro.engagement_stage)],
    ["Deal Status", intro.engagement_stage || "—"],
    ["Opportunity Value", opportunityMoney(intro.opportunity_value)],
    ["Startup Commit Status", intro.startup_commit_status || "Not yet responded"],
    ["Last Updated", `${dateStr(intro.updated_at)}${intro.updated_by ? ` · ${intro.updated_by}` : ""}`],
  ];
  const requestRows = [
    ["Why interested", intro.why_interested],
    ["Problem solved for enterprise", intro.problem_solved],
    ["Relevant product/offering", intro.relevant_offering],
    ["Desired buyer persona", intro.buyer_persona],
    ["Previously engaged", intro.previously_engaged === null ? null : (intro.previously_engaged ? "Yes" : "No")],
    ["Prior engagement details", intro.prior_engagement_details],
    // Pre-18-Sep-2026 rows only, from back when this was a free-text URL
    // field — new submissions use the uploaded-file list rendered below.
    // 24 Sep 2026 addendum: admin-viewing-only, like the file list below.
    ...(isAdmin ? [["Supporting material (link)", intro.supporting_material_url]] : []),
    ["Opportunity context", intro.gtm_context_note],
    ["How the partner introduced this", intro.how_introduced],
  ].filter(([, v]) => v);
  const proofRows = [
    ["Channel", intro.channel],
    ["Introduction date", intro.introduction_date ? dateStr(intro.introduction_date) : null],
    ["Proof of introduction", intro.proof_of_introduction],
  ].filter(([, v]) => v);
  // 24 Sep 2026 addendum: Supporting Material is admin-viewing-only — the
  // actual file list only ever arrives for isAdmin (see publicIntro() in
  // portal.js), so gate on isAdmin here too rather than relying solely on
  // what the API happened to send.
  const supportingMaterialFiles = isAdmin ? (intro.supporting_material || []) : [];
  const supportingMaterialCount = isAdmin
    ? supportingMaterialFiles.length
    : (intro.supporting_material_count || 0);
  // item 3 (25 Sep 2026 batch) — "Proof submitted" line: partner-submitted
  // proof (approval_status = 'Proof Recorded') uses the ordinary proof
  // viewer; RIV-direct proof (item 8, riv_proof_attachment) uses its own
  // admin route instead — a RIV-direct intro can be at 'Proof Recorded'
  // too, so check the RIV-direct attachment first.
  const hasRivProof = isAdmin && !!intro.riv_proof_attachment;
  const showProofSubmittedLine = isAdmin && (intro.approval_status === "Proof Recorded" || hasRivProof) && intro.channel;

  return (
    <Modal title={`${intro.startup_name} → ${intro.retailer_name}`} onClose={onClose} width={560}>
      <ErrorBanner text={error} />

      {/* item 13b — amber duplicate-pairing warning, admin only (mirrors
          AdminRetailersView's retailer-duplicate banner style/copy). */}
      {isAdmin && intro.duplicate_of_introduction_id && (
        <div style={{ fontFamily: FONT, fontSize: 12, color: "#8A6D00", background: "#FFF9DB", borderRadius: 10, padding: "10px 14px", marginBottom: 16, lineHeight: 1.6 }}>
          <strong>Possible duplicate</strong> — {intro.startup_name} was already introduced to {intro.retailer_name} on {dateStr(intro.duplicate_of_request_date)}, currently {interestStatusFor(intro.duplicate_of_approval_status)} (Initiated by {initiatorLabel(intro.duplicate_of_initiated_by)}). Review before approving.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <StatusBadge status={interestStatusFor(intro.approval_status)} colors={INTEREST_STATUS_COLORS} />
        <StatusBadge status={introducedStatusFor(intro.status, intro.engagement_stage)} colors={INTRODUCED_STATUS_COLORS} />
        {intro.engagement_stage && <StatusBadge status={intro.engagement_stage} />}
      </div>

      {intro.deal_value && (
        <div style={{ display: "flex", gap: 20, marginBottom: 18, padding: "12px 14px", background: BRAND.cream, borderRadius: 10, flexWrap: "wrap" }}>
          <div><div style={{ fontFamily: FONT, fontSize: 11, color: "#9B958F" }}>Deal value</div><div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14 }}>{money(intro.deal_value)}</div></div>
          <div><div style={{ fontFamily: FONT, fontSize: 11, color: "#9B958F" }}>Fee due to RIV</div><div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14 }}>{money(intro.fee_amount_due)}</div></div>
          {intro.initiated_by === "GTM Partner" && intro.partner_fee_amount != null && (
            <div><div style={{ fontFamily: FONT, fontSize: 11, color: "#9B958F" }}>Expected GTM Success Fee ({intro.partner_fee_pct}%)</div><div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: "#1E7A34" }}>{money(intro.partner_fee_amount)}</div></div>
          )}
        </div>
      )}

      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${BRAND.line}` }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>{label}</div>
          <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: BRAND.ink, textAlign: "right" }}>{value}</div>
        </div>
      ))}

      {/* item 3 — "Proof submitted" audit line, admin only. */}
      {showProofSubmittedLine && (
        <div style={{ marginTop: 14, fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>
          <strong>Proof submitted</strong> — {intro.channel}, {dateStr(intro.introduction_date)}
          {" · "}
          <button
            type="button"
            onClick={hasRivProof ? openRivProofFile : openProofFile}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: FONT, fontSize: 12.5, color: BRAND.coral, textDecoration: "underline" }}
          >
            View proof
          </button>
          {rivProofFileError && <div style={{ fontFamily: FONT, fontSize: 11.5, color: BRAND.coralDark, marginTop: 4 }}>{rivProofFileError}</div>}
        </div>
      )}

      {intro.proof_of_introduction && !showProofSubmittedLine && (
        <div style={{ marginTop: 14, fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>
          <strong>Proof of introduction</strong> ({intro.channel}, {dateStr(intro.introduction_date)}): {intro.proof_of_introduction}
          {intro.proof_attachment && (
            <>
              {" — "}
              <button
                type="button"
                onClick={openProofFile}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: FONT, fontSize: 12.5, color: BRAND.coral, textDecoration: "underline" }}
              >
                view attachment
              </button>
            </>
          )}
          {proofFileError && <div style={{ fontFamily: FONT, fontSize: 11.5, color: BRAND.coralDark, marginTop: 4 }}>{proofFileError}</div>}
        </div>
      )}
      {/* Non-admin: once proof is recorded, the same file is openable via
          the owner-scoped route (item 6 — "View proof", no admin auth
          needed). */}
      {!isAdmin && intro.approval_status === "Proof Recorded" && (
        <div style={{ marginTop: 14 }}>
          <GhostButton onClick={openProofFile}>View proof</GhostButton>
          {proofFileError && <div style={{ fontFamily: FONT, fontSize: 11.5, color: BRAND.coralDark, marginTop: 6 }}>{proofFileError}</div>}
        </div>
      )}

      {!!requestRows.length && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, marginBottom: 10 }}>
            {isRivInitiated ? "Opportunity context" : "Original request"}
          </div>
          {requestRows.map(([label, value]) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 11, color: "#9B958F", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>{label}</div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: BRAND.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {!!proofRows.length && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, marginBottom: 10 }}>Supporting documents</div>
          {proofRows.map(([label, value]) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 11, color: "#9B958F", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 }}>{label}</div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: BRAND.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{value}</div>
            </div>
          ))}
          {isAdmin && intro.proof_attachment && (
            <button
              type="button"
              onClick={openProofFile}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                background: "none", border: `1px solid ${BRAND.line}`, borderRadius: 9, padding: "8px 10px",
                cursor: "pointer", fontFamily: FONT, fontSize: 12.5, color: BRAND.coral,
              }}
            >
              <Paperclip size={13} /> {intro.proof_attachment.name}
            </button>
          )}
        </div>
      )}

      {isAdmin && !!supportingMaterialFiles.length && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, marginBottom: 10 }}>Supporting material</div>
          {fileError && <div style={{ fontFamily: FONT, fontSize: 11.5, color: BRAND.coralDark, marginBottom: 8 }}>{fileError}</div>}
          {supportingMaterialFiles.map((file, i) => (
            <button
              key={i}
              type="button"
              onClick={() => openSupportingFile(i)}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                background: "none", border: `1px solid ${BRAND.line}`, borderRadius: 9, padding: "8px 10px",
                marginBottom: 6, cursor: "pointer", fontFamily: FONT, fontSize: 12.5, color: BRAND.coral,
              }}
            >
              <Paperclip size={13} /> {file.name}
            </button>
          ))}
        </div>
      )}

      {/* 24 Sep 2026 addendum: non-admin (partner/startup) never sees the
          actual files or a way to open them — just a count. Item 6:
          "Must NOT show supporting material files". */}
      {!isAdmin && supportingMaterialCount > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, marginBottom: 6 }}>Supporting material</div>
          <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#9B958F" }}>
            {supportingMaterialCount} file{supportingMaterialCount === 1 ? "" : "s"} attached — viewable by RIV admin only.
          </div>
        </div>
      )}

      {!!intro.follow_up_log?.length && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, marginBottom: 8 }}>Follow-up log</div>
          {intro.follow_up_log.map((f, i) => (
            <div key={i} style={{ fontFamily: FONT, fontSize: 12, color: "#7A756F", padding: "8px 0", borderTop: i ? `1px solid ${BRAND.line}` : "none" }}>
              <span style={{ color: "#B7B2AE" }}>{dateStr(f.date)} — {f.author}:</span> {f.note}
            </div>
          ))}
        </div>
      )}

      {/* Everything below is the interactive partner/startup action set
          from the old IntroDetailModal — only rendered when a `user` is
          passed in (today: the GTM partner's "Check Introduction
          Interest" list). A plain "View Details" call site (items 6, 7,
          and admin) passes no `user` and gets none of this — display only,
          same as the old IntroViewDetailsModal's "no actions here on
          purpose" design. */}
      {user && (
        <>
          {isStartup && intro.approval_status === "GTM Notified" && (
            <Card style={{ padding: 14, marginTop: 18, background: "#FFF9F0" }}>
              <div style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink, marginBottom: 10, lineHeight: 1.6 }}>
                RIV has approved this request and notified {intro.partner_name || "RIV Ops"}. Confirm to let them make the introduction.
              </div>
              <PrimaryButton disabled={busy} onClick={() => run(() => api.confirmRequest(intro.id))}>Confirm introduction</PrimaryButton>
            </Card>
          )}
          {intro.approval_status === "Pending RIV Approval" && (
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#B8790A", padding: "10px 14px", background: "#FFF4E0", borderRadius: 10, marginTop: 18 }}>
              Waiting on RIV's review before this moves forward.
            </div>
          )}
          {intro.approval_status === "Rejected" && (
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.coralDark, padding: "10px 14px", background: "#FBEAEA", borderRadius: 10, marginTop: 18 }}>
              RIV declined this request.
            </div>
          )}

          {/* Partner logs proof once the startup has confirmed — moved to
              the page-level "Submit Proof of Startup-Retailer
              Introduction" section (19 Sep 2026 feedback); this modal
              just points there. */}
          {isPartner && intro.approval_status === "Startup Confirmed" && (
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#B8790A", padding: "10px 14px", background: "#FFF4E0", borderRadius: 10, marginTop: 18 }}>
              The startup has confirmed — log this introduction from "Submit Proof of Startup-Retailer Introduction" on the Introduce Startup to Retailers page.
            </div>
          )}

          {/* Follow-up (either party, once Introduced/In Progress) */}
          {(isPartner || isStartup) && ["Introduced", "In Progress"].includes(intro.status) && (
            <Card style={{ padding: 14, marginTop: 18 }}>
              <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, marginBottom: 10 }}>Add a follow-up</div>
              <Field label="Engagement stage">
                <select style={inputStyle} value={engagementStage} onChange={(e) => setEngagementStage(e.target.value)}>
                  <option value="">— unchanged —</option>
                  <option>In discussion</option><option>Piloting</option><option>Stalled</option><option>Won</option><option>Lost</option>
                </select>
              </Field>
              <Field label="Note" required>
                <textarea style={{ ...inputStyle, minHeight: 60 }} value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} />
              </Field>
              <div style={{ display: "flex", gap: 8 }}>
                <PrimaryButton disabled={busy || !followUpNote} onClick={() => run(() => api.followUpIntroduction(intro.id, { note: followUpNote, engagementStage: engagementStage || undefined }))}>Save follow-up</PrimaryButton>
                <GhostButton disabled={busy} onClick={() => run(() => api.closeIntroduction(intro.id, { outcome: "Lost" }))}>Mark lost</GhostButton>
                <GhostButton disabled={busy} onClick={() => run(() => api.closeIntroduction(intro.id, { outcome: "Stalled" }))}>Mark stalled</GhostButton>
              </div>
            </Card>
          )}

          {/* Startup confirms the sale */}
          {isStartup && ["Introduced", "In Progress"].includes(intro.status) && (
            <Card style={{ padding: 14, marginTop: 18 }}>
              <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, marginBottom: 10 }}>Confirm a closed sale</div>
              <Field label="Deal value (₹)" required>
                <input style={inputStyle} type="number" min="0" value={dealValue} onChange={(e) => setDealValue(e.target.value)} />
              </Field>
              <Field label="PO / sale document" required hint="Paste a link, reference number, or short description.">
                <input style={inputStyle} value={poDocument} onChange={(e) => setPoDocument(e.target.value)} />
              </Field>
              <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#9B958F", marginBottom: 12 }}>
                RIV's closure fee ({intro.closure_rate}%) will apply: {dealValue ? money(Number(dealValue) * intro.closure_rate / 100) : "—"}
              </div>
              <PrimaryButton disabled={busy || !dealValue || !poDocument} onClick={() => run(() => api.confirmSale(intro.id, { dealValue: Number(dealValue), poDocument }))}>Confirm sale — Closed, Won</PrimaryButton>
            </Card>
          )}

          {intro.status === "Closed - Won" && (
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#1E7A34", padding: "10px 14px", background: "#E6F4EA", borderRadius: 10, marginTop: 18 }}>
              Deal closed — invoicing and payout are handled by RIV Admin.
            </div>
          )}
        </>
      )}

      {!requestRows.length && !proofRows.length && !supportingMaterialCount && !intro.follow_up_log?.length && !user && (
        <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#9B958F", marginTop: 14 }}>No supporting documents on file yet.</div>
      )}
    </Modal>
  );
}

/* =========================================================================
   PARTNER VIEWS
   ========================================================================= */
function PartnerStartupsView({ onViewDetails }) {
  const [startups, setStartups] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.getStartups().then((r) => setStartups(r.startups)).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBanner text={error} />;
  if (!startups) return <Spinner />;
  if (!startups.length) return <EmptyState icon={Briefcase} title="No onboarded startups yet" text="RIV Admin onboards RISE startups before they appear here." />;
  return (
    <div>
      {startups.map((s) => (
        <Card key={s.id} style={{ padding: 16, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{s.startup_name}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>{s.sector}</div>
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#7A756F", marginTop: 6, maxWidth: 480 }}>{s.solution_summary}</div>
          </div>
          <GhostButton onClick={() => onViewDetails(s.id)} style={{ flexShrink: 0 }}>View Details</GhostButton>
        </Card>
      ))}
    </div>
  );
}

// Startup Detail View (addendum §4) — the profile a GTM partner reviews
// before deciding whether to back an introduction. Same modal serves
// admin's own read of a startup's profile.
function StartupDetailModal({ startupId, onClose }) {
  const [startup, setStartup] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.getStartup(startupId).then((r) => setStartup(r.startup)).catch((e) => setError(e.message)); }, [startupId]);

  const rows = startup ? [
    ["Legal entity", startup.legal_entity],
    ["Website", startup.website],
    ["Based out of", [startup.city, startup.hq_country].filter(Boolean).join(", ")],
    ["Year incorporated", startup.year_incorporated],
    ["Sector", startup.sector],
    ["Founding team", startup.founding_team_details],
    ["Problem", startup.problem_description],
    ["Solution", startup.solution_description],
    ["Top 3 benefits", startup.top_benefits],
    ["Tech stack", startup.tech_stack],
    ["Sub-vertical", startup.sub_vertical],
    ["Competition", startup.competition],
    ["Competitive advantage", startup.competitive_advantage],
    ["Paying customers", startup.paying_customer_count],
    ["Notable customers", startup.notable_customers],
    ["Key milestones", startup.key_milestones],
    ["Past funding raised", startup.past_fund_raised],
    ["Currently raising capital", startup.currently_raising_capital],
    ["Interested in RIV fundraising support", startup.fundraising_support_interest],
    ["Anything else", startup.additional_notes],
  ] : [];

  return (
    <Modal title={startup ? startup.startup_name : "Startup details"} onClose={onClose} width={560}>
      <ErrorBanner text={error} />
      {!startup && !error ? <Spinner /> : startup && (
        <div>
          {startup.solution_summary && (
            <div style={{ fontFamily: FONT, fontSize: 13, color: "#7A756F", marginBottom: 16, lineHeight: 1.6 }}>{startup.solution_summary}</div>
          )}
          {rows.filter(([, v]) => v).map(([label, value]) => (
            <div key={label} style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 11.5, color: "#9B958F", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: BRAND.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{value}</div>
            </div>
          ))}
          {!rows.some(([, v]) => v) && (
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#9B958F" }}>RIV hasn't filled in this startup's full profile yet.</div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* =========================================================================
   STARTUP VIEWS
   ========================================================================= */
// Request Intro popup (addendum §2) — fields match the Google Sheet/
// tracker's Request Intro questionnaire exactly, plus a mandatory T&C
// consent checkbox at the bottom.
// Supporting Material file picker (18 Sep 2026 addendum — real upload,
// replacing the old free-text URL field) — up to
// MAX_SUPPORTING_MATERIAL_FILES files, client-side type/size/count
// validation mirroring the backend's (backend/lib/supportingMaterialUpload.js
// has the enforced version; this is just to fail fast with a friendlier
// message before upload).
function SupportingMaterialUpload({ files, onChange }) {
  const [error, setError] = useState("");
  const inputRef = React.useRef(null);

  function addFiles(fileList) {
    setError("");
    const incoming = Array.from(fileList);
    const room = MAX_SUPPORTING_MATERIAL_FILES - files.length;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_SUPPORTING_MATERIAL_FILES} files.`);
      return;
    }
    const accepted = [];
    for (const file of incoming) {
      const ext = "." + file.name.split(".").pop().toLowerCase();
      if (!SUPPORTING_MATERIAL_EXTENSIONS.includes(ext)) {
        setError(`"${file.name}" isn't a supported format (PDF, PPT/PPTX, DOC/DOCX only).`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(`"${file.name}" is over the ${MAX_FILE_SIZE_MB} MB limit.`);
        continue;
      }
      if (accepted.length >= room) {
        setError(`You can attach up to ${MAX_SUPPORTING_MATERIAL_FILES} files.`);
        break;
      }
      accepted.push(file);
    }
    if (accepted.length) onChange([...files, ...accepted]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeFile(index) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <Field label="Supporting material" hint={`PDF, PPT/PPTX, or DOC/DOCX · up to ${MAX_SUPPORTING_MATERIAL_FILES} files · ${MAX_FILE_SIZE_MB} MB each`}>
      {error && <div style={{ fontFamily: FONT, fontSize: 11.5, color: BRAND.coralDark, marginBottom: 8 }}>{error}</div>}
      {files.map((file, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `1px solid ${BRAND.line}`, borderRadius: 9, marginBottom: 6 }}>
          <Paperclip size={13} color="#9B958F" />
          <span style={{ flex: 1, fontFamily: FONT, fontSize: 12.5, color: BRAND.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          <span style={{ fontFamily: FONT, fontSize: 11, color: "#B7B2AE" }}>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
          <button type="button" onClick={() => removeFile(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#B7B2AE", display: "flex" }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {files.length < MAX_SUPPORTING_MATERIAL_FILES && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%",
            fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.coral, background: BRAND.cream,
            border: `1px dashed ${BRAND.coral}`, borderRadius: 9, padding: "10px 12px", cursor: "pointer",
          }}
        >
          <Paperclip size={14} /> {files.length ? "Add another file" : "Upload supporting material"}
        </button>
      )}
      <input
        ref={inputRef} type="file" multiple accept={SUPPORTING_MATERIAL_ACCEPT}
        style={{ display: "none" }} onChange={(e) => e.target.files.length && addFiles(e.target.files)}
      />
    </Field>
  );
}

function RequestIntroductionModal({ retailer, onClose, onCreated }) {
  const [form, setForm] = useState({
    whyInterested: "", problemSolved: "", relevantOffering: "", buyerPersona: "",
    previouslyEngaged: false, priorEngagementDetails: "",
  });
  const [files, setFiles] = useState([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
    setError(""); setBusy(true);
    try {
      await api.createIntroductionWithFiles({ retailerId: retailer.id, ...form, consentAccepted: consent }, files);
      await onCreated();
      setSubmitted(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (submitted) {
    return (
      <Modal title="Introduction Request Submitted" onClose={onClose} width={480}>
        <div style={{ textAlign: "center", padding: "12px 4px 4px" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#E6F4EA", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <CheckCircle2 size={24} color="#1E7A34" />
          </div>
          <div style={{ fontFamily: FONT, fontSize: 13.5, color: BRAND.ink, lineHeight: 1.7 }}>
            Thank you. Your introduction request has been successfully submitted to RIV.
            Our team will review the request and proceed with the introduction process. You will receive an email confirmation with the request details and next steps.
          </div>
          <PrimaryButton onClick={onClose} style={{ width: "100%", marginTop: 22 }}>Done</PrimaryButton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Request introduction to ${retailer.name}`} onClose={onClose} width={560}>
      <ErrorBanner text={error} />
      <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#7A756F", lineHeight: 1.6, marginBottom: 14 }}>
        RIV reviews every request before it's routed onward
        {retailer.network_source === "GTM Partner" ? " to the introducing GTM partner." : " — this retailer is in RIV's direct network."}
      </div>
      <Field label="Why interested in this enterprise" required>
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.whyInterested} onChange={(e) => setForm({ ...form, whyInterested: e.target.value })} />
      </Field>
      <Field label="Problem solved for enterprise" required>
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.problemSolved} onChange={(e) => setForm({ ...form, problemSolved: e.target.value })} />
      </Field>
      <Field label="Relevant product/offering">
        <input style={inputStyle} value={form.relevantOffering} onChange={(e) => setForm({ ...form, relevantOffering: e.target.value })} />
      </Field>
      <Field label="Desired buyer persona">
        <input style={inputStyle} value={form.buyerPersona} onChange={(e) => setForm({ ...form, buyerPersona: e.target.value })} />
      </Field>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, cursor: "pointer" }}>
        <input type="checkbox" checked={form.previouslyEngaged} onChange={(e) => setForm({ ...form, previouslyEngaged: e.target.checked })} />
        <span style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>Previously engaged with this enterprise</span>
      </label>
      {form.previouslyEngaged && (
        <Field label="Prior engagement details">
          <textarea style={{ ...inputStyle, minHeight: 50 }} value={form.priorEngagementDetails} onChange={(e) => setForm({ ...form, priorEngagementDetails: e.target.value })} />
        </Field>
      )}
      <SupportingMaterialUpload files={files} onChange={setFiles} />

      <div style={{ borderTop: `1px solid ${BRAND.line}`, marginTop: 8, paddingTop: 16 }}>
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, marginBottom: 8 }}>Terms &amp; Conditions</div>
        <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#9B958F", lineHeight: 1.6, marginBottom: 12 }}>
          By submitting, you agree to RIV's introduction/closure terms on any resulting deal, and confirm the information above is accurate to the best of your knowledge.
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, cursor: "pointer" }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink, lineHeight: 1.6 }}>I have read and agree to the Terms &amp; Conditions.</span>
        </label>
      </div>
      <PrimaryButton disabled={busy || !consent || !form.whyInterested || !form.problemSolved} onClick={submit} style={{ width: "100%" }}>Submit request</PrimaryButton>
    </Modal>
  );
}

// Retailer Directory (startup browsing) / My Retailers (partner) — same
// list endpoint, different framing and actions per role (addendum §1).
//
// 19 Sep 2026 feedback — for a partner, each retailer card now also lists
// that retailer's own introductions (one row per startup pairing) with
// the two simplified statuses, since a retailer can have several
// introductions against different startups at once.
function RetailerDirectoryView({ user, onRequest }) {
  const [retailers, setRetailers] = useState(null);
  const [error, setError] = useState("");
  // item 1 (25 Sep 2026 batch): "My Retail Network" is a pure retailer
  // directory now, scoped to only what this partner owns/submitted — no
  // per-retailer introduction rows any more (that activity now lives in
  // the unified feed on "Introduce Startup to Retailers", item 2).
  const load = useCallback(
    () => api.getRetailers({ mine: user.role === "partner" }).then((r) => setRetailers(r.retailers)).catch((e) => setError(e.message)),
    [user.role]
  );
  useEffect(() => { load(); }, [load]);
  if (error) return <ErrorBanner text={error} />;
  if (!retailers) return <Spinner />;
  if (!retailers.length) return (
    <EmptyState icon={Building2} title={user.role === "partner" ? "No retailers yet" : "No retailers in the directory yet"}
      text={user.role === "partner" ? "Use Add Retailer to RIV network above to submit one for RIV's review." : "RIV Admin maintains the retailer directory."} />
  );
  return (
    <div>
      {retailers.map((r) => (
        <Card key={r.id} style={{ padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
            <div>
              <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{r.brand || r.name}</div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>{r.category} · {r.location}{r.hq_country ? `, ${r.hq_country}` : ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              {user.role === "partner" && <StatusBadge status={r.status} colors={RETAILER_STATUS_COLORS} label={retailerStatusLabelForPartner(r.status)} />}
              {user.role === "startup" && <PrimaryButton icon={Send} onClick={() => onRequest(r)}>Request intro</PrimaryButton>}
            </div>
          </div>
          {user.role === "partner" && r.status === "Rejected" && r.rejection_reason && (
            <div style={{ fontFamily: FONT, fontSize: 12, color: BRAND.coralDark, background: "#FBEAEA", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
              RIV's note: {r.rejection_reason}
            </div>
          )}
          {user.role === "partner" && r.status === "Duplicate" && (
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#8A6D00", background: "#FFF9DB", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
              This looks similar to a retailer already on file — RIV will review before approving.
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// Add Retailer (addendum §1) — fields mirror the RISE Introduction
// Submission Form (Bigin) in full for the retailer/enterprise side.
function AddRetailerModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "", brand: "", website: "", location: "", hqCountry: "", category: "",
    contactName: "", contactDesignation: "", contactEmail: "", contactPhone: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(""); setBusy(true);
    try { await api.addRetailer(form); await onCreated(); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  // item 9 (9 Oct 2026 batch) — every field required except phone.
  const requiredFilled = form.name && form.brand && form.website && form.location
    && form.hqCountry && form.category && form.contactName && form.contactDesignation && form.contactEmail;

  return (
    <Modal title="Add Retailer to RIV network" onClose={onClose} width={520}>
      <ErrorBanner text={error} />
      <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#9B958F", marginBottom: 14, lineHeight: 1.6 }}>
        Submissions are reviewed by RIV before appearing in the approved directory.
      </div>
      <Field label="Retail enterprise you are referring" required><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Brand you are introducing to" required><input style={inputStyle} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
      <Field label="Website" required><input style={inputStyle} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
      <Field label="City where enterprise is headquartered" required><input style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
      <Field label="HQ country" required><input style={inputStyle} value={form.hqCountry} onChange={(e) => setForm({ ...form, hqCountry: e.target.value })} /></Field>
      <Field label="Retail segment" required><input style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
      <Field label="Enterprise contact — full name" required><input style={inputStyle} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
      <Field label="Enterprise contact — designation" required><input style={inputStyle} value={form.contactDesignation} onChange={(e) => setForm({ ...form, contactDesignation: e.target.value })} /></Field>
      <Field label="Enterprise contact — email" required><input style={inputStyle} type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
      <Field label="Enterprise contact — phone" hint="Optional."><input style={inputStyle} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
      <PrimaryButton onClick={submit} disabled={busy || !requiredFilled} style={{ width: "100%" }}>Submit for review</PrimaryButton>
    </Modal>
  );
}

/* =========================================================================
   STARTUP RETAILER INTRODUCTIONS — Tab 1 (Requested) & Tab 2 (Initiated by
   RIV), 18 Sep 2026 addendum. Replaces the single IntroductionsListView
   that used to hold both kinds of rows together.

   Shared pieces: a search/filter bar, a table shell, and a read-only "View
   Details" modal — both tabs use all three, only the columns differ.
   ========================================================================= */

// Search box + Introduction Status filter, shared by both tabs (PRD:
// Tab 1 item 13 / Tab 2 item 14, "Provide search/filter functionality").
function IntroSearchBar({ search, setSearch, statusFilter, setStatusFilter }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
      <input
        style={{ ...inputStyle, flex: "2 1 220px" }}
        placeholder="Search by retailer name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select style={{ ...inputStyle, flex: "1 1 180px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="">All Introduction Statuses</option>
        {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

function filterIntros(intros, search, statusFilter) {
  const q = search.trim().toLowerCase();
  return intros.filter((i) => {
    if (statusFilter && i.status !== statusFilter) return false;
    if (q && !i.retailer_name?.toLowerCase().includes(q)) return false;
    return true;
  });
}

// Deal Status select — editable only once Introduction Status is
// "Introduced" (PRD Tab 1 item 8 / Tab 2 item 10); a plain read-only badge
// otherwise. Shared by both tabs since the rule is identical.
function DealStatusCell({ intro, onSave }) {
  const editable = intro.status === "Introduced";
  if (!editable) {
    return intro.engagement_stage
      ? <StatusBadge status={intro.engagement_stage} colors={DEAL_STATUS_COLORS} />
      : <span style={{ fontFamily: FONT, fontSize: 12.5, color: "#B7B2AE" }}>—</span>;
  }
  return (
    <select style={{ ...inputStyle, minWidth: 150 }} value={intro.engagement_stage || ""} onChange={(e) => onSave({ dealStatus: e.target.value })}>
      <option value="">—</option>
      {DEAL_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// 9 Oct 2026 batch, item 7 — Opportunity Value display with a $ prefix
// (it's a USD figure, unlike every other amount in the app which is ₹ via
// money()). No currency conversion here, just the symbol — the stored
// number is shown as-is.
function opportunityMoney(n) {
  if (n === null || n === undefined || n === "") return "—";
  return `$${Number(n).toLocaleString("en-US")}`;
}
// Opportunity Value input — editable only once Introduction Status is
// "Introduced" AND Deal Status isn't yet "Closed - Won" (PRD Tab 1 items
// 9–10 / Tab 2 items 11–12); read-only display in every other case.
function OpportunityValueCell({ intro, onSave }) {
  const editable = intro.status === "Introduced" && intro.engagement_stage !== "Closed - Won";
  if (!editable) {
    return <span style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>{opportunityMoney(intro.opportunity_value)}</span>;
  }
  return (
    <div style={{ position: "relative", minWidth: 130 }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontFamily: FONT, fontSize: 13.5, color: "#9B958F", pointerEvents: "none" }}>$</span>
      <input
        style={{ ...inputStyle, paddingLeft: 22 }}
        type="number"
        defaultValue={intro.opportunity_value || ""}
        onBlur={(e) => e.target.value !== String(intro.opportunity_value || "") && onSave({ opportunityValue: e.target.value || null })}
      />
    </div>
  );
}

// Startup Commit Status select — Tab 2 only. Restored startup-editable
// (24 Sep 2026 addendum) after a brief admin-only period; always editable
// (the startup can change its mind before RIV acts on it), and Admin's own
// startupCommitStatus control keeps working alongside this as a phone/
// email fallback — both write the same column.
// item 14 fix (25 Sep 2026 batch): once the deal has reached a closed
// engagement_stage, Commit Status becomes read-only ("N/A") — the backend
// (PUT /introductions/:id/commit-status and admin's override) rejects a
// write past this point too, this just keeps the control from even
// offering it client-side.
function CommitStatusCell({ intro, onSave, busy }) {
  if (["Closed - Won", "Closed - Lost", "Stalled"].includes(intro.engagement_stage)) {
    return <span style={{ fontFamily: FONT, fontSize: 12.5, color: "#9B958F" }}>N/A</span>;
  }
  return (
    <select
      style={{ ...inputStyle, minWidth: 170 }}
      value={intro.startup_commit_status || ""}
      disabled={busy}
      onChange={(e) => e.target.value && onSave(e.target.value)}
    >
      <option value="">— Select —</option>
      {COMMIT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

// A lightweight responsive table shell — header row + one row per intro —
// shared by both tabs so column layout only has to be described once per
// tab via `columns`.
function IntroTable({ columns, rows, renderRow, emptyIcon, emptyTitle, emptyText }) {
  if (!rows.length) return <EmptyState icon={emptyIcon} title={emptyTitle} text={emptyText} />;
  return (
    <Card style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BRAND.line}` }}>
            {columns.map((c) => (
              <th key={c} style={{ textAlign: "left", padding: "12px 14px", fontFamily: FONT, fontWeight: 600, fontSize: 11, color: "#9B958F", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((intro, idx) => renderRow(intro, idx))}
        </tbody>
      </table>
    </Card>
  );
}
const cellStyle = { padding: "12px 14px", fontFamily: FONT, fontSize: 13, color: BRAND.ink, borderBottom: `1px solid ${BRAND.line}`, verticalAlign: "middle" };

// Tab 1 — Retailer Introductions Requested (PRD "Screen 1"). Startup-
// initiated requests; RIV controls approval + introduction, startup only
// ever edits Deal Status / Opportunity Value, and only once Introduced.
function RetailIntroductionsRequestedView({ refreshKey }) {
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // item 6 (25 Sep 2026 batch) — "View Details" opens the consolidated
  // read-only modal (isAdmin={false}, no `user` passed — same shape as
  // item 7's Partner Dashboard use).
  const [detailIntro, setDetailIntro] = useState(null);
  const load = useCallback(
    () => api.getIntroductions("Startup").then((r) => setIntros(r.introductions)).catch((e) => setError(e.message)),
    []
  );
  useEffect(() => { load(); }, [load, refreshKey]);

  async function saveOpportunity(id, patch) {
    setError("");
    try { await api.updateOpportunity(id, patch); load(); }
    catch (e) { setError(e.message); }
  }

  if (error) return <ErrorBanner text={error} />;
  if (!intros) return <Spinner />;
  const rows = filterIntros(intros, search, statusFilter);

  return (
    <div>
      <ErrorBanner text={error} />
      <IntroSearchBar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#9B958F", marginBottom: 10, lineHeight: 1.6 }}>
        Start a new introduction request from Retailer Directory.
      </div>
      <IntroTable
        columns={["Retailer Name", "Requested Date", "RIV Approval Status", "Introduction Status", "Deal Status", "Opportunity Value", ""]}
        rows={rows}
        emptyIcon={ClipboardList}
        emptyTitle={intros.length ? "No requests match your search" : "No introduction requests yet"}
        emptyText={intros.length ? "Try a different retailer name or status." : "Use Retailer Directory to ask RIV to route you to a retailer."}
        renderRow={(i) => (
          <tr key={i.id}>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{i.retailer_name}</td>
            <td style={cellStyle}>{dateStr(i.request_date)}</td>
            <td style={cellStyle}><StatusBadge status={approvalStatusForStartup(i.approval_status)} colors={APPROVAL_COLORS} /></td>
            <td style={cellStyle}><StatusBadge status={introducedStatusFor(i.status, i.engagement_stage)} colors={INTRODUCED_STATUS_COLORS} /></td>
            <td style={cellStyle}><DealStatusCell intro={i} onSave={(patch) => saveOpportunity(i.id, patch)} /></td>
            <td style={cellStyle}><OpportunityValueCell intro={i} onSave={(patch) => saveOpportunity(i.id, patch)} /></td>
            <td style={cellStyle}><GhostButton onClick={() => setDetailIntro(i)} style={{ padding: "6px 12px" }}>View Details</GhostButton></td>
          </tr>
        )}
      />
      {detailIntro && <IntroDetailModal intro={detailIntro} onClose={() => setDetailIntro(null)} isAdmin={false} />}
    </div>
  );
}

// Tab 2 — Retailer Introductions Initiated by RIV (PRD "Screen 2"). RIV
// surfaces the opportunity; the startup's first move is Commit Status,
// then RIV controls Introduction Status the same as Tab 1.
//
// Folded in here (18 Sep 2026, on later feedback) rather than as its own
// third tab: any introduction the startup did NOT request itself —
// whether RIV surfaced it directly (initiated_by = 'RIV Admin') or a GTM
// partner originated it (initiated_by = 'GTM Partner') — shows up in this
// one list. RIV-initiated rows get the usual Commit Status action;
// partner-initiated rows show who the partner is and, once RIV has
// approved and the startup's confirmation is what's pending
// (approval_status = 'GTM Notified'), an inline Confirm action in the
// same cell.
function RetailIntroductionsInitiatedByRivView({ refreshKey }) {
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [savingId, setSavingId] = useState(null);
  // item 6 — same consolidated "View Details" modal as Tab 1 above.
  const [detailIntro, setDetailIntro] = useState(null);
  const load = useCallback(
    () =>
      api.getIntroductions().then((r) => setIntros(r.introductions.filter((i) => i.initiated_by !== "Startup"))).catch((e) => setError(e.message)),
    []
  );
  useEffect(() => { load(); }, [load, refreshKey]);

  async function saveOpportunity(id, patch) {
    setError("");
    try { await api.updateOpportunity(id, patch); load(); }
    catch (e) { setError(e.message); }
  }
  // Restored startup-editable (24 Sep 2026 addendum) — see api.js's
  // updateCommitStatus comment for why Admin's own control still works too.
  async function saveCommitStatus(id, commitStatus) {
    setError(""); setSavingId(id);
    try { await api.updateCommitStatus(id, commitStatus); await load(); }
    catch (e) { setError(e.message); }
    finally { setSavingId(null); }
  }

  if (error) return <ErrorBanner text={error} />;
  if (!intros) return <Spinner />;
  const rows = filterIntros(intros, search, statusFilter);

  return (
    <div>
      <ErrorBanner text={error} />
      <IntroSearchBar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <IntroTable
        columns={["Retailer Name", "Initiated Date", "Startup Commit Status", "Introduction Status", "Deal Status", "Opportunity Value", ""]}
        rows={rows}
        emptyIcon={Handshake}
        emptyTitle={intros.length ? "No opportunities match your search" : "No opportunities yet"}
        emptyText={intros.length ? "Try a different retailer name or status." : "Opportunities RIV identifies for you will appear here."}
        renderRow={(i) => (
          <tr key={i.id}>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{i.retailer_name}</td>
            <td style={cellStyle}>{dateStr(i.request_date)}</td>
            <td style={cellStyle}>
              <CommitStatusCell intro={i} busy={savingId === i.id} onSave={(v) => saveCommitStatus(i.id, v)} />
            </td>
            <td style={cellStyle}><StatusBadge status={introducedStatusFor(i.status, i.engagement_stage)} colors={INTRODUCED_STATUS_COLORS} /></td>
            <td style={cellStyle}><DealStatusCell intro={i} onSave={(patch) => saveOpportunity(i.id, patch)} /></td>
            <td style={cellStyle}><OpportunityValueCell intro={i} onSave={(patch) => saveOpportunity(i.id, patch)} /></td>
            <td style={cellStyle}><GhostButton onClick={() => setDetailIntro(i)} style={{ padding: "6px 12px" }}>View Details</GhostButton></td>
          </tr>
        )}
      />
      {detailIntro && <IntroDetailModal intro={detailIntro} onClose={() => setDetailIntro(null)} isAdmin={false} />}
    </div>
  );
}


// GTM Partner's "Introduce Startup to Retailers" tab (18 Sep 2026
// feedback, replaces the old read-only "Introduction Requests" tab). Two
// separate actions, per the feedback and the reviewed open question:
//   1. Confirm Introduction — pairings proposed TO the partner (by RIV or
//      a startup) that are ready for the partner to act on/log, listed
//      read-only here with a link into the existing detail modal (which
//      already carries the "Log the introduction" form at approval_status
//      = "Startup Confirmed").
//   2. Introduce Startup to Retailers — the partner originates a NEW
//      pairing: approved-retailer + approved-startup pickers, opportunity
//      context mirroring the RISE Introduction Submission Form by GTM
//      Partners (Bigin), a declaration checkbox, and a submission
//      acknowledgement once sent.
// "Check Introduction Interest with the Startup" (19 Sep 2026 feedback,
// renamed + reworked from the old "Confirm Introduction" section) — a GTM
// partner proposes ANY retailer from their network to ANY RIV portfolio
// startup, to check whether RIV/the startup are interested. Unlike the old
// pending-only dropdowns, both lists here are the FULL approved
// directories (same source as the retailer/startup pickers used to live
// in the old create form below) — there's nothing to restrict to, since
// this is how a pairing gets INTO the pipeline in the first place, not a
// queue of things already proposed. Submitting creates a new introduction
// (same backend action the old bottom form's submit used) and starts the
// same approval chain: Pending RIV Approval -> GTM Notified -> Startup
// Confirmed. The declaration + "how introduced" fields stay with proof
// submission below, since they only make sense once an introduction has
// actually happened.
function CheckIntroductionInterestSection({ refreshKey, onOpen, onCreated }) {
  const [retailers, setRetailers] = useState(null);
  const [startups, setStartups] = useState(null);
  const [mine, setMine] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ retailerId: "", startupId: "", opportunityContext: "" });

  useEffect(() => {
    api.getRetailers().then((r) => setRetailers(r.retailers.filter((x) => x.status === "Active in network"))).catch((e) => setError(e.message));
    api.getStartups().then((r) => setStartups(r.startups)).catch((e) => setError(e.message));
  }, []);

  // item 2b (25 Sep 2026 batch) — unified activity feed: every
  // introduction tied to this partner regardless of who initiated it.
  // GET /introductions with no ?initiatedBy filter already scopes to
  // `i.partner_id = <this partner>` server-side (see portal.js) and
  // returns Startup-/GTM Partner-/RIV Admin-initiated rows alike — this
  // used to pass "GTM Partner" here, which hid every pairing this partner
  // didn't originate themselves.
  useEffect(() => {
    api.getIntroductions().then((r) => setMine(r.introductions)).catch((e) => setError(e.message));
  }, [refreshKey]);

  async function submit() {
    setError(""); setBusy(true);
    try {
      await api.createIntroduction({
        retailerId: Number(form.retailerId), startupId: Number(form.startupId),
        opportunityContext: form.opportunityContext,
      });
      setSent(true);
      setForm({ retailerId: "", startupId: "", opportunityContext: "" });
      await onCreated();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 15, color: BRAND.ink, marginBottom: 4 }}>Check Introduction Interest with the Startup</div>
      <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginBottom: 12 }}>
        Pick any retailer from your network and any RISE portfolio startup to check interest. RIV reviews every submission before anyone is notified.
      </div>
      <Card style={{ padding: 20, maxWidth: 520, marginBottom: 20 }}>
        <ErrorBanner text={error} />
        {sent && (
          <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#1E7A34", background: "#E6F4EA", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            Submitted — RIV will review and route this back to you.
          </div>
        )}
        <Field label="Retailer" required hint="All retailers in your network can be selected.">
          <select style={inputStyle} value={form.retailerId} onChange={(e) => setForm({ ...form, retailerId: e.target.value })}>
            <option value="">Select…</option>
            {(retailers || []).map((r) => <option key={r.id} value={r.id}>{r.brand || r.name}</option>)}
          </select>
        </Field>
        <Field label="Startup" required hint="All RISE portfolio startups can be selected.">
          <select style={inputStyle} value={form.startupId} onChange={(e) => setForm({ ...form, startupId: e.target.value })}>
            <option value="">Select…</option>
            {(startups || []).map((s) => <option key={s.id} value={s.id}>{s.startup_name}</option>)}
          </select>
        </Field>
        <Field label="Opportunity context" required hint="Why do you believe this introduction is relevant? What business problem or opportunity exists?">
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.opportunityContext} onChange={(e) => setForm({ ...form, opportunityContext: e.target.value })} />
        </Field>
        <PrimaryButton
          disabled={busy || !form.retailerId || !form.startupId || !form.opportunityContext}
          onClick={submit} style={{ width: "100%" }}
        >
          Check introduction interest with the startup
        </PrimaryButton>
      </Card>

      {/* item 2b — unified feed heading, distinct from the form above
          (which only ever creates GTM-Partner-initiated rows). */}
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink, marginBottom: 4 }}>All introductions in your network</div>
      <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#9B958F", marginBottom: 10 }}>
        Every pairing tied to you — whichever side started it.
      </div>
      {!mine ? <Spinner /> : !mine.length ? (
        <EmptyState icon={Handshake} title="No introductions yet" text="Pairings you propose, RIV routes to you, or a startup requests against your network will show up below." />
      ) : mine.map((i) => (
        <Card key={i.id} onClick={() => onOpen(i)} style={{ padding: 16, marginBottom: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{i.startup_name} <ArrowRight size={12} style={{ margin: "0 4px", verticalAlign: "middle" }} /> {i.retailer_name}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>Requested {dateStr(i.request_date)} · Initiated by: {initiatorLabel(i.initiated_by)}</div>
            {/* item 13b — duplicate note in the partner's own feed. Only
                ever set on Startup-initiated rows (a GTM-partner-initiated
                duplicate is blocked outright at submission — see the 409
                in portal.js), but check generically in case that changes. */}
            {i.duplicate_of_introduction_id && (
              <div style={{ fontFamily: FONT, fontSize: 11, color: "#8A6D00", marginTop: 4 }}>
                Possible duplicate — already in the pipeline since {dateStr(i.duplicate_of_request_date)}, currently {interestStatusFor(i.duplicate_of_approval_status)}.
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <StatusBadge status={interestStatusFor(i.approval_status)} colors={INTEREST_STATUS_COLORS} />
            <StatusBadge status={introducedStatusFor(i.status, i.engagement_stage)} colors={INTRODUCED_STATUS_COLORS} />
          </div>
        </Card>
      ))}
    </div>
  );
}

// Small helper for the Confirm Introduction dropdowns above — collapses a
// list of introductions down to their distinct retailer (or startup) id/name
// pairs, preserving first-seen order.
function uniqueById(list, getId, getName) {
  const seen = new Map();
  for (const item of list) {
    const id = getId(item);
    if (!seen.has(id)) seen.set(id, { id, name: getName(item) });
  }
  return Array.from(seen.values());
}

// "Submit Proof of Startup-Retailer Introduction" (19 Sep 2026 feedback,
// renamed + reworked from the old "Introduce Startup to Retailers" create
// form; dropdowns broadened 19 Sep 2026 follow-up to match "Check
// Introduction Interest" above). The Retailer/Startup dropdowns now list
// the same full directories as the section above (not just pending
// confirmations) for a consistent picker experience. What CAN actually be
// submitted is still only a pairing the startup has confirmed interest in
// (approval_status = 'Startup Confirmed') — that's resolved quietly in the
// background against the Confirm Introduction queue once both are picked,
// and the form tells the partner plainly if that pairing isn't ready yet
// instead of hiding it from the list.
function SubmitProofOfIntroductionSection({ refreshKey, onCreated }) {
  const [retailers, setRetailers] = useState(null);
  const [startups, setStartups] = useState(null);
  const [pending, setPending] = useState(null); // Startup Confirmed queue, for matching only
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [retailerFilter, setRetailerFilter] = useState("");
  const [startupFilter, setStartupFilter] = useState("");
  const [channel, setChannel] = useState("Email");
  const [proofFile, setProofFile] = useState(null);
  const [declaration, setDeclaration] = useState(false);

  useEffect(() => {
    api.getRetailers().then((r) => setRetailers(r.retailers.filter((x) => x.status === "Active in network"))).catch((e) => setError(e.message));
    api.getStartups().then((r) => setStartups(r.startups)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { api.getConfirmQueue().then((r) => setPending(r.introductions)).catch((e) => setError(e.message)); }, [refreshKey]);

  const matchedIntro = (retailerFilter && startupFilter)
    ? (pending || []).find((i) => String(i.retailer_id) === retailerFilter && String(i.startup_id) === startupFilter) || null
    : null;
  const bothPicked = !!retailerFilter && !!startupFilter;

  async function submit() {
    if (!matchedIntro) return;
    setError(""); setBusy(true);
    try {
      await api.logIntroductionWithProof(matchedIntro.id, { channel, declarationAccepted: declaration }, proofFile);
      setSent(true);
      setRetailerFilter(""); setStartupFilter(""); setChannel("Email"); setProofFile(null); setDeclaration(false);
      await onCreated();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 15, color: BRAND.ink, marginBottom: 4 }}>Submit Proof of Startup-Retailer Introduction</div>
      <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginBottom: 12 }}>
        Select the retailer and startup, then attach proof to move a startup-confirmed pairing forward.
      </div>
      <Card style={{ padding: 20, maxWidth: 520 }}>
        <ErrorBanner text={error} />
        {sent && (
          <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#1E7A34", background: "#E6F4EA", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            Submitted — the introduction has been logged and moved forward.
          </div>
        )}
        <Field label="Retailer" required hint="All retailers in your network can be selected.">
          <select style={inputStyle} value={retailerFilter} onChange={(e) => setRetailerFilter(e.target.value)}>
            <option value="">Select…</option>
            {(retailers || []).map((r) => <option key={r.id} value={r.id}>{r.brand || r.name}</option>)}
          </select>
        </Field>
        <Field label="Startup" required hint="All RISE portfolio startups can be selected.">
          <select style={inputStyle} value={startupFilter} onChange={(e) => setStartupFilter(e.target.value)}>
            <option value="">Select…</option>
            {(startups || []).map((s) => <option key={s.id} value={s.id}>{s.startup_name}</option>)}
          </select>
        </Field>
        {bothPicked && !matchedIntro && (
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#B8790A", background: "#FFF4E0", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            This pairing isn't ready for proof yet — RIV still needs to approve it and the startup needs to confirm (see "Check Introduction Interest with the Startup" above).
          </div>
        )}
        <Field label="How have you introduced the startup to the enterprise" required>
          <select style={inputStyle} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="Email">Email</option>
            <option value="WhatsApp">WhatsApp</option>
            <option value="LinkedIn">LinkedIn</option>
            <option value="In-person">In person</option>
          </select>
        </Field>
        <Field label="Provide proof of introduction" required hint="Attach a screenshot of the email/WhatsApp/LinkedIn exchange (or a PDF).">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => setProofFile(e.target.files?.[0] || null)}
            style={{ fontFamily: FONT, fontSize: 12.5 }}
          />
        </Field>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink, lineHeight: 1.6 }}>Declaration — I confirm that I have personally facilitated this introduction. The information submitted is accurate to the best of my knowledge.</span>
        </label>
        <PrimaryButton
          disabled={busy || !matchedIntro || !channel || !proofFile || !declaration}
          onClick={submit} style={{ width: "100%" }}
        >
          Submit proof of introduction
        </PrimaryButton>
      </Card>
    </div>
  );
}

function IntroduceStartupToRetailersView({ refreshKey, onOpen, onCreated }) {
  return (
    <div>
      <CheckIntroductionInterestSection refreshKey={refreshKey} onOpen={onOpen} onCreated={onCreated} />
      <SubmitProofOfIntroductionSection refreshKey={refreshKey} onCreated={onCreated} />
    </div>
  );
}

// GTM Partner "Dashboard" tab (18 Sep 2026 feedback) — one row per
// introduction with the seven columns specified: Retailer, Startup, RIV
// introduction approval status, Introduction status, Deal Status,
// Opportunity value, Expected GTM success fee. The fee column only shows
// a figure on introductions the partner originated themselves via
// "Introduce Startup to Retailers" (initiated_by = 'GTM Partner') — per
// the reviewed answer, a startup-initiated introduction to a retailer in
// this partner's network pays RIV in full, no partner cut. Once Closed –
// Won, the figure shown is the rate LOCKED at that time
// (partner_fee_amount/partner_fee_pct), not a live recomputation.
function PartnerDashboardView({ refreshKey }) {
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState("");
  // item 7 — "View Details" opens the consolidated read-only modal.
  const [detailIntro, setDetailIntro] = useState(null);
  useEffect(() => { api.getIntroductions().then((r) => setIntros(r.introductions)).catch((e) => setError(e.message)); }, [refreshKey]);
  if (error) return <ErrorBanner text={error} />;
  if (!intros) return <Spinner />;

  function expectedFee(i) {
    if (i.initiated_by !== "GTM Partner") return null;
    if (i.partner_fee_amount != null) return i.partner_fee_amount; // locked at Closed-Won
    if (!i.fee_amount_due) return null;
    return null; // not yet locked — nothing to show until a figure exists
  }

  // item 16 — summary strip: active introductions, closed-won count, and
  // total expected GTM success fee for closed-won deals for this partner.
  // "Active" mirrors AdminPartnersView's own definition (item 11): not
  // Rejected, not a closed/dead status.
  const CLOSED_STATUSES = ["Closed - Won", "Closed - Lost", "Stalled", "Invoiced", "Paid", "Payout Complete"];
  const activeCount = intros.filter((i) => i.approval_status !== "Rejected" && !CLOSED_STATUSES.includes(i.status)).length;
  const closedWonCount = intros.filter((i) => i.engagement_stage === "Closed - Won").length;
  const totalExpectedFee = intros
    .filter((i) => i.engagement_stage === "Closed - Won" && i.initiated_by === "GTM Partner" && i.partner_fee_amount != null)
    .reduce((sum, i) => sum + Number(i.partner_fee_amount), 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>Active introductions</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: BRAND.ink, marginTop: 4 }}>{activeCount}</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>Closed – Won</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: "#1E7A34", marginTop: 4 }}>{closedWonCount}</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>Expected GTM Success Fee (Closed – Won)</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: "#1E7A34", marginTop: 4 }}>{usdFee(totalExpectedFee)}</div>
        </Card>
      </div>
      <IntroTable
        columns={["Retailer", "Startup", "Initiated by", "Introduction interest status", "Actual Introduction status", "Deal Status", "Opportunity Value", "Expected GTM Success Fee", ""]}
        rows={intros}
        emptyIcon={Handshake}
        emptyTitle="No introductions yet"
        emptyText="Introductions you originate or that RIV routes to you will appear here."
        renderRow={(i) => (
          <tr key={i.id}>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{i.retailer_name}</td>
            <td style={cellStyle}>{i.startup_name}</td>
            <td style={cellStyle}>{initiatorLabel(i.initiated_by)}</td>
            <td style={cellStyle}><StatusBadge status={interestStatusFor(i.approval_status)} colors={INTEREST_STATUS_COLORS} /></td>
            <td style={cellStyle}><StatusBadge status={introducedStatusFor(i.status, i.engagement_stage)} colors={INTRODUCED_STATUS_COLORS} /></td>
            <td style={cellStyle}>{i.engagement_stage ? <StatusBadge status={i.engagement_stage} colors={DEAL_STATUS_COLORS} /> : <span style={{ color: "#B7B2AE" }}>—</span>}</td>
            <td style={cellStyle}>{opportunityMoney(i.opportunity_value)}</td>
            <td style={cellStyle}>{expectedFee(i) != null ? usdFee(expectedFee(i)) : <span style={{ color: "#B7B2AE" }}>—</span>}</td>
            <td style={cellStyle}><GhostButton onClick={() => setDetailIntro(i)} style={{ padding: "6px 12px" }}>View Details</GhostButton></td>
          </tr>
        )}
      />
      {detailIntro && <IntroDetailModal intro={detailIntro} onClose={() => setDetailIntro(null)} isAdmin={false} />}
    </div>
  );
}

/* =========================================================================
   ADMIN VIEWS
   ========================================================================= */
// item 10 (25 Sep 2026 batch) — one "Needs your attention" tile. Clickable
// when onNavigate is given (switches the admin nav's active tab); still
// shows the labeled count either way, per the task's fallback instruction.
function AttentionTile({ label, value, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      type={onClick ? "button" : undefined}
      style={{
        display: "block", textAlign: "left", width: "100%", padding: 16, borderRadius: 14,
        border: `1px solid ${BRAND.line}`, background: "#fff", cursor: onClick ? "pointer" : "default", fontFamily: FONT,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 22, color: BRAND.coral }}>{value}</div>
      <div style={{ fontSize: 12, color: "#9B958F", marginTop: 4 }}>{label}</div>
    </Tag>
  );
}

function AdminOverview({ onNavigate }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.getSummary().then(setSummary).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBanner text={error} />;
  if (!summary) return <Spinner />;
  const cards = [
    { label: "Partners", value: summary.counts.partners, icon: Users },
    { label: "Startups", value: summary.counts.startups, icon: Briefcase },
    { label: "Retailers", value: summary.counts.retailers, icon: Building2 },
    { label: "Introductions", value: summary.counts.introductions, icon: Handshake },
  ];
  const needsAttention = summary.needsAttention || {};
  // item 10 — "Introductions by initiator", replacing the old raw "By
  // status" breakdown below. initiatorCounts comes back as one row per
  // distinct initiated_by value actually present in the data, so missing
  // values (e.g. no RIV-initiated intros yet) default to 0 here.
  const initiatorMap = Object.fromEntries((summary.initiatorCounts || []).map((r) => [r.initiated_by, r.count]));
  const initiatorRows = [
    ["Startup", initiatorMap["Startup"] || 0],
    ["GTM Partner", initiatorMap["GTM Partner"] || 0],
    ["RIV", initiatorMap["RIV Admin"] || 0],
  ];
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {cards.map((c) => (
          <Card key={c.label} style={{ padding: 16 }}>
            <c.icon size={16} color={BRAND.coral} />
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 22, color: BRAND.ink, marginTop: 8 }}>{c.value}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>{c.label}</div>
          </Card>
        ))}
      </div>

      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: BRAND.ink, marginBottom: 10 }}>Needs your attention</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <AttentionTile label="Pending retailer approvals" value={needsAttention.pending_retailer_approvals || 0} onClick={onNavigate ? () => onNavigate("retailers") : undefined} />
        <AttentionTile label="Introductions pending RIV approval" value={needsAttention.introductions_pending_riv_approval || 0} onClick={onNavigate ? () => onNavigate("introductions") : undefined} />
        <AttentionTile label="Awaiting startup response (GTM Notified)" value={needsAttention.introductions_awaiting_startup_response || 0} onClick={onNavigate ? () => onNavigate("introductions") : undefined} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>Fees earned</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: BRAND.ink, marginTop: 4 }}>{money(summary.pipeline.fees_earned)}</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>Fees collected</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: "#1E7A34", marginTop: 4 }}>{money(summary.pipeline.fees_collected)}</div>
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>Active in flight</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: BRAND.ink, marginTop: 4 }}>{summary.pipeline.active_in_flight}</div>
        </Card>
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: BRAND.ink, marginBottom: 10 }}>Introductions by initiator</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {initiatorRows.map(([label, count]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `1px solid ${BRAND.line}`, borderRadius: 10 }}>
            <span style={{ fontFamily: FONT, fontSize: 12.5, color: "#7A756F" }}>{label}</span> <span style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 600 }}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 9 Oct 2026 batch, item 2 — full admin edit for a GTM partner: every
// field the backend's PUT /admin/partners/:id already accepts (see
// admin.js), including the commission/rate override fields RIV needs as
// final decision-maker. Email is intentionally excluded — the backend
// route doesn't update it (it's tied to the provisioned login), so it's
// shown read-only here rather than offered as an editable field that
// would silently do nothing.
function EditPartnerModal({ partner, onClose, onSaved }) {
  const [form, setForm] = useState({
    fullName: partner.full_name || "", company: partner.company || "", phone: partner.phone || "",
    linkedinUrl: partner.linkedin_url || "", region: partner.region || "",
    onboardingStage: partner.onboarding_stage || "New", agreementLink: partner.agreement_link || "",
    agreementSignedDate: partner.agreement_signed_date ? partner.agreement_signed_date.slice(0, 10) : "",
    defaultPayoutSplit: partner.default_payout_split ?? "", revenueShareOverride: partner.revenue_share_override ?? "",
    riv_owner: partner.riv_owner || "", status: partner.status || "Active", notes: partner.notes || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(""); setBusy(true);
    try {
      await api.updatePartner(partner.id, { ...form, revenueShareOverride: form.revenueShareOverride === "" ? null : form.revenueShareOverride });
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit ${partner.full_name}`} onClose={onClose} width={520}>
      <ErrorBanner text={error} />
      <Field label="Email" hint="Login email — change by re-provisioning.">
        <input style={{ ...inputStyle, color: "#9B958F" }} value={partner.email} disabled />
      </Field>
      <Field label="Full name"><input style={inputStyle} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
      <Field label="Company"><input style={inputStyle} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
      <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="LinkedIn URL"><input style={inputStyle} value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} /></Field>
      <Field label="Region"><input style={inputStyle} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></Field>
      <Field label="Onboarding stage">
        <select style={inputStyle} value={form.onboardingStage} onChange={(e) => setForm({ ...form, onboardingStage: e.target.value })}>
          <option>New</option><option>Agreement Sent</option><option>Signed</option><option>Onboarded</option>
        </select>
      </Field>
      <Field label="Agreement link"><input style={inputStyle} value={form.agreementLink} onChange={(e) => setForm({ ...form, agreementLink: e.target.value })} /></Field>
      <Field label="Agreement signed date"><input style={inputStyle} type="date" value={form.agreementSignedDate} onChange={(e) => setForm({ ...form, agreementSignedDate: e.target.value })} /></Field>
      <Field label="Default payout split (%)"><input style={inputStyle} type="number" step="0.1" value={form.defaultPayoutSplit} onChange={(e) => setForm({ ...form, defaultPayoutSplit: e.target.value })} /></Field>
      <Field label="Revenue share override (%)" hint="Leave blank to use RIV's standard rate.">
        <input style={inputStyle} type="number" step="0.1" value={form.revenueShareOverride} onChange={(e) => setForm({ ...form, revenueShareOverride: e.target.value })} />
      </Field>
      <Field label="RIV owner"><input style={inputStyle} value={form.riv_owner} onChange={(e) => setForm({ ...form, riv_owner: e.target.value })} /></Field>
      <Field label="Status">
        <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option>Active</option><option>Inactive</option>
        </select>
      </Field>
      <Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      <PrimaryButton onClick={save} disabled={busy || !form.fullName} style={{ width: "100%" }}>Save changes</PrimaryButton>
    </Modal>
  );
}

function AdminPartnersView() {
  const [partners, setPartners] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ fullName: "", company: "", email: "", phone: "", region: "" });
  const [provisioning, setProvisioning] = useState(null);
  const [pwField, setPwField] = useState("");
  // item 13 — guards against a double-click/double-submit on Provision
  // firing two overlapping POSTs before the first one's response (and the
  // resulting portal_login_status flip) comes back and hides the button.
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [editingPartner, setEditingPartner] = useState(null);

  const load = useCallback(() => api.listPartners().then((r) => setPartners(r.partners)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function createPartner() {
    setError("");
    try {
      await api.createPartner(form);
      setShowNew(false);
      setForm({ fullName: "", company: "", email: "", phone: "", region: "" });
      load();
      showSuccess(`${form.fullName} was added as a new GTM partner.`);
    }
    catch (e) { setError(e.message); }
  }
  async function provision(p) {
    if (provisionBusy) return;
    setError(""); setProvisionBusy(true);
    try { await api.provisionPartnerLogin(p.id, pwField); setProvisioning(null); setPwField(""); await load(); }
    catch (e) { setError(e.message); }
    finally { setProvisionBusy(false); }
  }

  if (error) return <ErrorBanner text={error} />;
  return (
    <div>
      <SuccessBanner text={success} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <PrimaryButton icon={Plus} onClick={() => setShowNew(true)}>New partner</PrimaryButton>
      </div>
      {!partners ? <Spinner /> : !partners.length ? (
        <EmptyState icon={Users} title="No GTM partners yet" text="Add a partner to get started." />
      ) : partners.map((p) => (
        <Card key={p.id} style={{ padding: 16, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{p.full_name}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>{p.email} · {p.company || "—"} · {p.region || "—"}</div>
            <div style={{ fontFamily: FONT, fontSize: 11, color: "#B7B2AE", marginTop: 5 }}>Payout split {p.default_payout_split}% · Stage: {p.onboarding_stage} · Login: {p.portal_login_status}</div>
            {/* item 11 (25 Sep 2026 batch) — inline metrics from GET
                /admin/partners' new aggregate subqueries (admin.js). */}
            <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#7A756F", marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>{p.retailer_count ?? 0} retailer{p.retailer_count === 1 ? "" : "s"} in network</span>
              <span>{p.active_introduction_count ?? 0} active introduction{p.active_introduction_count === 1 ? "" : "s"}</span>
              <span>{money(p.fees_earned)} fees earned</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <GhostButton onClick={() => setEditingPartner(p)}>Edit</GhostButton>
            {p.portal_login_status !== "Provisioned" && (
              provisioning === p.id ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...inputStyle, width: 150 }} placeholder="Temp password" value={pwField} onChange={(e) => setPwField(e.target.value)} />
                  <PrimaryButton onClick={() => provision(p)} disabled={pwField.length < 8 || provisionBusy}>{provisionBusy ? "Provisioning…" : "Provision"}</PrimaryButton>
                </div>
              ) : <GhostButton onClick={() => setProvisioning(p.id)}>Provision login</GhostButton>
            )}
          </div>
        </Card>
      ))}
      {showNew && (
        <Modal title="New GTM partner" onClose={() => setShowNew(false)}>
          <ErrorBanner text={error} />
          <Field label="Full name" required><input style={inputStyle} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="Company"><input style={inputStyle} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
          <Field label="Email" required><input style={inputStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Region"><input style={inputStyle} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></Field>
          <PrimaryButton onClick={createPartner} disabled={!form.fullName || !form.email} style={{ width: "100%" }}>Create partner</PrimaryButton>
        </Modal>
      )}
      {editingPartner && (
        <EditPartnerModal partner={editingPartner} onClose={() => setEditingPartner(null)} onSaved={load} />
      )}
    </div>
  );
}

// 9 Oct 2026 batch, item 2 — full admin edit for a RISE startup, covering
// every field the backend's PUT /admin/startups/:id accepts (admin.js),
// including the commission (revenue share) override and the fee/equity
// onboarding fields — RIV admin is the final decision-maker on all of
// these, not just the basics shown on the card. Email is read-only here
// for the same reason as EditPartnerModal.
function EditStartupModal({ startup, onClose, onSaved }) {
  const [form, setForm] = useState({
    startupName: startup.startup_name || "", founderName: startup.founder_name || "", phone: startup.phone || "",
    sector: startup.sector || "", solutionSummary: startup.solution_summary || "",
    onboardingStage: startup.onboarding_stage || "New", agreementLink: startup.agreement_link || "",
    agreementSignedDate: startup.agreement_signed_date ? startup.agreement_signed_date.slice(0, 10) : "",
    participationFeeStatus: startup.participation_fee_status || "Pending",
    participationFeeDueDate: startup.participation_fee_due_date ? startup.participation_fee_due_date.slice(0, 10) : "",
    equityPct: startup.equity_pct ?? "", revenueShareOverride: startup.revenue_share_override ?? "",
    riv_owner: startup.riv_owner || "", status: startup.status || "Active", notes: startup.notes || "",
    legalEntity: startup.legal_entity || "", website: startup.website || "", city: startup.city || "",
    hqCountry: startup.hq_country || "", yearIncorporated: startup.year_incorporated || "",
    foundingTeamDetails: startup.founding_team_details || "",
    problemDescription: startup.problem_description || "", solutionDescription: startup.solution_description || "",
    topBenefits: startup.top_benefits || "", techStack: startup.tech_stack || "", subVertical: startup.sub_vertical || "",
    competition: startup.competition || "", competitiveAdvantage: startup.competitive_advantage || "",
    payingCustomerCount: startup.paying_customer_count || "", notableCustomers: startup.notable_customers || "",
    keyMilestones: startup.key_milestones || "", pastFundRaised: startup.past_fund_raised || "",
    currentlyRaisingCapital: startup.currently_raising_capital || "", fundraisingSupportInterest: startup.fundraising_support_interest || "",
    additionalNotes: startup.additional_notes || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(""); setBusy(true);
    try {
      await api.updateStartup(startup.id, { ...form, revenueShareOverride: form.revenueShareOverride === "" ? null : form.revenueShareOverride, equityPct: form.equityPct === "" ? null : form.equityPct });
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit ${startup.startup_name}`} onClose={onClose} width={560}>
      <ErrorBanner text={error} />
      <Field label="Email" hint="Login email — change by re-provisioning."><input style={{ ...inputStyle, color: "#9B958F" }} value={startup.email} disabled /></Field>
      <Field label="Startup name"><input style={inputStyle} value={form.startupName} onChange={(e) => setForm({ ...form, startupName: e.target.value })} /></Field>
      <Field label="Founder name"><input style={inputStyle} value={form.founderName} onChange={(e) => setForm({ ...form, founderName: e.target.value })} /></Field>
      <Field label="Phone"><input style={inputStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Sector"><input style={inputStyle} value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} /></Field>
      <Field label="Solution summary"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.solutionSummary} onChange={(e) => setForm({ ...form, solutionSummary: e.target.value })} /></Field>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, margin: "18px 0 10px", borderTop: `1px solid ${BRAND.line}`, paddingTop: 14 }}>Onboarding &amp; commercial terms</div>
      <Field label="Onboarding stage">
        <select style={inputStyle} value={form.onboardingStage} onChange={(e) => setForm({ ...form, onboardingStage: e.target.value })}>
          <option>New</option><option>Agreement Sent</option><option>Signed</option><option>Onboarded</option>
        </select>
      </Field>
      <Field label="Agreement link"><input style={inputStyle} value={form.agreementLink} onChange={(e) => setForm({ ...form, agreementLink: e.target.value })} /></Field>
      <Field label="Agreement signed date"><input style={inputStyle} type="date" value={form.agreementSignedDate} onChange={(e) => setForm({ ...form, agreementSignedDate: e.target.value })} /></Field>
      <Field label="Participation fee status">
        <select style={inputStyle} value={form.participationFeeStatus} onChange={(e) => setForm({ ...form, participationFeeStatus: e.target.value })}>
          <option>Pending</option><option>Paid</option>
        </select>
      </Field>
      <Field label="Participation fee due date"><input style={inputStyle} type="date" value={form.participationFeeDueDate} onChange={(e) => setForm({ ...form, participationFeeDueDate: e.target.value })} /></Field>
      <Field label="Equity (%)"><input style={inputStyle} type="number" step="0.01" value={form.equityPct} onChange={(e) => setForm({ ...form, equityPct: e.target.value })} /></Field>
      <Field label="Revenue share override (%)" hint="Leave blank to use RIV's standard rate.">
        <input style={inputStyle} type="number" step="0.1" value={form.revenueShareOverride} onChange={(e) => setForm({ ...form, revenueShareOverride: e.target.value })} />
      </Field>
      <Field label="RIV owner"><input style={inputStyle} value={form.riv_owner} onChange={(e) => setForm({ ...form, riv_owner: e.target.value })} /></Field>
      <Field label="Status">
        <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option>Active</option><option>Inactive</option>
        </select>
      </Field>
      <Field label="Internal notes"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, margin: "18px 0 10px", borderTop: `1px solid ${BRAND.line}`, paddingTop: 14 }}>RISE GTM Application Form fields</div>
      <Field label="Legal entity"><input style={inputStyle} value={form.legalEntity} onChange={(e) => setForm({ ...form, legalEntity: e.target.value })} /></Field>
      <Field label="Website"><input style={inputStyle} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
      <Field label="City"><input style={inputStyle} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
      <Field label="HQ country"><input style={inputStyle} value={form.hqCountry} onChange={(e) => setForm({ ...form, hqCountry: e.target.value })} /></Field>
      <Field label="Year incorporated"><input style={inputStyle} value={form.yearIncorporated} onChange={(e) => setForm({ ...form, yearIncorporated: e.target.value })} /></Field>
      <Field label="Founding team details / qualifications"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.foundingTeamDetails} onChange={(e) => setForm({ ...form, foundingTeamDetails: e.target.value })} /></Field>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, margin: "18px 0 10px", borderTop: `1px solid ${BRAND.line}`, paddingTop: 14 }}>Startup Detail View fields</div>
      <Field label="Problem description"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.problemDescription} onChange={(e) => setForm({ ...form, problemDescription: e.target.value })} /></Field>
      <Field label="Solution"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.solutionDescription} onChange={(e) => setForm({ ...form, solutionDescription: e.target.value })} /></Field>
      <Field label="Top 3 benefits"><input style={inputStyle} value={form.topBenefits} onChange={(e) => setForm({ ...form, topBenefits: e.target.value })} /></Field>
      <Field label="Tech stack"><input style={inputStyle} value={form.techStack} onChange={(e) => setForm({ ...form, techStack: e.target.value })} /></Field>
      <Field label="Sub-vertical"><input style={inputStyle} value={form.subVertical} onChange={(e) => setForm({ ...form, subVertical: e.target.value })} /></Field>
      <Field label="Competition"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.competition} onChange={(e) => setForm({ ...form, competition: e.target.value })} /></Field>
      <Field label="Competitive advantage"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.competitiveAdvantage} onChange={(e) => setForm({ ...form, competitiveAdvantage: e.target.value })} /></Field>
      <Field label="Paying customer count"><input style={inputStyle} value={form.payingCustomerCount} onChange={(e) => setForm({ ...form, payingCustomerCount: e.target.value })} /></Field>
      <Field label="Notable customers"><input style={inputStyle} value={form.notableCustomers} onChange={(e) => setForm({ ...form, notableCustomers: e.target.value })} /></Field>
      <Field label="Key milestones"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.keyMilestones} onChange={(e) => setForm({ ...form, keyMilestones: e.target.value })} /></Field>
      <Field label="Past fund raised"><input style={inputStyle} value={form.pastFundRaised} onChange={(e) => setForm({ ...form, pastFundRaised: e.target.value })} /></Field>
      <Field label="Currently raising capital?">
        <select style={inputStyle} value={form.currentlyRaisingCapital} onChange={(e) => setForm({ ...form, currentlyRaisingCapital: e.target.value })}>
          <option value="">— None —</option><option>Yes</option><option>No</option>
        </select>
      </Field>
      <Field label="Interested in fundraising support from RIV?">
        <select style={inputStyle} value={form.fundraisingSupportInterest} onChange={(e) => setForm({ ...form, fundraisingSupportInterest: e.target.value })}>
          <option value="">— None —</option><option>Yes</option><option>No</option>
        </select>
      </Field>
      <Field label="Anything else"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.additionalNotes} onChange={(e) => setForm({ ...form, additionalNotes: e.target.value })} /></Field>
      <PrimaryButton onClick={save} disabled={busy || !form.startupName} style={{ width: "100%" }}>Save changes</PrimaryButton>
    </Modal>
  );
}

function AdminStartupsView() {
  const [startups, setStartups] = useState(null);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [showNew, setShowNew] = useState(false);
  const blankForm = {
    startupName: "", founderName: "", email: "", sector: "", solutionSummary: "",
    problemDescription: "", solutionDescription: "", topBenefits: "", techStack: "", subVertical: "",
    competition: "", competitiveAdvantage: "", payingCustomerCount: "", notableCustomers: "", keyMilestones: "",
    legalEntity: "", website: "", city: "", hqCountry: "", yearIncorporated: "", foundingTeamDetails: "",
    pastFundRaised: "", currentlyRaisingCapital: "", fundraisingSupportInterest: "", additionalNotes: "",
  };
  const [form, setForm] = useState(blankForm);
  const [provisioning, setProvisioning] = useState(null);
  const [pwField, setPwField] = useState("");
  const [provisionBusy, setProvisionBusy] = useState(false); // item 13
  const [detailStartupId, setDetailStartupId] = useState(null);
  const [editingStartup, setEditingStartup] = useState(null);

  const load = useCallback(() => api.listStartups().then((r) => setStartups(r.startups)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function createStartup() {
    setError("");
    try {
      await api.createStartup(form);
      setShowNew(false);
      setForm(blankForm);
      load();
      showSuccess(`${form.startupName} was added as a new RISE startup.`);
    }
    catch (e) { setError(e.message); }
  }
  async function provision(s) {
    if (provisionBusy) return;
    setError(""); setProvisionBusy(true);
    try { await api.provisionStartupLogin(s.id, pwField); setProvisioning(null); setPwField(""); await load(); }
    catch (e) { setError(e.message); }
    finally { setProvisionBusy(false); }
  }

  if (error) return <ErrorBanner text={error} />;
  return (
    <div>
      <SuccessBanner text={success} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <PrimaryButton icon={Plus} onClick={() => setShowNew(true)}>New startup</PrimaryButton>
      </div>
      {!startups ? <Spinner /> : !startups.length ? (
        <EmptyState icon={Briefcase} title="No RISE startups yet" text="Add a startup to get started." />
      ) : startups.map((s) => (
        <Card key={s.id} style={{ padding: 16, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{s.startup_name}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>{s.email} · {s.sector || "—"}</div>
            <div style={{ fontFamily: FONT, fontSize: 11, color: "#B7B2AE", marginTop: 5 }}>Stage: {s.onboarding_stage} · Fee: {s.participation_fee_status} · Login: {s.portal_login_status}</div>
            {/* item 12 (25 Sep 2026 batch) — inline metrics from GET
                /admin/startups' new aggregate subqueries (admin.js). */}
            <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#7A756F", marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>{s.active_introduction_count ?? 0} active introduction{s.active_introduction_count === 1 ? "" : "s"}</span>
              <span>{s.closed_won_count ?? 0} closed – won</span>
              <span>{opportunityMoney(s.total_opportunity_value)} total opportunity value</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <GhostButton onClick={() => setDetailStartupId(s.id)}>View Details</GhostButton>
            <GhostButton onClick={() => setEditingStartup(s)}>Edit</GhostButton>
            {s.portal_login_status !== "Provisioned" && (
              provisioning === s.id ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...inputStyle, width: 150 }} placeholder="Temp password" value={pwField} onChange={(e) => setPwField(e.target.value)} />
                  <PrimaryButton onClick={() => provision(s)} disabled={pwField.length < 8 || provisionBusy}>{provisionBusy ? "Provisioning…" : "Provision"}</PrimaryButton>
                </div>
              ) : <GhostButton onClick={() => setProvisioning(s.id)}>Provision login</GhostButton>
            )}
          </div>
        </Card>
      ))}
      {showNew && (
        <Modal title="New RISE startup" onClose={() => setShowNew(false)} width={560}>
          <ErrorBanner text={error} />
          <Field label="Startup name" required><input style={inputStyle} value={form.startupName} onChange={(e) => setForm({ ...form, startupName: e.target.value })} /></Field>
          <Field label="Founder name"><input style={inputStyle} value={form.founderName} onChange={(e) => setForm({ ...form, founderName: e.target.value })} /></Field>
          <Field label="Email" required><input style={inputStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Sector"><input style={inputStyle} value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} /></Field>
          <Field label="Solution summary"><textarea style={{ ...inputStyle, minHeight: 70 }} value={form.solutionSummary} onChange={(e) => setForm({ ...form, solutionSummary: e.target.value })} /></Field>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, margin: "18px 0 10px", borderTop: `1px solid ${BRAND.line}`, paddingTop: 14 }}>RISE GTM Application Form fields</div>
          <Field label="Legal entity"><input style={inputStyle} value={form.legalEntity} onChange={(e) => setForm({ ...form, legalEntity: e.target.value })} /></Field>
          <Field label="Website"><input style={inputStyle} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
          <Field label="City"><input style={inputStyle} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="HQ country"><input style={inputStyle} value={form.hqCountry} onChange={(e) => setForm({ ...form, hqCountry: e.target.value })} /></Field>
          <Field label="Year incorporated"><input style={inputStyle} value={form.yearIncorporated} onChange={(e) => setForm({ ...form, yearIncorporated: e.target.value })} /></Field>
          <Field label="Founding team details / qualifications"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.foundingTeamDetails} onChange={(e) => setForm({ ...form, foundingTeamDetails: e.target.value })} /></Field>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, margin: "18px 0 10px", borderTop: `1px solid ${BRAND.line}`, paddingTop: 14 }}>Startup Detail View fields</div>
          <Field label="Problem description"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.problemDescription} onChange={(e) => setForm({ ...form, problemDescription: e.target.value })} /></Field>
          <Field label="Solution"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.solutionDescription} onChange={(e) => setForm({ ...form, solutionDescription: e.target.value })} /></Field>
          <Field label="Top 3 benefits"><input style={inputStyle} value={form.topBenefits} onChange={(e) => setForm({ ...form, topBenefits: e.target.value })} /></Field>
          <Field label="Tech stack"><input style={inputStyle} value={form.techStack} onChange={(e) => setForm({ ...form, techStack: e.target.value })} /></Field>
          <Field label="Sub-vertical"><input style={inputStyle} value={form.subVertical} onChange={(e) => setForm({ ...form, subVertical: e.target.value })} /></Field>
          <Field label="Competition"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.competition} onChange={(e) => setForm({ ...form, competition: e.target.value })} /></Field>
          <Field label="Competitive advantage"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.competitiveAdvantage} onChange={(e) => setForm({ ...form, competitiveAdvantage: e.target.value })} /></Field>
          <Field label="Paying customer count"><input style={inputStyle} value={form.payingCustomerCount} onChange={(e) => setForm({ ...form, payingCustomerCount: e.target.value })} /></Field>
          <Field label="Notable customers"><input style={inputStyle} value={form.notableCustomers} onChange={(e) => setForm({ ...form, notableCustomers: e.target.value })} /></Field>
          <Field label="Key milestones"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.keyMilestones} onChange={(e) => setForm({ ...form, keyMilestones: e.target.value })} /></Field>
          <Field label="Past fund raised (amount, investors, date)"><input style={inputStyle} value={form.pastFundRaised} onChange={(e) => setForm({ ...form, pastFundRaised: e.target.value })} /></Field>
          <Field label="Currently raising capital?">
            <select style={inputStyle} value={form.currentlyRaisingCapital} onChange={(e) => setForm({ ...form, currentlyRaisingCapital: e.target.value })}>
              <option value="">— None —</option><option>Yes</option><option>No</option>
            </select>
          </Field>
          <Field label="Interested in fundraising support from RIV?">
            <select style={inputStyle} value={form.fundraisingSupportInterest} onChange={(e) => setForm({ ...form, fundraisingSupportInterest: e.target.value })}>
              <option value="">— None —</option><option>Yes</option><option>No</option>
            </select>
          </Field>
          <Field label="Anything else"><textarea style={{ ...inputStyle, minHeight: 50 }} value={form.additionalNotes} onChange={(e) => setForm({ ...form, additionalNotes: e.target.value })} /></Field>
          <PrimaryButton onClick={createStartup} disabled={!form.startupName || !form.email} style={{ width: "100%" }}>Create startup</PrimaryButton>
        </Modal>
      )}
      {detailStartupId && <StartupDetailModal startupId={detailStartupId} onClose={() => setDetailStartupId(null)} />}
      {editingStartup && <EditStartupModal startup={editingStartup} onClose={() => setEditingStartup(null)} onSaved={load} />}
    </div>
  );
}

// Inline reject-with-reason control for AdminRetailersView — collapsed to
// a single "Reject" link until clicked, then expands into a required
// reason field so the comment isn't an afterthought.
function RejectRetailerRow({ onReject }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return (
    <div style={{ marginTop: 10 }}>
      <GhostButton onClick={() => setOpen(true)} style={{ color: BRAND.coralDark }}>Reject</GhostButton>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input style={{ ...inputStyle, flex: 1 }} placeholder="Reason for rejecting (shown to the partner)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      <PrimaryButton disabled={!reason.trim()} onClick={() => onReject(reason.trim())} style={{ background: BRAND.coralDark }}>Confirm reject</PrimaryButton>
      <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
    </div>
  );
}

// item 4 (25 Sep 2026 batch) tabs — filters the same retailer list by
// network_source; "All" shows everything.
const ADMIN_RETAILER_TABS = [
  { id: "GTM Partner", label: "GTM Partner Network" },
  { id: "RIV Direct", label: "RIV Direct" },
  { id: "All", label: "All" },
];
// 9 Oct 2026 batch, item 2 — full admin edit for a retailer, every field
// PUT /admin/retailers/:id accepts, including network source / GTM partner
// and status, so RIV admin can correct anything as final decision-maker.
function EditRetailerModal({ retailer, partners, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: retailer.name || "", brand: retailer.brand || "", website: retailer.website || "",
    hqCountry: retailer.hq_country || "", category: retailer.category || "", location: retailer.location || "",
    networkSource: retailer.network_source || "RIV Direct", owningPartnerId: retailer.owning_partner_id || "",
    contactName: retailer.contact_name || "", contactDesignation: retailer.contact_designation || "",
    contactEmail: retailer.contact_email || "", contactPhone: retailer.contact_phone || "",
    riv_owner: retailer.riv_owner || "", status: retailer.status || "Active in network",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const gtmPartnerMissing = form.networkSource === "GTM Partner" && !form.owningPartnerId;

  async function save() {
    setError(""); setBusy(true);
    try {
      await api.updateRetailer(retailer.id, { ...form, owningPartnerId: form.owningPartnerId || null });
      await onSaved();
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit ${retailer.brand || retailer.name}`} onClose={onClose} width={520}>
      <ErrorBanner text={error} />
      <Field label="Name" required><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Brand"><input style={inputStyle} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
      <Field label="Website"><input style={inputStyle} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
      <Field label="Category"><input style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
      <Field label="Location"><input style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
      <Field label="HQ country"><input style={inputStyle} value={form.hqCountry} onChange={(e) => setForm({ ...form, hqCountry: e.target.value })} /></Field>
      <Field label="Network source">
        <select style={inputStyle} value={form.networkSource} onChange={(e) => setForm({ ...form, networkSource: e.target.value, owningPartnerId: e.target.value === "GTM Partner" ? form.owningPartnerId : "" })}>
          <option>RIV Direct</option><option>GTM Partner</option>
        </select>
      </Field>
      {/* item 8 — relabeled "GTM partner" (was "Owning partner"), required
          whenever a retailer sits in a GTM partner's network. */}
      {form.networkSource === "GTM Partner" && (
        <Field label="GTM partner" required hint={gtmPartnerMissing ? "Required for a GTM Partner–network retailer." : undefined}>
          <select style={inputStyle} value={form.owningPartnerId} onChange={(e) => setForm({ ...form, owningPartnerId: e.target.value })}>
            <option value="">Select…</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Contact name"><input style={inputStyle} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
      <Field label="Contact designation"><input style={inputStyle} value={form.contactDesignation} onChange={(e) => setForm({ ...form, contactDesignation: e.target.value })} /></Field>
      <Field label="Contact email"><input style={inputStyle} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
      <Field label="Contact phone"><input style={inputStyle} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
      <Field label="RIV owner"><input style={inputStyle} value={form.riv_owner} onChange={(e) => setForm({ ...form, riv_owner: e.target.value })} /></Field>
      <Field label="Status">
        <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option>Active in network</option><option>Prospect</option><option>In Process</option><option>Duplicate</option><option>Rejected</option>
        </select>
      </Field>
      <PrimaryButton onClick={save} disabled={busy || !form.name || gtmPartnerMissing} style={{ width: "100%" }}>Save changes</PrimaryButton>
    </Modal>
  );
}

function AdminRetailersView() {
  const [retailers, setRetailers] = useState(null);
  const [partners, setPartners] = useState([]);
  const [error, setError] = useState("");
  const [success, showSuccess] = useSuccessMessage();
  const [showNew, setShowNew] = useState(false);
  const [tab, setTab] = useState("All");
  const [form, setForm] = useState({ name: "", brand: "", website: "", hqCountry: "", category: "", location: "", networkSource: "RIV Direct", owningPartnerId: "", contactName: "", contactDesignation: "", contactEmail: "", contactPhone: "" });
  const [editingRetailer, setEditingRetailer] = useState(null);
  // item 8 — GTM partner is mandatory once Network source is "GTM Partner".
  const gtmPartnerMissing = form.networkSource === "GTM Partner" && !form.owningPartnerId;

  const load = useCallback(() => api.listRetailersAdmin().then((r) => setRetailers(r.retailers)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); api.listPartners().then((r) => setPartners(r.partners)).catch(() => {}); }, [load]);

  async function createRetailer() {
    setError("");
    try {
      await api.createRetailer({ ...form, owningPartnerId: form.owningPartnerId || null });
      setShowNew(false);
      setForm({ name: "", brand: "", website: "", hqCountry: "", category: "", location: "", networkSource: "RIV Direct", owningPartnerId: "", contactName: "", contactDesignation: "", contactEmail: "", contactPhone: "" });
      load();
      showSuccess(`${form.brand || form.name} was added as a new retailer.`);
    } catch (e) { setError(e.message); }
  }
  async function approve(id) {
    setError("");
    try { await api.approveRetailer(id); load(); }
    catch (e) { setError(e.message); }
  }
  async function markInProcess(id) {
    setError("");
    try { await api.markRetailerInProcess(id); load(); }
    catch (e) { setError(e.message); }
  }
  async function reject(id, reason) {
    setError("");
    try { await api.rejectRetailer(id, reason); load(); }
    catch (e) { setError(e.message); }
  }

  if (error) return <ErrorBanner text={error} />;
  const visibleRetailers = (retailers || []).filter((r) => tab === "All" || r.network_source === tab);
  return (
    <div>
      <SuccessBanner text={success} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {ADMIN_RETAILER_TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              fontFamily: FONT, fontWeight: 600, fontSize: 12.5, padding: "8px 12px", borderRadius: 8,
              border: "none", cursor: "pointer",
              background: tab === t.id ? BRAND.cream : "transparent",
              color: tab === t.id ? BRAND.coral : "#7A756F",
            }}>
              {t.label}
            </button>
          ))}
        </div>
        <PrimaryButton icon={Plus} onClick={() => setShowNew(true)}>New retailer</PrimaryButton>
      </div>
      {!retailers ? <Spinner /> : !visibleRetailers.length ? (
        <EmptyState icon={Building2} title="No retailers here" text="Add a retailer to build out the directory." />
      ) : visibleRetailers.map((r) => (
        <Card key={r.id} style={{ padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{r.brand || r.name}</div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>{r.category} · {r.location}{r.hq_country ? `, ${r.hq_country}` : ""} · {r.network_source}{r.owning_partner_name ? ` (${r.owning_partner_name})` : ""}</div>
              <div style={{ fontFamily: FONT, fontSize: 11, color: "#B7B2AE", marginTop: 5 }}>Contact: {r.contact_name || "—"}{r.contact_designation ? ` (${r.contact_designation})` : ""} · {r.contact_email || "—"} · {r.contact_phone || "—"}</div>
              {r.rejection_reason && (
                <div style={{ fontFamily: FONT, fontSize: 11.5, color: BRAND.coralDark, marginTop: 6 }}>Rejected: {r.rejection_reason}</div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <StatusBadge status={r.status} colors={RETAILER_STATUS_COLORS} label={retailerStatusLabelForAdmin(r.status)} />
              <GhostButton onClick={() => setEditingRetailer(r)}>Edit</GhostButton>
              {["Prospect", "Duplicate"].includes(r.status) && <GhostButton onClick={() => markInProcess(r.id)}>Mark In Process</GhostButton>}
              {r.status !== "Active in network" && r.status !== "Rejected" && <PrimaryButton onClick={() => approve(r.id)}>Approve</PrimaryButton>}
            </div>
          </div>
          {r.status === "Duplicate" && (
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#8A6D00", background: "#FFF9DB", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
              Possible duplicate of <strong>{r.duplicate_of_name || `retailer #${r.duplicate_of_retailer_id}`}</strong> — compare before approving.
            </div>
          )}
          {r.status !== "Active in network" && r.status !== "Rejected" && (
            <RejectRetailerRow onReject={(reason) => reject(r.id, reason)} />
          )}
        </Card>
      ))}
      {showNew && (
        <Modal title="New retailer" onClose={() => setShowNew(false)}>
          <ErrorBanner text={error} />
          <Field label="Name" required><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Brand"><input style={inputStyle} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
          <Field label="Website"><input style={inputStyle} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
          <Field label="Category"><input style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
          <Field label="Location"><input style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="HQ country"><input style={inputStyle} value={form.hqCountry} onChange={(e) => setForm({ ...form, hqCountry: e.target.value })} /></Field>
          <Field label="Network source">
            <select style={inputStyle} value={form.networkSource} onChange={(e) => setForm({ ...form, networkSource: e.target.value, owningPartnerId: e.target.value === "GTM Partner" ? form.owningPartnerId : "" })}>
              <option>RIV Direct</option><option>GTM Partner</option>
            </select>
          </Field>
          {/* item 8 (9 Oct 2026 batch) — relabeled "GTM partner" (was
              "Owning partner") and made required whenever a retailer is
              being added to a GTM partner's network, not just optional. */}
          {form.networkSource === "GTM Partner" && (
            <Field label="GTM partner" required hint={gtmPartnerMissing ? "Required for a GTM Partner–network retailer." : undefined}>
              <select style={inputStyle} value={form.owningPartnerId} onChange={(e) => setForm({ ...form, owningPartnerId: e.target.value })}>
                <option value="">Select…</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Contact name"><input style={inputStyle} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
          <Field label="Contact designation"><input style={inputStyle} value={form.contactDesignation} onChange={(e) => setForm({ ...form, contactDesignation: e.target.value })} /></Field>
          <Field label="Contact email"><input style={inputStyle} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
          <Field label="Contact phone"><input style={inputStyle} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
          <PrimaryButton onClick={createRetailer} disabled={!form.name || gtmPartnerMissing} style={{ width: "100%" }}>Create retailer</PrimaryButton>
        </Modal>
      )}
      {editingRetailer && (
        <EditRetailerModal retailer={editingRetailer} partners={partners} onClose={() => setEditingRetailer(null)} onSaved={load} />
      )}
    </div>
  );
}

// item 3 (25 Sep 2026 batch) tabs — same visual pattern as
// AdminRetailersView's ADMIN_RETAILER_TABS/tab strip above, filtering the
// same introductions list by initiated_by instead of network_source.
const ADMIN_INTRO_TABS = [
  { id: "Startup", label: "Requested by Startup" },
  { id: "GTM Partner", label: "Proposed by GTM Partner" },
  { id: "RIV Admin", label: "Initiated by RIV" },
  { id: "All", label: "All" },
];
// A tab's badge counts rows still needing attention (Pending RIV Approval
// or GTM Notified) within that initiator, regardless of the status
// dropdown filter above — computed off the full `intros` list.
function introTabBadgeCount(intros, initiatedBy) {
  return (intros || []).filter((i) => i.initiated_by === initiatedBy && ["Pending RIV Approval", "GTM Notified"].includes(i.approval_status)).length;
}

function AdminIntroductionsView() {
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState("All");
  // View Details (19 Sep 2026 addendum) — lets RIV admin see an
  // introduction's uploaded supporting material files. Intentionally
  // admin-only: the GTM partner's own detail modal (IntroDetailModal)
  // does not surface this and per RIV's explicit call should not.
  const [openIntroDetails, setOpenIntroDetails] = useState(null);
  // "New Opportunity" (24 Sep 2026 addendum, Scenario C) — RIV proposing an
  // opportunity directly to a startup, for RIV-Direct retailers only.
  const [showNewOpportunity, setShowNewOpportunity] = useState(false);
  const load = useCallback(() => api.listIntroductionsAdmin(filter || undefined).then((r) => setIntros(r.introductions)).catch((e) => setError(e.message)), [filter]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    setError("");
    try { await api.updateIntroductionAdmin(id, { status }); load(); }
    catch (e) { setError(e.message); }
  }
  async function approve(id) {
    setError("");
    try { await api.approveIntroduction(id); load(); }
    catch (e) { setError(e.message); }
  }
  async function reject(id) {
    setError("");
    try { await api.rejectIntroduction(id); load(); }
    catch (e) { setError(e.message); }
  }
  // item 8 (25 Sep 2026 batch): RIV-direct proof logging now requires an
  // uploaded file, same as the GTM partner's log-introduction flow — see
  // RivDirectProofRow below, which collects { channel, introductionDate }
  // plus the file and calls api.logRivProof directly (multipart), so this
  // just reloads the list once it's done.
  async function logProofDirect() {
    setError("");
    try { load(); } catch (e) { setError(e.message); }
  }
  // 21 Sep 2026 addendum — the startup's own "Confirm introduction" step
  // was removed from their login (per RIV's call), so a GTM-partner
  // introduction sitting at "GTM Notified" now has no way forward on its
  // own. RIV admin advances it manually here once they know the startup
  // is on board, so the partner can go on to log proof.
  async function markStartupConfirmed(id) {
    setError("");
    try { await api.updateIntroductionAdmin(id, { approvalStatus: "Startup Confirmed" }); load(); }
    catch (e) { setError(e.message); }
  }
  // 21 Sep 2026 addendum — Startup Commit Status (Tab 2 in the startup
  // login) moved to admin-recorded, per RIV's call. Admin sets it here
  // based on what the startup told them.
  async function setCommitStatus(id, startupCommitStatus) {
    setError("");
    try { await api.updateIntroductionAdmin(id, { startupCommitStatus }); load(); }
    catch (e) { setError(e.message); }
  }

  if (error) return <ErrorBanner text={error} />;
  const visibleIntros = (intros || []).filter((i) => tab === "All" || i.initiated_by === tab);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {ADMIN_INTRO_TABS.map((t) => {
            const badge = t.id === "All" ? 0 : introTabBadgeCount(intros, t.id);
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                fontFamily: FONT, fontWeight: 600, fontSize: 12.5, padding: "8px 12px", borderRadius: 8,
                border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                background: tab === t.id ? BRAND.cream : "transparent",
                color: tab === t.id ? BRAND.coral : "#7A756F",
              }}>
                {t.label}
                {badge > 0 && (
                  <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 10.5, background: BRAND.coral, color: "#fff", borderRadius: 999, padding: "1px 6px" }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select style={{ ...inputStyle, width: 220 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <PrimaryButton icon={Plus} onClick={() => setShowNewOpportunity(true)}>New Opportunity</PrimaryButton>
        </div>
      </div>
      {!intros ? <Spinner /> : !visibleIntros.length ? (
        <EmptyState icon={Handshake} title="No introductions" text="Nothing matches this filter yet." />
      ) : visibleIntros.map((i) => (
        <Card key={i.id} style={{ padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{i.startup_name} → {i.retailer_name}</div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>
                {i.partner_name ? `via ${i.partner_name}` : "RIV direct"} · Requested {dateStr(i.request_date)}{i.deal_value ? ` · Deal ${money(i.deal_value)} · Fee ${money(i.fee_amount_due)}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <StatusBadge status={interestStatusFor(i.approval_status)} colors={INTEREST_STATUS_COLORS} />
              <StatusBadge status={introducedStatusFor(i.status, i.engagement_stage)} colors={INTRODUCED_STATUS_COLORS} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
            <span style={{ fontFamily: FONT, fontSize: 10.5, color: "#B7B2AE" }}>Detail:</span>
            <StatusBadge status={i.approval_status} colors={APPROVAL_COLORS} />
            <StatusBadge status={i.status} />
          </div>
          {/* item 13b — amber duplicate banner, mirroring
              AdminRetailersView's retailer-duplicate banner style. */}
          {i.duplicate_of_introduction_id && (
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#8A6D00", background: "#FFF9DB", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
              Possible duplicate — {i.startup_name} was already introduced to {i.retailer_name} on {dateStr(i.duplicate_of_request_date)}, currently {interestStatusFor(i.duplicate_of_approval_status)}. Review before approving.
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <GhostButton onClick={() => setOpenIntroDetails(i)}>View Details</GhostButton>
          </div>
          {i.approval_status === "Pending RIV Approval" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <PrimaryButton onClick={() => approve(i.id)}>Approve</PrimaryButton>
              <GhostButton onClick={() => reject(i.id)}>Reject</GhostButton>
            </div>
          )}
          {i.approval_status === "GTM Notified" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
              <PrimaryButton onClick={() => markStartupConfirmed(i.id)}>Mark Startup Confirmed</PrimaryButton>
              <span style={{ fontFamily: FONT, fontSize: 11, color: "#9B958F" }}>Once you know the startup is on board — they no longer confirm this themselves.</span>
            </div>
          )}
          {!i.partner_id && i.approval_status === "Startup Confirmed" && (
            <RivDirectProofRow introId={i.id} onLogged={logProofDirect} />
          )}
          {i.initiated_by !== "Startup" && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: FONT, fontSize: 10.5, color: "#B7B2AE", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 }}>Startup Commit Status</div>
              <select style={{ ...inputStyle, width: 260 }} value={i.startup_commit_status || ""} onChange={(e) => e.target.value && setCommitStatus(i.id, e.target.value)}>
                <option value="">— Select —</option>
                {COMMIT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <select style={{ ...inputStyle, width: 260 }} value={i.status} onChange={(e) => setStatus(i.id, e.target.value)}>
              {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </Card>
      ))}
      {openIntroDetails && (
        <IntroDetailModal intro={openIntroDetails} onClose={() => setOpenIntroDetails(null)} isAdmin />
      )}
      {showNewOpportunity && (
        <NewOpportunityModal onClose={() => setShowNewOpportunity(false)} onCreated={async () => load()} />
      )}
    </div>
  );
}

// "New Opportunity" (24 Sep 2026 addendum, Scenario C) — RIV admin proposes
// an opportunity directly to a startup for a RIV-Direct retailer (no GTM
// partner in the loop). Retailer picker is deliberately limited to RIV
// Direct retailers — a GTM-network pairing belongs in that partner's own
// "Check Introduction Interest" flow instead (the backend route rejects a
// GTM-network retailerId too, this just keeps the picker from offering one
// in the first place).
function NewOpportunityModal({ onClose, onCreated }) {
  const [startups, setStartups] = useState(null);
  const [retailers, setRetailers] = useState(null);
  const [startupId, setStartupId] = useState("");
  const [retailerId, setRetailerId] = useState("");
  const [context, setContext] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listStartups().then((r) => setStartups(r.startups)).catch((e) => setError(e.message));
    api.listRetailersAdmin().then((r) => setRetailers(r.retailers.filter((x) => x.network_source === "RIV Direct"))).catch((e) => setError(e.message));
  }, []);

  async function submit() {
    setError(""); setBusy(true);
    try {
      await api.createIntroductionAdmin({ startupId: Number(startupId), retailerId: Number(retailerId), context: context || undefined });
      await onCreated();
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const loading = !startups || !retailers;
  return (
    <Modal title="New Opportunity" onClose={onClose} width={520}>
      <ErrorBanner text={error} />
      <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#9B958F", marginBottom: 14, lineHeight: 1.6 }}>
        Proposes this retailer to the startup directly — lands on "Startup Confirmed" right away (no GTM partner in the loop) and notifies the startup in-app.
      </div>
      {loading ? <Spinner /> : (
        <>
          <Field label="Startup" required>
            <select style={inputStyle} value={startupId} onChange={(e) => setStartupId(e.target.value)}>
              <option value="">Select a startup…</option>
              {startups.map((s) => <option key={s.id} value={s.id}>{s.startup_name}</option>)}
            </select>
          </Field>
          <Field label="Retailer" required hint="Only RIV-Direct retailers show here — GTM-network retailers go through that partner's Check Introduction Interest flow instead.">
            <select style={inputStyle} value={retailerId} onChange={(e) => setRetailerId(e.target.value)}>
              <option value="">Select a retailer…</option>
              {retailers.map((r) => <option key={r.id} value={r.id}>{r.brand || r.name}</option>)}
            </select>
          </Field>
          <Field label="Opportunity context" hint="Why this pairing, for the startup to see on View Details.">
            <textarea style={{ ...inputStyle, minHeight: 70 }} value={context} onChange={(e) => setContext(e.target.value)} />
          </Field>
          {!retailers.length && (
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#B8790A", background: "#FFF4E0", borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
              No RIV-Direct retailers in the directory yet.
            </div>
          )}
          <PrimaryButton onClick={submit} disabled={busy || !startupId || !retailerId} style={{ width: "100%" }}>Create opportunity</PrimaryButton>
        </>
      )}
    </Modal>
  );
}

// Inline "log the introduction myself" row for admin — only needed on RIV
// Direct introductions, where there's no GTM partner login to do it.
//
// item 8 (25 Sep 2026 batch): brought in line with the GTM partner's own
// log-introduction flow — a required uploaded screenshot/PDF, not just
// free text. No signed declaration checkbox (admin is already trusted).
function RivDirectProofRow({ introId, onLogged }) {
  const [channel, setChannel] = useState("Email");
  const [introductionDate, setIntroductionDate] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError(""); setBusy(true);
    try {
      await api.logRivProof(introId, { channel, introductionDate: introductionDate || undefined }, file);
      await onLogged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 10, padding: "10px 12px", background: BRAND.cream, borderRadius: 10 }}>
      <ErrorBanner text={error} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ ...inputStyle, width: 140 }} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="Email">Email</option>
          <option value="WhatsApp">WhatsApp</option>
          <option value="LinkedIn">LinkedIn</option>
          <option value="In-person">In-person</option>
        </select>
        <input style={{ ...inputStyle, width: 160 }} type="date" value={introductionDate} onChange={(e) => setIntroductionDate(e.target.value)} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT, fontSize: 12.5, cursor: "pointer" }}>
          <Paperclip size={13} />
          {file ? file.name : "Attach proof (screenshot/PDF)"}
          <input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <PrimaryButton disabled={!file || busy} onClick={submit}>Log introduction</PrimaryButton>
      </div>
    </div>
  );
}

function AdminInvoicesView() {
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.listInvoices().then((r) => setInvoices(r.invoices)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    setError("");
    try { await api.updateInvoice(id, { status }); load(); }
    catch (e) { setError(e.message); }
  }

  if (error) return <ErrorBanner text={error} />;
  if (!invoices) return <Spinner />;
  if (!invoices.length) return <EmptyState icon={FileText} title="No invoices yet" text="Raise an invoice from a Closed – Won introduction's admin view." />;
  return (
    <div>
      {invoices.map((inv) => (
        <Card key={inv.id} style={{ padding: 16, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>Invoice #{inv.id} — {inv.startup_name}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>{money(inv.amount)} · {inv.payment_terms} · Due {dateStr(inv.due_date)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusBadge status={inv.status} />
            <select style={{ ...inputStyle, width: 130 }} value={inv.status} onChange={(e) => setStatus(inv.id, e.target.value)}>
              <option>Draft</option><option>Sent</option><option>Paid</option><option>Overdue</option>
            </select>
          </div>
        </Card>
      ))}
    </div>
  );
}

function AdminPayoutsView() {
  const [payouts, setPayouts] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.listPayouts().then((r) => setPayouts(r.payouts)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    setError("");
    try { await api.updatePayout(id, { status }); load(); }
    catch (e) { setError(e.message); }
  }

  if (error) return <ErrorBanner text={error} />;
  if (!payouts) return <Spinner />;
  if (!payouts.length) return <EmptyState icon={DollarSign} title="No payouts yet" text="Payouts to GTM partners will appear here once created." />;
  return (
    <div>
      {payouts.map((po) => (
        <Card key={po.id} style={{ padding: 16, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>Payout #{po.id} — {po.partner_name}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>{money(po.amount)} ({po.pct_applied}% applied)</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusBadge status={po.status} />
            <select style={{ ...inputStyle, width: 130 }} value={po.status} onChange={(e) => setStatus(po.id, e.target.value)}>
              <option>Pending</option><option>Paid</option>
            </select>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* =========================================================================
   ROOT
   ========================================================================= */
export default function RiseGtmApp() {
  const [user, setUser] = useState(() => getStoredUser());
  const [view, setView] = useState(null);
  const [openIntro, setOpenIntro] = useState(null);
  const [requestRetailer, setRequestRetailer] = useState(null);
  const [showAddRetailer, setShowAddRetailer] = useState(false);
  const [detailStartupId, setDetailStartupId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useDisableNumberInputScroll();

  useEffect(() => {
    if (user && !view) {
      setView(user.role === "admin" ? "overview" : user.role === "partner" ? "startups" : "retailers");
    }
  }, [user, view]);

  function logout() {
    clearSession();
    setUser(null);
    setView(null);
  }
  function refresh() { setRefreshKey((k) => k + 1); }

  if (!user) return (
    <>
      <GlobalStyle />
      <LoginView onAuthed={(u) => { setUser(u); }} />
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: BRAND.cream }}>
      <GlobalStyle />
      <NavBar view={view} setView={setView} user={user} onLogout={logout} />
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "28px 24px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: BRAND.ink }}>
            {navItemsFor(user.role).find((it) => it.id === view)?.label || view?.replace(/-/g, " ")}
          </div>
          {user.role === "partner" && view === "retailers" && (
            <PrimaryButton icon={Plus} onClick={() => setShowAddRetailer(true)} style={{ padding: "8px 14px" }}>Add Retailer to RIV network</PrimaryButton>
          )}
        </div>

        {user.role === "partner" && view === "startups" && <PartnerStartupsView onViewDetails={setDetailStartupId} />}
        {user.role === "partner" && view === "retailers" && <RetailerDirectoryView user={user} onRequest={() => {}} />}
        {user.role === "partner" && view === "introduce" && (
          <IntroduceStartupToRetailersView refreshKey={refreshKey} onOpen={setOpenIntro} onCreated={async () => refresh()} />
        )}
        {user.role === "partner" && view === "dashboard" && <PartnerDashboardView refreshKey={refreshKey} />}
        {user.role === "startup" && view === "introductions-requested" && (
          <RetailIntroductionsRequestedView refreshKey={refreshKey} />
        )}
        {user.role === "startup" && view === "introductions-initiated" && (
          <RetailIntroductionsInitiatedByRivView refreshKey={refreshKey} />
        )}
        {user.role === "startup" && view === "retailers" && <RetailerDirectoryView user={user} onRequest={setRequestRetailer} />}

        {user.role === "admin" && view === "overview" && <AdminOverview onNavigate={setView} />}
        {user.role === "admin" && view === "partners" && <AdminPartnersView />}
        {user.role === "admin" && view === "startups" && <AdminStartupsView />}
        {user.role === "admin" && view === "retailers" && <AdminRetailersView />}
        {user.role === "admin" && view === "introductions" && <AdminIntroductionsView />}
        {user.role === "admin" && view === "invoices" && <AdminInvoicesView />}
        {user.role === "admin" && view === "payouts" && <AdminPayoutsView />}
      </div>

      {openIntro && <IntroDetailModal intro={openIntro} user={user} onClose={() => setOpenIntro(null)} onRefresh={async () => refresh()} />}
      {requestRetailer && <RequestIntroductionModal retailer={requestRetailer} onClose={() => setRequestRetailer(null)} onCreated={async () => refresh()} />}
      {showAddRetailer && <AddRetailerModal onClose={() => setShowAddRetailer(false)} onCreated={async () => refresh()} />}
      {detailStartupId && <StartupDetailModal startupId={detailStartupId} onClose={() => setDetailStartupId(null)} />}
    </div>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
      * { box-sizing: border-box; }
      button:focus-visible { outline: 2px solid ${BRAND.coral}; outline-offset: 2px; }
      input:focus, select:focus, textarea:focus { outline: 2px solid ${BRAND.coral}; outline-offset: 0; }
      .gtm-portal-spin { animation: gtm-portal-spin 0.9s linear infinite; }
      @keyframes gtm-portal-spin { to { transform: rotate(360deg); } }
      /* 9 Oct 2026 batch, items 2 & 7 — remove the native up/down spinner
         arrows from every number input in the app (commission/rate fields,
         Opportunity Value, Deal Value, etc.) */
      input[type=number]::-webkit-outer-spin-button,
      input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      input[type=number] { -moz-appearance: textfield; appearance: textfield; }
    `}</style>
  );
}
// 9 Oct 2026 batch, item 2 — a number input's value silently changes when
// the page is scrolled while that input happens to be focused (the
// browser's default scroll-to-change-value behavior on type="number").
// Blurring the focused number input on any wheel event neutralizes that
// without touching individual inputs one by one. Mounted once, for the
// lifetime of the authenticated app shell.
function useDisableNumberInputScroll() {
  useEffect(() => {
    function handleWheel() {
      const el = document.activeElement;
      if (el && el.tagName === "INPUT" && el.type === "number") el.blur();
    }
    document.addEventListener("wheel", handleWheel, { passive: true });
    return () => document.removeEventListener("wheel", handleWheel);
  }, []);
}
