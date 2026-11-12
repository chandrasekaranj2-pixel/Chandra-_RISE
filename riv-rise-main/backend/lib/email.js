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


// --- Shared layout for the notification emails --------------------------
//
// Every notification below is built from the same few pieces (greeting,
// paragraphs, an optional facts block, an optional button, the sign-off) so
// they read as one family and stay in the voice of the welcome email.

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

// DATE columns come back from pg as JS Dates built at LOCAL midnight, so the
// calendar day is read with local getters (reading it in UTC would show the
// previous day on a server running east of UTC). ISO strings are accepted too.
function fmtDate(value) {
  if (!value) return "";
  let y, m, day;
  if (value instanceof Date) {
    [y, m, day] = [value.getFullYear(), value.getMonth(), value.getDate()];
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!match) return String(value);
    [y, m, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  }
  return new Date(Date.UTC(y, m, day)).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "UTC" });
}

function layout({ name, paragraphs, facts, cta, signoff = "The Retail Innovation Ventures Team" }) {
  const hi = `Hi ${name || "there"},`;
  const factLines = (facts || []).filter(([, v]) => v);
  const text = [
    hi,
    ...paragraphs,
    ...(factLines.length ? [factLines.map(([k, v]) => `${k}: ${v}`).join("\n")] : []),
    ...(cta ? [`${cta.label}: ${cta.url}`] : []),
    `Warm regards,\n${signoff}`,
  ].join("\n\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">
<p>${escapeHtml(hi)}</p>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
${factLines.length ? `<table style="border-collapse:collapse;margin:0 0 16px">${factLines.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#666">${escapeHtml(k)}</td><td style="padding:2px 0"><strong>${escapeHtml(v)}</strong></td></tr>`).join("")}</table>` : ""}
${cta ? `<p><a href="${escapeHtml(cta.url)}">${escapeHtml(cta.label)}</a></p>` : ""}
<p>Warm regards,<br>${escapeHtml(signoff)}</p>
</div>`;
  return { text, html };
}

const portalCta = (label = "Open the RISE Portal") => ({ label, url: `${appUrl()}/` });

// --- 3. Portal login ready (startup or GTM partner) ---------------------
// No password in the email, ever: the admin shares it separately.
function buildLoginReady({ name, email, rivOwner, role }) {
  const doWhat = role === "partner"
    ? "submit retailers and log the introductions you make"
    : "request introductions to retailers and follow each one";
  const { text, html } = layout({
    name,
    paragraphs: [
      `Your RISE Portal account is set up. You can sign in at ${appUrl()}/ using ${email}.`,
      `Your password was shared with you separately${rivOwner ? ` by ${rivOwner}` : ""}. We never send passwords by email.`,
      `Once you're in, you can ${doWhat}.`,
      "If anything doesn't work, just reply to this email.",
    ],
    cta: portalCta("Sign in to the RISE Portal"),
  });
  return { subject: "Your RISE Portal login is ready", text, html };
}

// --- 4. New opportunity from RIV ----------------------------------------
function buildNewOpportunity({ founderName, startupName, retailerName, context }) {
  const { text, html } = layout({
    name: founderName || startupName,
    paragraphs: [
      `We think ${retailerName} could be a strong fit for ${startupName}, and we'd like to introduce you.`,
      ...(context ? [`Why we picked them: ${context}`] : []),
      "Please sign in to the RISE Portal and tell us where you stand: OK to introduce, Already in touch, or Not a right customer.",
    ],
    cta: portalCta(),
  });
  return { subject: `A new retailer opportunity for ${oneLine(startupName)}: ${oneLine(retailerName)}`, text, html };
}

// --- 4b. Reminder for an unanswered opportunity -------------------------
function buildOpportunityReminder({ founderName, startupName, retailerName, hasPortalLogin }) {
  const { text, html } = layout({
    name: founderName || startupName,
    paragraphs: [
      `A few days ago we flagged ${retailerName} as a possible fit for ${startupName}, and we haven't heard back yet.`,
      hasPortalLogin
        ? "It only takes a moment: sign in to the RISE Portal and tell us whether it's OK to introduce, you're already in touch, or it's not a right customer."
        : "It only takes a moment: just reply to this email and tell us whether it's OK to introduce, you're already in touch, or it's not a right customer.",
      "If the timing isn't right, that's fine too. We just want to know so we can plan around it.",
    ],
    cta: hasPortalLogin ? portalCta() : undefined,
  });
  return { subject: `A quick reminder: ${oneLine(retailerName)} is waiting on your response`, text, html };
}

