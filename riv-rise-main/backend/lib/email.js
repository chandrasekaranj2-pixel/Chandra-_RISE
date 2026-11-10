// Transactional email via Resend's HTTP API (addendum).
//
// Calls Resend's REST endpoint directly with the built-in `fetch` (Node
// >=18, already this project's floor — see package.json) instead of
// adding the `resend` package, so this needs no new dependency and no
// lockfile change. Env vars (see backend/.env.example):
//   RESEND_API_KEY     - a Resend API key (Dashboard > API Keys). Use a key
//                        created for RISE only (not RIOS's) so each app can
//                        be rotated/revoked independently.
//   EMAIL_FROM         - a sender address on a domain verified in Resend
//                        (Dashboard > Domains) — Resend rejects sends from an
//                        unverified domain.
//   ADMIN_NOTIFY_EMAIL - the shared RIV inbox, used as Reply-To on mail sent
//                        to startups so their replies reach RIV (defaults to
//                        contact@retailinnovation.ventures — RIOS uses the
//                        same inbox, hence the app=rise tag below).
//   APP_URL            - public URL of the portal, used for links in emails.
//
// If RESEND_API_KEY or EMAIL_FROM is missing, sendEmail() logs a warning and
// resolves instead of throwing, so a missing/misconfigured mail setup never
// takes down whatever request triggered the email — same "don't let a
// side-effect break the main flow" approach as supportingMaterialStorage.js.
const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_ADMIN_NOTIFY_EMAIL = "contact@retailinnovation.ventures";
const DEFAULT_APP_URL = "https://rise.retailinnovation.ai";

function adminNotifyEmail() {
  return process.env.ADMIN_NOTIFY_EMAIL || DEFAULT_ADMIN_NOTIFY_EMAIL;
}

function appUrl() {
  return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

// Header values must never contain line breaks (header injection via a
// crafted startup/retailer name).
function oneLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

// Resend tag values only allow ASCII letters, digits, "_" and "-".
function tagValue(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
}

// Every RISE email is tagged app=rise (plus a type) so RISE and RIOS traffic
// can be told apart in Resend's dashboard even though both use one domain.
async function sendEmail({ to, subject, text, html, replyTo, type }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.warn(`Email not sent (RESEND_API_KEY/EMAIL_FROM not configured): "${subject}" -> ${to}`);
    return { skipped: true };
  }

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `RISE Portal <${process.env.EMAIL_FROM}>`,
      to: [to],
      subject: oneLine(subject),
      text,
      ...(html ? { html } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      tags: [{ name: "app", value: "rise" }, ...(type ? [{ name: "type", value: tagValue(type) }] : [])],
    }),
  });

  if (!res.ok) {
    // Resend puts the useful detail (bad sender domain, bad key, etc.) in
    // the response body, not the status line — surface it to whoever's
    // reading server logs rather than just "Resend 403".
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 500)}`);
  }
  return { sent: true };
}

// Names come from user-entered data, so anything interpolated into an html
// body goes through this — a retailer called "AT&T" or "<b>Acme" should
// render as typed, not as markup.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Introduction-request acknowledgement -------------------------------

function buildIntroductionRequestAck({ founderName, retailerName, requestedAt }) {
  // timeZone is explicit because the server's own zone (usually UTC when
  // hosted) isn't what the reader expects. "IST" is appended by hand since
  // Intl rejects timeZoneName alongside dateStyle/timeStyle.
  const when = `${new Date(requestedAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  })} IST`;
  const greetingName = founderName || "there";
  const subject = `Introduction request received: ${retailerName}`;
  const text = `Hi ${greetingName},

Thanks for submitting an introduction request to ${retailerName} on the RISE Portal.

RIV will review your request and follow up with next steps. You submitted this on ${when}.

— RISE Portal (Retail Innovation Ventures)`;
  const html = `<p>Hi ${escapeHtml(greetingName)},</p>
<p>Thanks for submitting an introduction request to <strong>${escapeHtml(retailerName)}</strong> on the RISE Portal.</p>
<p>RIV will review your request and follow up with next steps. You submitted this on ${when}.</p>
<p>— RISE Portal (Retail Innovation Ventures)</p>`;
  return { subject, text, html };
}

// Acknowledgement email for a just-submitted "Request Intro" (startup
// branch of POST /api/introductions). See routes/portal.js.
async function sendIntroductionRequestAck({ to, founderName, retailerName, requestedAt }) {
  const { subject, text, html } = buildIntroductionRequestAck({ founderName, retailerName, requestedAt });
  return sendEmail({ to, subject, text, html, replyTo: adminNotifyEmail(), type: "request-ack" });
}

// --- Welcome to Retail Innovation Ventures ------------------------------

// Sent when RIV marks a startup "Onboarded" (see PUT /api/admin/startups/:id).
// A warm welcome from RIV — no login details or password. The RISE Portal
// bullet only appears if the startup actually has a portal login, so the
// email never points at something they can't use.
function buildStartupWelcome({ founderName, startupName, rivOwner, hasPortalLogin }) {
  const greetingName = founderName || startupName || "there";
  const company = startupName || "your startup";
  const contact = rivOwner ? `${rivOwner} is` : "Your RIV contact is";
  const link = `${appUrl()}/`;

  const bullets = [
    {
      title: "Introductions to retailers.",
      body: "We'll be introducing you to retailers that fit what you're building, whether through our own network or our GTM partners.",
    },
    ...(hasPortalLogin
      ? [{
          title: "You stay in control.",
          body: "Each introduction shows up in your RISE Portal, where you can see where it stands and confirm your interest.",
        }]
      : []),
    {
      title: "A real person on our side.",
      body: `${contact} your point of contact. Reply to this email any time, and it comes straight to our team.`,
    },
  ];

  const subject = `Welcome to Retail Innovation Ventures, ${oneLine(company)}!`;
  const text = `Hi ${greetingName},

Welcome to Retail Innovation Ventures. We're delighted to have ${company} on board, and we're genuinely excited to work with you.

Here's what to expect from here:

${bullets.map((b) => `- ${b.title} ${b.body}`).join("\n")}
${hasPortalLogin ? `\nRISE Portal: ${link}\n` : ""}
We're looking forward to building this with you.

Warm regards,
The Retail Innovation Ventures Team`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">
<p>Hi ${escapeHtml(greetingName)},</p>
<p>Welcome to <strong>Retail Innovation Ventures</strong>. We're delighted to have <strong>${escapeHtml(company)}</strong> on board, and we're genuinely excited to work with you.</p>
<p>Here's what to expect from here:</p>
<ul style="padding-left:20px">
${bullets.map((b) => `<li style="margin-bottom:8px"><strong>${escapeHtml(b.title)}</strong> ${escapeHtml(b.body)}</li>`).join("\n")}
</ul>
${hasPortalLogin ? `<p><a href="${escapeHtml(link)}">Open the RISE Portal</a></p>` : ""}
<p>We're looking forward to building this with you.</p>
<p>Warm regards,<br>The Retail Innovation Ventures Team</p>
</div>`;

  return { subject, text, html };
}

async function sendStartupWelcomeEmail({ to, founderName, startupName, rivOwner, hasPortalLogin }) {
  const { subject, text, html } = buildStartupWelcome({ founderName, startupName, rivOwner, hasPortalLogin });
  return sendEmail({ to, subject, text, html, replyTo: adminNotifyEmail(), type: "startup-welcome" });
}

module.exports = {
  sendEmail,
  sendIntroductionRequestAck,
  sendStartupWelcomeEmail,
  buildIntroductionRequestAck,
  buildStartupWelcome,
  adminNotifyEmail,
};
