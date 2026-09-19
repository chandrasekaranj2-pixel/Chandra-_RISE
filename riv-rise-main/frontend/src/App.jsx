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

function IntroDetailModal({ intro, user, onClose, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proof, setProof] = useState("");
  const [channel, setChannel] = useState("Email");
  const [followUpNote, setFollowUpNote] = useState("");
  const [engagementStage, setEngagementStage] = useState(intro.engagement_stage || "");
  const [dealValue, setDealValue] = useState("");
  const [poDocument, setPoDocument] = useState("");
  // Log-introduction acknowledgement (19 Sep 2026 feedback) — unlike the
  // other actions in this modal, which just close on success, "Log the
  // introduction" is the action the Confirm Introduction dropdowns route
  // the partner into, so it needs its own explicit confirmation rather
  // than silently closing.
  const [loggedAck, setLoggedAck] = useState(false);

  const isPartner = user.role === "partner";
  const isStartup = user.role === "startup";
  const isAdmin = user.role === "admin";

  async function run(fn) {
    setError(""); setBusy(true);
    try { await fn(); await onRefresh(); onClose(); }
    catch (err) { setError(err.message || "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function submitLogIntroduction() {
    setError(""); setBusy(true);
    try {
      await api.logIntroduction(intro.id, { channel, proofOfIntroduction: proof });
      await onRefresh();
      setLoggedAck(true);
    } catch (err) { setError(err.message || "Something went wrong."); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`${intro.startup_name} → ${intro.retailer_name}`} onClose={onClose} width={560}>
      <ErrorBanner text={error} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <StatusBadge status={intro.approval_status} colors={APPROVAL_COLORS} />
        {intro.engagement_stage && <StatusBadge status={intro.engagement_stage} />}
        <span style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>
          {intro.partner_name ? `Partner: ${intro.partner_name}` : "RIV direct"} · Intro rate {intro.intro_rate}% / Closure rate {intro.closure_rate}%
        </span>
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

      {intro.proof_of_introduction && (
        <div style={{ marginBottom: 14, fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>
          <strong>Proof of introduction</strong> ({intro.channel}, {dateStr(intro.introduction_date)}): {intro.proof_of_introduction}
        </div>
      )}

      {!!intro.follow_up_log?.length && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, marginBottom: 8 }}>Follow-up log</div>
          {intro.follow_up_log.map((f, i) => (
            <div key={i} style={{ fontFamily: FONT, fontSize: 12, color: "#7A756F", padding: "8px 0", borderTop: i ? `1px solid ${BRAND.line}` : "none" }}>
              <span style={{ color: "#B7B2AE" }}>{dateStr(f.date)} — {f.author}:</span> {f.note}
            </div>
          ))}
        </div>
      )}

      {/* Startup confirms after RIV has approved and the GTM partner has
          been notified (addendum §3's approval chain). */}
      {isStartup && intro.approval_status === "GTM Notified" && (
        <Card style={{ padding: 14, marginBottom: 14, background: "#FFF9F0" }}>
          <div style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink, marginBottom: 10, lineHeight: 1.6 }}>
            RIV has approved this request and notified {intro.partner_name || "RIV Ops"}. Confirm to let them make the introduction.
          </div>
          <PrimaryButton disabled={busy} onClick={() => run(() => api.confirmRequest(intro.id))}>Confirm introduction</PrimaryButton>
        </Card>
      )}
      {intro.approval_status === "Pending RIV Approval" && (
        <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#B8790A", padding: "10px 14px", background: "#FFF4E0", borderRadius: 10, marginBottom: 14 }}>
          Waiting on RIV's review before this moves forward.
        </div>
      )}
      {intro.approval_status === "Rejected" && (
        <div style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.coralDark, padding: "10px 14px", background: "#FBEAEA", borderRadius: 10, marginBottom: 14 }}>
          RIV declined this request.
        </div>
      )}

      {/* Partner logs proof once the startup has confirmed */}
      {isPartner && intro.approval_status === "Startup Confirmed" && (
        <Card style={{ padding: 14, marginBottom: 14 }}>
          {loggedAck ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT, fontSize: 12.5, color: "#1E7A34" }}>
              <CheckCircle2 size={16} />
              <span>Introduction logged. This pairing has moved forward — RIV can now see the proof on file.</span>
            </div>
          ) : (
            <>
              <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, marginBottom: 10 }}>Log the introduction</div>
              <Field label="Channel">
                <select style={inputStyle} value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option>Email</option><option>WhatsApp</option><option>In-person</option><option>Event</option>
                </select>
              </Field>
              <Field label="Proof of introduction" required hint="Forwarded email, screenshot link, or a short note.">
                <textarea style={{ ...inputStyle, minHeight: 70 }} value={proof} onChange={(e) => setProof(e.target.value)} />
              </Field>
              <PrimaryButton disabled={busy || !proof} onClick={submitLogIntroduction}>Log introduction</PrimaryButton>
            </>
          )}
        </Card>
      )}

      {/* Follow-up (either party, once Introduced/In Progress) */}
      {(isPartner || isStartup) && ["Introduced", "In Progress"].includes(intro.status) && (
        <Card style={{ padding: 14, marginBottom: 14 }}>
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
        <Card style={{ padding: 14, marginBottom: 14 }}>
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
        <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#1E7A34", padding: "10px 14px", background: "#E6F4EA", borderRadius: 10 }}>
          Deal closed — invoicing and payout are handled by RIV Admin.
        </div>
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
function RetailerDirectoryView({ user, onRequest }) {
  const [retailers, setRetailers] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.getRetailers().then((r) => setRetailers(r.retailers)).catch((e) => setError(e.message)), []);
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
              {user.role === "partner" && <StatusBadge status={r.status} colors={RETAILER_STATUS_COLORS} label={retailerStatusLabel(r.status)} />}
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

  return (
    <Modal title="Add Retailer to RIV network" onClose={onClose} width={520}>
      <ErrorBanner text={error} />
      <div style={{ fontFamily: FONT, fontSize: 11.5, color: "#9B958F", marginBottom: 14, lineHeight: 1.6 }}>
        Submissions are reviewed by RIV before appearing in the approved directory.
      </div>
      <Field label="Retail enterprise you are referring" required><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Brand you are introducing to"><input style={inputStyle} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
      <Field label="Website"><input style={inputStyle} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
      <Field label="City where enterprise is headquartered"><input style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
      <Field label="HQ country"><input style={inputStyle} value={form.hqCountry} onChange={(e) => setForm({ ...form, hqCountry: e.target.value })} /></Field>
      <Field label="Retail segment"><input style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
      <Field label="Enterprise contact — full name"><input style={inputStyle} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
      <Field label="Enterprise contact — designation"><input style={inputStyle} value={form.contactDesignation} onChange={(e) => setForm({ ...form, contactDesignation: e.target.value })} /></Field>
      <Field label="Enterprise contact — email"><input style={inputStyle} type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
      <Field label="Enterprise contact — phone"><input style={inputStyle} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
      <PrimaryButton onClick={submit} disabled={busy || !form.name} style={{ width: "100%" }}>Submit for review</PrimaryButton>
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

// Opportunity Value input — editable only once Introduction Status is
// "Introduced" AND Deal Status isn't yet "Closed - Won" (PRD Tab 1 items
// 9–10 / Tab 2 items 11–12); read-only display in every other case.
function OpportunityValueCell({ intro, onSave }) {
  const editable = intro.status === "Introduced" && intro.engagement_stage !== "Closed - Won";
  if (!editable) {
    return <span style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink }}>{money(intro.opportunity_value)}</span>;
  }
  return (
    <input
      style={{ ...inputStyle, minWidth: 130 }}
      type="number"
      defaultValue={intro.opportunity_value || ""}
      onBlur={(e) => e.target.value !== String(intro.opportunity_value || "") && onSave({ opportunityValue: e.target.value || null })}
    />
  );
}

// Startup Commit Status select — Tab 2 only (PRD Tab 2 items 5–8). Always
// editable (the startup can change its mind before RIV acts on it); saving
// fires the notify-RIV side effect on the backend.
function CommitStatusCell({ intro, onSave, busy }) {
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
function RetailIntroductionsRequestedView({ onOpen, refreshKey }) {
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
        columns={["Retailer Name", "Requested Date", "RIV Approval Status", "Introduction Status", "Deal Status", "Opportunity Value", "Last Updated", ""]}
        rows={rows}
        emptyIcon={ClipboardList}
        emptyTitle={intros.length ? "No requests match your search" : "No introduction requests yet"}
        emptyText={intros.length ? "Try a different retailer name or status." : "Use Retailer Directory to ask RIV to route you to a retailer."}
        renderRow={(i) => (
          <tr key={i.id}>
            <td style={{ ...cellStyle, fontWeight: 700 }}>{i.retailer_name}</td>
            <td style={cellStyle}>{dateStr(i.request_date)}</td>
            <td style={cellStyle}><StatusBadge status={i.approval_status} colors={APPROVAL_COLORS} /></td>
            <td style={cellStyle}><StatusBadge status={i.status} /></td>
            <td style={cellStyle}><DealStatusCell intro={i} onSave={(patch) => saveOpportunity(i.id, patch)} /></td>
            <td style={cellStyle}><OpportunityValueCell intro={i} onSave={(patch) => saveOpportunity(i.id, patch)} /></td>
            <td style={cellStyle}>{dateStr(i.updated_at)}</td>
            <td style={cellStyle}><GhostButton onClick={() => onOpen(i)} style={{ padding: "6px 12px" }}>View Details</GhostButton></td>
          </tr>
        )}
      />
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
function RetailIntroductionsInitiatedByRivView({ onOpen, refreshKey }) {
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
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
  async function saveCommitStatus(id, commitStatus) {
    setError(""); setSavingId(id);
    try { await api.updateCommitStatus(id, commitStatus); await load(); }
    catch (e) { setError(e.message); }
    finally { setSavingId(null); }
  }
  async function confirm(id) {
    setError(""); setBusyId(id);
    try { await api.confirmRequest(id); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  if (error) return <ErrorBanner text={error} />;
  if (!intros) return <Spinner />;
  const rows = filterIntros(intros, search, statusFilter);

  return (
    <div>
      <ErrorBanner text={error} />
      <IntroSearchBar search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
      <IntroTable
        columns={["Retailer Name", "Partner", "Initiated Date", "Startup Commit Status", "Introduction Status", "Deal Status", "Opportunity Value", "Last Updated", ""]}
        rows={rows}
        emptyIcon={Handshake}
        emptyTitle={intros.length ? "No opportunities match your search" : "No opportunities yet"}
        emptyText={intros.length ? "Try a different retailer name or status." : "Opportunities RIV identifies for you will appear here."}
        renderRow={(i) => {
          const isPartnerInitiated = i.initiated_by === "GTM Partner";
          return (
            <tr key={i.id}>
              <td style={{ ...cellStyle, fontWeight: 700 }}>{i.retailer_name}</td>
              <td style={cellStyle}>{isPartnerInitiated ? (i.partner_name || "—") : "RIV Admin"}</td>
              <td style={cellStyle}>{dateStr(i.request_date)}</td>
              <td style={cellStyle}>
                {isPartnerInitiated ? (
                  i.approval_status === "GTM Notified" ? (
                    <PrimaryButton disabled={busyId === i.id} onClick={() => confirm(i.id)} style={{ padding: "6px 12px" }}>Confirm</PrimaryButton>
                  ) : (
                    <StatusBadge status={i.approval_status} colors={APPROVAL_COLORS} />
                  )
                ) : (
                  <CommitStatusCell intro={i} busy={savingId === i.id} onSave={(v) => saveCommitStatus(i.id, v)} />
                )}
              </td>
              <td style={cellStyle}><StatusBadge status={i.status} /></td>
              <td style={cellStyle}><DealStatusCell intro={i} onSave={(patch) => saveOpportunity(i.id, patch)} /></td>
              <td style={cellStyle}><OpportunityValueCell intro={i} onSave={(patch) => saveOpportunity(i.id, patch)} /></td>
              <td style={cellStyle}>{dateStr(i.updated_at)}</td>
              <td style={cellStyle}><GhostButton onClick={() => onOpen(i)} style={{ padding: "6px 12px" }}>View Details</GhostButton></td>
            </tr>
          );
        }}
      />
    </div>
  );
}

// Read-only "View Details" modal, shared by both tabs. Tab 1 (item 12):
// "the complete introduction request, including supporting documents."
// Tab 2 (item 13): "the complete opportunity/request context and relevant
// supporting documents." No actions here on purpose — both screens are
// explicitly view-only for the startup beyond Deal Status/Opportunity
// Value (Tab 1 & 2) and Commit Status (Tab 2), which are edited inline in
// the table, not from this modal.
function IntroViewDetailsModal({ intro, onClose }) {
  const isRivInitiated = intro.initiated_by === "RIV Admin";
  const rows = [
    ["Retailer", intro.retailer_name],
    ["Category", intro.retailer_category],
    ["Network", intro.partner_name ? `via ${intro.partner_name}` : "RIV direct"],
    [isRivInitiated ? "Initiated Date" : "Requested Date", dateStr(intro.request_date)],
    ...(isRivInitiated ? [] : [["RIV Approval Status", intro.approval_status]]),
    ["Introduction Status", intro.status],
    ["Deal Status", intro.engagement_stage || "—"],
    ["Opportunity Value", money(intro.opportunity_value)],
    ...(isRivInitiated ? [["Startup Commit Status", intro.startup_commit_status || "Not yet responded"]] : []),
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
    ["Supporting material (link)", intro.supporting_material_url],
    // Partner-originated ("Introduce Startup to Retailers", 18 Sep 2026).
    ["Opportunity context", intro.gtm_context_note],
    ["How the partner introduced this", intro.how_introduced],
  ].filter(([, v]) => v);
  const proofRows = [
    ["Channel", intro.channel],
    ["Introduction date", intro.introduction_date ? dateStr(intro.introduction_date) : null],
    ["Proof of introduction", intro.proof_of_introduction],
  ].filter(([, v]) => v);
  const supportingMaterialFiles = intro.supporting_material || [];
  const [fileError, setFileError] = useState("");
  function openFile(index) {
    setFileError("");
    api.openSupportingMaterial(intro.id, index).catch((e) => setFileError(e.message));
  }

  return (
    <Modal title={intro.retailer_name} onClose={onClose} width={560}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${BRAND.line}` }}>
          <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F" }}>{label}</div>
          <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: BRAND.ink, textAlign: "right" }}>{value}</div>
        </div>
      ))}

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
        </div>
      )}

      {!!supportingMaterialFiles.length && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 12.5, color: BRAND.ink, marginBottom: 10 }}>Supporting material</div>
          {fileError && <div style={{ fontFamily: FONT, fontSize: 11.5, color: BRAND.coralDark, marginBottom: 8 }}>{fileError}</div>}
          {supportingMaterialFiles.map((file, i) => (
            <button
              key={i}
              type="button"
              onClick={() => openFile(i)}
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

      {!requestRows.length && !proofRows.length && !supportingMaterialFiles.length && (
        <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#9B958F", marginTop: 14 }}>No supporting documents on file yet.</div>
      )}
    </Modal>
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
function ConfirmIntroductionSection({ refreshKey, onOpen }) {
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState("");
  // Retailer/Startup dropdowns (19 Sep 2026 correction) — these are NOT a
  // general "browse all approved retailers/startups" picker like the
  // Introduce Startup to Retailers form below. A partner has nothing to do
  // here for a retailer/startup that has no pending confirmation, so the
  // options are built ONLY from what's actually in the Confirm Introduction
  // queue right now — never the full approved directory. The two lists
  // cascade off each other (picking a Retailer narrows Startup to only
  // pairings pending for that retailer, and vice versa) so it's impossible
  // to select a combination with nothing waiting. Selecting a pairing that
  // uniquely identifies one pending confirmation IS the action — it opens
  // straight into the existing "Log the Introduction" form (IntroDetailModal),
  // whose own submit now shows an explicit acknowledgement (see loggedAck
  // there) rather than silently closing.
  const [retailerFilter, setRetailerFilter] = useState("");
  const [startupFilter, setStartupFilter] = useState("");

  useEffect(() => { api.getConfirmQueue().then((r) => setIntros(r.introductions)).catch((e) => setError(e.message)); }, [refreshKey]);

  const retailerOptions = uniqueById(
    (intros || []).filter((i) => !startupFilter || String(i.startup_id) === startupFilter),
    (i) => i.retailer_id, (i) => i.retailer_name
  );
  const startupOptions = uniqueById(
    (intros || []).filter((i) => !retailerFilter || String(i.retailer_id) === retailerFilter),
    (i) => i.startup_id, (i) => i.startup_name
  );

  const matches = (intros || []).filter((i) => {
    if (retailerFilter && String(i.retailer_id) !== retailerFilter) return false;
    if (startupFilter && String(i.startup_id) !== startupFilter) return false;
    return true;
  });

  // The moment both dropdowns resolve to exactly one pending confirmation,
  // treat that selection as the action and open it.
  useEffect(() => {
    if (retailerFilter && startupFilter && matches.length === 1) {
      onOpen(matches[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retailerFilter, startupFilter, matches.length]);

  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 15, color: BRAND.ink, marginBottom: 4 }}>Confirm Introduction</div>
      <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginBottom: 12 }}>
        RIV has approved these and the startup has confirmed — select the retailer and startup below to log the introduction and move it forward.
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Field label="Retailer" hint="Only retailers with a pending confirmation can be selected." style={{ flex: "1 1 220px", marginBottom: 0 }}>
          <select style={inputStyle} value={retailerFilter} onChange={(e) => setRetailerFilter(e.target.value)} disabled={!intros || !intros.length}>
            <option value="">Select…</option>
            {retailerOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Startup" hint="Only startups with a pending confirmation can be selected." style={{ flex: "1 1 220px", marginBottom: 0 }}>
          <select style={inputStyle} value={startupFilter} onChange={(e) => setStartupFilter(e.target.value)} disabled={!intros || !intros.length}>
            <option value="">Select…</option>
            {startupOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorBanner text={error} />
      {!intros ? <Spinner /> : !intros.length ? (
        <EmptyState icon={Handshake} title="Nothing waiting on you" text="Pairings RIV or a startup proposes to you will land here once the startup confirms." />
      ) : matches.map((i) => (
        <Card key={i.id} onClick={() => onOpen(i)} style={{ padding: 16, marginBottom: 10, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{i.startup_name} <ArrowRight size={12} style={{ margin: "0 4px", verticalAlign: "middle" }} /> {i.retailer_name}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>Requested {dateStr(i.request_date)}</div>
          </div>
          <StatusBadge status={i.approval_status} colors={APPROVAL_COLORS} />
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

function IntroduceStartupToRetailersForm({ onCreated }) {
  const [retailers, setRetailers] = useState(null);
  const [startups, setStartups] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ retailerId: "", startupId: "", opportunityContext: "", howIntroduced: "" });
  const [declaration, setDeclaration] = useState(false);

  useEffect(() => {
    api.getRetailers().then((r) => setRetailers(r.retailers.filter((x) => x.status === "Active in network"))).catch((e) => setError(e.message));
    api.getStartups().then((r) => setStartups(r.startups)).catch((e) => setError(e.message));
  }, []);

  async function submit() {
    setError(""); setBusy(true);
    try {
      await api.createIntroduction({
        retailerId: Number(form.retailerId), startupId: Number(form.startupId),
        opportunityContext: form.opportunityContext, howIntroduced: form.howIntroduced,
        declarationAccepted: declaration,
      });
      setSent(true);
      setForm({ retailerId: "", startupId: "", opportunityContext: "", howIntroduced: "" });
      setDeclaration(false);
      await onCreated();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 15, color: BRAND.ink, marginBottom: 4 }}>Introduce Startup to Retailers</div>
      <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginBottom: 12 }}>
        Submit interest for introducing a retailer to this startup. RIV reviews every submission before anyone is notified.
      </div>
      <Card style={{ padding: 20, maxWidth: 520 }}>
        <ErrorBanner text={error} />
        {sent && (
          <div style={{ fontFamily: FONT, fontSize: 12.5, color: "#1E7A34", background: "#E6F4EA", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
            Submitted — RIV will review and route this back to you.
          </div>
        )}
        <Field label="Retailer" required hint="Only approved retailers can be selected.">
          <select style={inputStyle} value={form.retailerId} onChange={(e) => setForm({ ...form, retailerId: e.target.value })}>
            <option value="">Select…</option>
            {(retailers || []).map((r) => <option key={r.id} value={r.id}>{r.brand || r.name}</option>)}
          </select>
        </Field>
        <Field label="Startup" required hint="Only approved RISE startups can be selected.">
          <select style={inputStyle} value={form.startupId} onChange={(e) => setForm({ ...form, startupId: e.target.value })}>
            <option value="">Select…</option>
            {(startups || []).map((s) => <option key={s.id} value={s.id}>{s.startup_name}</option>)}
          </select>
        </Field>
        <Field label="Opportunity context" required hint="Why do you believe this introduction is relevant? What business problem or opportunity exists?">
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.opportunityContext} onChange={(e) => setForm({ ...form, opportunityContext: e.target.value })} />
        </Field>
        <Field label="How have you introduced the startup to the enterprise">
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.howIntroduced} onChange={(e) => setForm({ ...form, howIntroduced: e.target.value })} />
        </Field>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontFamily: FONT, fontSize: 12.5, color: BRAND.ink, lineHeight: 1.6 }}>Declaration — I confirm that I have personally facilitated this introduction. The information submitted is accurate to the best of my knowledge.</span>
        </label>
        <PrimaryButton
          disabled={busy || !form.retailerId || !form.startupId || !form.opportunityContext || !declaration}
          onClick={submit} style={{ width: "100%" }}
        >
          Submit interest for introducing retailer to this startup
        </PrimaryButton>
      </Card>
    </div>
  );
}

function IntroduceStartupToRetailersView({ refreshKey, onOpen, onCreated }) {
  return (
    <div>
      <ConfirmIntroductionSection refreshKey={refreshKey} onOpen={onOpen} />
      <IntroduceStartupToRetailersForm onCreated={onCreated} />
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
  useEffect(() => { api.getIntroductions().then((r) => setIntros(r.introductions)).catch((e) => setError(e.message)); }, [refreshKey]);
  if (error) return <ErrorBanner text={error} />;
  if (!intros) return <Spinner />;

  function expectedFee(i) {
    if (i.initiated_by !== "GTM Partner") return null;
    if (i.partner_fee_amount != null) return i.partner_fee_amount; // locked at Closed-Won
    if (!i.fee_amount_due) return null;
    return null; // not yet locked — nothing to show until a figure exists
  }

  return (
    <IntroTable
      columns={["Retailer", "Startup", "RIV Introduction Approval Status", "Introduction Status", "Deal Status", "Opportunity Value", "Expected GTM Success Fee"]}
      rows={intros}
      emptyIcon={Handshake}
      emptyTitle="No introductions yet"
      emptyText="Introductions you originate or that RIV routes to you will appear here."
      renderRow={(i) => (
        <tr key={i.id}>
          <td style={{ ...cellStyle, fontWeight: 700 }}>{i.retailer_name}</td>
          <td style={cellStyle}>{i.startup_name}</td>
          <td style={cellStyle}><StatusBadge status={i.approval_status} colors={APPROVAL_COLORS} label={i.approval_status === "RIV Approved" ? "Approved by RIV" : undefined} /></td>
          <td style={cellStyle}><StatusBadge status={i.status} label={i.status === "Introduced" ? "Retailer and Startup introduced" : undefined} /></td>
          <td style={cellStyle}>{i.engagement_stage ? <StatusBadge status={i.engagement_stage} colors={DEAL_STATUS_COLORS} /> : <span style={{ color: "#B7B2AE" }}>—</span>}</td>
          <td style={cellStyle}>{money(i.opportunity_value)}</td>
          <td style={cellStyle}>{expectedFee(i) != null ? money(expectedFee(i)) : <span style={{ color: "#B7B2AE" }}>—</span>}</td>
        </tr>
      )}
    />
  );
}

/* =========================================================================
   ADMIN VIEWS
   ========================================================================= */
function AdminOverview() {
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
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: BRAND.ink, marginBottom: 10 }}>By status</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {summary.statusCounts.map((s) => (
          <div key={s.status} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `1px solid ${BRAND.line}`, borderRadius: 10 }}>
            <StatusBadge status={s.status} /> <span style={{ fontFamily: FONT, fontSize: 12.5, fontWeight: 600 }}>{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminPartnersView() {
  const [partners, setPartners] = useState(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ fullName: "", company: "", email: "", phone: "", region: "" });
  const [provisioning, setProvisioning] = useState(null);
  const [pwField, setPwField] = useState("");

  const load = useCallback(() => api.listPartners().then((r) => setPartners(r.partners)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function createPartner() {
    setError("");
    try { await api.createPartner(form); setShowNew(false); setForm({ fullName: "", company: "", email: "", phone: "", region: "" }); load(); }
    catch (e) { setError(e.message); }
  }
  async function provision(p) {
    setError("");
    try { await api.provisionPartnerLogin(p.id, pwField); setProvisioning(null); setPwField(""); load(); }
    catch (e) { setError(e.message); }
  }

  if (error) return <ErrorBanner text={error} />;
  return (
    <div>
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
          </div>
          {p.portal_login_status !== "Provisioned" && (
            provisioning === p.id ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...inputStyle, width: 150 }} placeholder="Temp password" value={pwField} onChange={(e) => setPwField(e.target.value)} />
                <PrimaryButton onClick={() => provision(p)} disabled={pwField.length < 8}>Provision</PrimaryButton>
              </div>
            ) : <GhostButton onClick={() => setProvisioning(p.id)}>Provision login</GhostButton>
          )}
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
    </div>
  );
}

function AdminStartupsView() {
  const [startups, setStartups] = useState(null);
  const [error, setError] = useState("");
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
  const [detailStartupId, setDetailStartupId] = useState(null);

  const load = useCallback(() => api.listStartups().then((r) => setStartups(r.startups)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function createStartup() {
    setError("");
    try { await api.createStartup(form); setShowNew(false); setForm(blankForm); load(); }
    catch (e) { setError(e.message); }
  }
  async function provision(s) {
    setError("");
    try { await api.provisionStartupLogin(s.id, pwField); setProvisioning(null); setPwField(""); load(); }
    catch (e) { setError(e.message); }
  }

  if (error) return <ErrorBanner text={error} />;
  return (
    <div>
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
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <GhostButton onClick={() => setDetailStartupId(s.id)}>View Details</GhostButton>
            {s.portal_login_status !== "Provisioned" && (
              provisioning === s.id ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...inputStyle, width: 150 }} placeholder="Temp password" value={pwField} onChange={(e) => setPwField(e.target.value)} />
                  <PrimaryButton onClick={() => provision(s)} disabled={pwField.length < 8}>Provision</PrimaryButton>
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

function AdminRetailersView() {
  const [retailers, setRetailers] = useState(null);
  const [partners, setPartners] = useState([]);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", brand: "", website: "", hqCountry: "", category: "", location: "", networkSource: "RIV Direct", owningPartnerId: "", contactName: "", contactDesignation: "", contactEmail: "", contactPhone: "" });

  const load = useCallback(() => api.listRetailersAdmin().then((r) => setRetailers(r.retailers)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); api.listPartners().then((r) => setPartners(r.partners)).catch(() => {}); }, [load]);

  async function createRetailer() {
    setError("");
    try {
      await api.createRetailer({ ...form, owningPartnerId: form.owningPartnerId || null });
      setShowNew(false);
      setForm({ name: "", brand: "", website: "", hqCountry: "", category: "", location: "", networkSource: "RIV Direct", owningPartnerId: "", contactName: "", contactDesignation: "", contactEmail: "", contactPhone: "" });
      load();
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
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <PrimaryButton icon={Plus} onClick={() => setShowNew(true)}>New retailer</PrimaryButton>
      </div>
      {!retailers ? <Spinner /> : !retailers.length ? (
        <EmptyState icon={Building2} title="No retailers yet" text="Add a retailer to build out the directory." />
      ) : retailers.map((r) => (
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
              <StatusBadge status={r.status} colors={RETAILER_STATUS_COLORS} label={retailerStatusLabel(r.status)} />
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
            <select style={inputStyle} value={form.networkSource} onChange={(e) => setForm({ ...form, networkSource: e.target.value })}>
              <option>RIV Direct</option><option>GTM Partner</option>
            </select>
          </Field>
          {form.networkSource === "GTM Partner" && (
            <Field label="Owning partner">
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
          <PrimaryButton onClick={createRetailer} disabled={!form.name} style={{ width: "100%" }}>Create retailer</PrimaryButton>
        </Modal>
      )}
    </div>
  );
}

function AdminIntroductionsView() {
  const [intros, setIntros] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
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
  async function logProofDirect(id, proofOfIntroduction) {
    setError("");
    try { await api.updateIntroductionAdmin(id, { approvalStatus: "Proof Recorded", proofOfIntroduction, status: "Introduced" }); load(); }
    catch (e) { setError(e.message); }
  }

  if (error) return <ErrorBanner text={error} />;
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <select style={{ ...inputStyle, width: 240 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {!intros ? <Spinner /> : !intros.length ? (
        <EmptyState icon={Handshake} title="No introductions" text="Nothing matches this filter yet." />
      ) : intros.map((i) => (
        <Card key={i.id} style={{ padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: BRAND.ink }}>{i.startup_name} → {i.retailer_name}</div>
              <div style={{ fontFamily: FONT, fontSize: 12, color: "#9B958F", marginTop: 3 }}>
                {i.partner_name ? `via ${i.partner_name}` : "RIV direct"} · Requested {dateStr(i.request_date)}{i.deal_value ? ` · Deal ${money(i.deal_value)} · Fee ${money(i.fee_amount_due)}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusBadge status={i.approval_status} colors={APPROVAL_COLORS} />
              <StatusBadge status={i.status} />
            </div>
          </div>
          {i.approval_status === "Pending RIV Approval" && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <PrimaryButton onClick={() => approve(i.id)}>Approve</PrimaryButton>
              <GhostButton onClick={() => reject(i.id)}>Reject</GhostButton>
            </div>
          )}
          {!i.partner_id && i.approval_status === "Startup Confirmed" && (
            <RivDirectProofRow onSubmit={(proof) => logProofDirect(i.id, proof)} />
          )}
          <div style={{ marginTop: 10 }}>
            <select style={{ ...inputStyle, width: 260 }} value={i.status} onChange={(e) => setStatus(i.id, e.target.value)}>
              {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </Card>
      ))}
    </div>
  );
}

// Inline "log the introduction myself" row for admin — only needed on RIV
// Direct introductions, where there's no GTM partner login to do it.
function RivDirectProofRow({ onSubmit }) {
  const [proof, setProof] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input style={{ ...inputStyle, flex: 1 }} placeholder="Proof of introduction (RIV Direct — no partner to log this)" value={proof} onChange={(e) => setProof(e.target.value)} />
      <PrimaryButton disabled={!proof} onClick={() => onSubmit(proof)}>Log introduction</PrimaryButton>
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
  const [openIntroDetails, setOpenIntroDetails] = useState(null);
  const [requestRetailer, setRequestRetailer] = useState(null);
  const [showAddRetailer, setShowAddRetailer] = useState(false);
  const [detailStartupId, setDetailStartupId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
          <RetailIntroductionsRequestedView onOpen={setOpenIntroDetails} refreshKey={refreshKey} />
        )}
        {user.role === "startup" && view === "introductions-initiated" && (
          <RetailIntroductionsInitiatedByRivView onOpen={setOpenIntroDetails} refreshKey={refreshKey} />
        )}
        {user.role === "startup" && view === "retailers" && <RetailerDirectoryView user={user} onRequest={setRequestRetailer} />}

        {user.role === "admin" && view === "overview" && <AdminOverview />}
        {user.role === "admin" && view === "partners" && <AdminPartnersView />}
        {user.role === "admin" && view === "startups" && <AdminStartupsView />}
        {user.role === "admin" && view === "retailers" && <AdminRetailersView />}
        {user.role === "admin" && view === "introductions" && <AdminIntroductionsView />}
        {user.role === "admin" && view === "invoices" && <AdminInvoicesView />}
        {user.role === "admin" && view === "payouts" && <AdminPayoutsView />}
      </div>

      {openIntro && <IntroDetailModal intro={openIntro} user={user} onClose={() => setOpenIntro(null)} onRefresh={async () => refresh()} />}
      {openIntroDetails && <IntroViewDetailsModal intro={openIntroDetails} onClose={() => setOpenIntroDetails(null)} />}
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
    `}</style>
  );
}