// --- 5. Request approved -------------------------------------------------
function buildRequestApproved({ founderName, startupName, retailerName }) {
  const { text, html } = layout({
    name: founderName || startupName,
    paragraphs: [
      `We've reviewed your request to be introduced to ${retailerName} and approved it.`,
      "What happens next: we'll arrange the introduction and email you as soon as it's made. You can follow progress any time in the RISE Portal.",
    ],
    cta: portalCta(),
  });
  return { subject: `Good news: your request to meet ${oneLine(retailerName)} is approved`, text, html };
}

// --- 6. Request not taken forward ---------------------------------------
function buildRequestRejected({ founderName, startupName, retailerName, rivOwner }) {
  const { text, html } = layout({
    name: founderName || startupName,
    paragraphs: [
      `Thank you for your request to be introduced to ${retailerName}. After reviewing it, we're not able to take this one forward right now.`,
      `That's no reflection on ${startupName}. If you'd like to talk it through or suggest another retailer, just reply${rivOwner ? ` and ${rivOwner} will pick it up` : ""}.`,
    ],
  });
  return { subject: `An update on your request for ${oneLine(retailerName)}`, text, html };
}

// --- 7. Startup confirmed: GTM partner can go ahead ----------------------
function buildPartnerGoAhead({ partnerName, startupName, retailerName }) {
  const { text, html } = layout({
    name: partnerName,
    paragraphs: [
      `${startupName} has confirmed they'd like to be introduced to ${retailerName}, so you're clear to make the introduction.`,
      "Once it's done, please log it in the RISE Portal with a screenshot or PDF as proof.",
      "Thank you for the help.",
    ],
    cta: portalCta(),
  });
  return { subject: `${oneLine(startupName)} is keen: please go ahead with the ${oneLine(retailerName)} introduction`, text, html };
}

// --- 8. Introduction made ------------------------------------------------
function buildIntroductionMade({ founderName, startupName, retailerName, introductionDate, channel }) {
  const { text, html } = layout({
    name: founderName || startupName,
    paragraphs: [
      `We've introduced ${startupName} to ${retailerName}.`,
      "The next step is yours: take the conversation forward with them, and keep the status up to date in the RISE Portal so we can help where it's useful.",
    ],
    facts: [["Introduced on", fmtDate(introductionDate)], ["How", channel]],
    cta: portalCta(),
  });
  return { subject: `You've been introduced to ${oneLine(retailerName)}`, text, html };
}

// --- 9. Invoice issued ---------------------------------------------------
function buildInvoiceIssued({ founderName, startupName, invoiceId, amount, dueDate, retailers, rivOwner }) {
  const { text, html } = layout({
    name: founderName || startupName,
    paragraphs: [
      `Your invoice for ${startupName} has been issued.`,
      `You can see the details in the RISE Portal. If something looks off, reply${rivOwner ? ` and ${rivOwner} will sort it out` : " and we'll sort it out"}.`,
    ],
    facts: [["Invoice", `#${invoiceId}`], ["Amount", money(amount)], ["Due", fmtDate(dueDate)], ["For", retailers]],
    cta: portalCta(),
  });
  const due = dueDate ? `, due ${fmtDate(dueDate)}` : "";
  return { subject: `Invoice #${invoiceId} from Retail Innovation Ventures: ${money(amount)}${due}`, text, html };
}

// --- 10. Payment received ------------------------------------------------
function buildPaymentReceived({ founderName, startupName, invoiceId, amount }) {
  const { text, html } = layout({
    name: founderName || startupName,
    paragraphs: [`We've received your payment of ${money(amount)} for invoice #${invoiceId}. Thank you, and thanks for being part of RISE.`],
  });
  return { subject: "Payment received, thank you", text, html };
}

// --- 11. Payout issued (GTM partner) --------------------------------------
function buildPayoutIssued({ partnerName, amount, retailers }) {
  const { text, html } = layout({
    name: partnerName,
    paragraphs: [
      `We've issued a payout of ${money(amount)} to you${retailers ? ` for ${retailers}` : ""}.`,
      "The full breakdown is in the RISE Portal. Thank you for the introductions.",
    ],
    cta: portalCta(),
  });
  return { subject: `Your RISE payout of ${money(amount)} has been issued`, text, html };
}

