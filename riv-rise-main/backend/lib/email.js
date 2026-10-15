// Transactional email via Resend's HTTP API (addendum).
//
// Calls Resend's REST endpoint directly with the built-in `fetch` (Node
// >=18, already this project's floor — see package.json) instead of
// adding the `resend` package, so this needs no new dependency and no
// lockfile change — just two env vars (see backend/.env.example):
//   RESEND_API_KEY - a Resend API key (Dashboard > API Keys)
//   EMAIL_FROM     - a sender address on a domain verified in Resend
//                    (Dashboard > Domains) — Resend rejects sends from an
//                    unverified domain.
//
// If either env var is missing, sendEmail() logs a warning and resolves
// instead of throwing, so a missing/misconfigured mail setup never takes
// down whatever request triggered the email — same "don't let a
// side-effect break the main flow" approach as supportingMaterialStorage.js.
const RESEND_URL = "https://api.resend.com/emails";

async function sendEmail({ to, subject, text, html }) {
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
      subject,
      text,
      ...(html ? { html } : {}),
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

// Acknowledgement email for a just-submitted "Request Intro" (startup
// branch of POST /api/introductions). Callers should fire this after the
// introduction row is already committed and the HTTP response already
// sent — a slow or failing email provider should never delay or fail the
// actual request. See routes/portal.js.
async function sendIntroductionRequestAck({ to, founderName, retailerName, requestedAt }) {
  const when = new Date(requestedAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const subject = `Introduction request received: ${retailerName}`;
  const text = `Hi ${founderName || "there"},

Thanks for submitting an introduction request to ${retailerName} on the RISE Portal.

RIV will review your request and follow up with next steps. You submitted this on ${when}.

— RISE Portal (Retail Innovation Ventures)`;
  const html = `<p>Hi ${founderName || "there"},</p>
<p>Thanks for submitting an introduction request to <strong>${retailerName}</strong> on the RISE Portal.</p>
<p>RIV will review your request and follow up with next steps. You submitted this on ${when}.</p>
<p>— RISE Portal (Retail Innovation Ventures)</p>`;

  return sendEmail({ to, subject, text, html });
}

module.exports = { sendEmail, sendIntroductionRequestAck };