// --- Partner welcome (mirror of the startup welcome) ----------------------
function buildPartnerWelcome({ partnerName, rivOwner, hasPortalLogin }) {
  const contact = rivOwner ? `${rivOwner} is` : "Your RIV contact is";
  const bullets = [
    { title: "Introductions that matter.", body: "Bring us retailers who'd be a good fit for the startups in RISE, and make the introductions that open doors." },
    ...(hasPortalLogin
      ? [{ title: "Everything in one place.", body: "In your RISE Portal you can submit retailers, log each introduction you make, and follow where it stands." }]
      : []),
    { title: "A real person on our side.", body: `${contact} your point of contact. Reply to this email any time, and it comes straight to our team.` },
  ];
  const greetingName = partnerName || "there";
  const link = `${appUrl()}/`;
  const text = `Hi ${greetingName},

Welcome to Retail Innovation Ventures. We're delighted to have you on board as a GTM partner, and we're genuinely excited to work with you.

Here's what to expect from here:

${bullets.map((b) => `- ${b.title} ${b.body}`).join("\n")}
${hasPortalLogin ? `\nRISE Portal: ${link}\n` : ""}
We're looking forward to building this with you.

Warm regards,
The Retail Innovation Ventures Team`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">
<p>Hi ${escapeHtml(greetingName)},</p>
<p>Welcome to <strong>Retail Innovation Ventures</strong>. We're delighted to have you on board as a GTM partner, and we're genuinely excited to work with you.</p>
<p>Here's what to expect from here:</p>
<ul style="padding-left:20px">
${bullets.map((b) => `<li style="margin-bottom:8px"><strong>${escapeHtml(b.title)}</strong> ${escapeHtml(b.body)}</li>`).join("\n")}
</ul>
${hasPortalLogin ? `<p><a href="${escapeHtml(link)}">Open the RISE Portal</a></p>` : ""}
<p>We're looking forward to building this with you.</p>
<p>Warm regards,<br>The Retail Innovation Ventures Team</p>
</div>`;
  return { subject: "Welcome to Retail Innovation Ventures!", text, html };
}

async function sendPartnerWelcomeEmail({ to, partnerName, rivOwner, hasPortalLogin }) {
  const { subject, text, html } = buildPartnerWelcome({ partnerName, rivOwner, hasPortalLogin });
  return sendEmail({ to, subject, text, html, replyTo: adminNotifyEmail(), type: "partner-welcome" });
}

// --- 13. RIV team alert (to the shared inbox; off unless enabled) ---------
function buildRivAlert({ event, startupName, retailerName, detail }) {
  const body = `${detail}\n\nOpen it in the admin panel: ${appUrl()}/`;
  return {
    subject: `[RISE] ${oneLine(event)}: ${oneLine(startupName)} / ${oneLine(retailerName)}`,
    text: body,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6"><p>${escapeHtml(detail)}</p><p><a href="${escapeHtml(appUrl())}/">Open the admin panel</a></p></div>`,
  };
}

// Runs an email job so that it can never break (or noticeably slow) the
// request that triggered it: errors are logged and swallowed, and the wait
// is capped. Same "side effect must not take down the main flow" rule as
// the rest of this file.
async function safely(label, job, capMs = 4000) {
  const run = Promise.resolve().then(job).catch((err) => console.error(`${label} email failed:`, err));
  await Promise.race([run, new Promise((r) => setTimeout(r, capMs))]);
}

module.exports = {
  sendEmail,
  sendIntroductionRequestAck,
  sendStartupWelcomeEmail,
  buildIntroductionRequestAck,
  buildStartupWelcome,
  adminNotifyEmail,
  appUrl,
  safely,
  buildLoginReady,
  buildNewOpportunity,
  buildOpportunityReminder,
  buildRequestApproved,
  buildRequestRejected,
  buildPartnerGoAhead,
  buildIntroductionMade,
  buildInvoiceIssued,
  buildPaymentReceived,
  buildPayoutIssued,
  buildPartnerWelcome,
  sendPartnerWelcomeEmail,
  buildRivAlert,
};
