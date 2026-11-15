// Renders every email RISE sends (startups, GTM partners, the RIV inbox), using a sample "Test Startup"
// — no database, and no real send unless you ask for one.
//
//   node scripts/preview-emails.js
//       Writes email-preview/*.html and *.txt and prints each email, so the
//       content can be checked by eye (open the .html files in a browser).
//       The welcome email is rendered both with and without a portal login.
//
//   node scripts/preview-emails.js --send you@example.com
//       ALSO sends them for real through Resend, but ALL to the address you
//       give (never to a real startup), with "[TEST]" in the subject. Needs
//       RESEND_API_KEY and EMAIL_FROM (environment or backend/.env). Replies
//       go to ADMIN_NOTIFY_EMAIL (contact@retailinnovation.ventures).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const E = require("../lib/email.js");
const { buildIntroductionRequestAck, buildStartupWelcome, adminNotifyEmail, sendEmail } = E;

const sample = {
  founderName: "Asha Rao",
  startupName: "Test Startup Pvt Ltd",
  rivOwner: "Priya Nair",
};

const mails = {
  "startup-welcome": buildStartupWelcome({ ...sample, hasPortalLogin: true }),
  "startup-welcome-no-login": buildStartupWelcome({ ...sample, hasPortalLogin: false }),
  "login-ready-startup": E.buildLoginReady({ name: sample.founderName, email: "asha@example.com", rivOwner: sample.rivOwner, role: "startup" }),
  "login-ready-partner": E.buildLoginReady({ name: "Pat Partner", email: "pat@example.com", rivOwner: sample.rivOwner, role: "partner" }),
  "partner-welcome": E.buildPartnerWelcome({ partnerName: "Pat Partner", rivOwner: sample.rivOwner, hasPortalLogin: true }),
  "new-opportunity": E.buildNewOpportunity({ founderName: sample.founderName, startupName: sample.startupName, retailerName: "Sample Retail Co", context: "Strong overlap with your grocery pilots." }),
  "opportunity-reminder": E.buildOpportunityReminder({ founderName: sample.founderName, startupName: sample.startupName, retailerName: "Sample Retail Co", hasPortalLogin: true }),
  "request-approved": E.buildRequestApproved({ founderName: sample.founderName, startupName: sample.startupName, retailerName: "Sample Retail Co" }),
  "request-rejected": E.buildRequestRejected({ founderName: sample.founderName, startupName: sample.startupName, retailerName: "Sample Retail Co", rivOwner: sample.rivOwner }),
  "partner-go-ahead": E.buildPartnerGoAhead({ partnerName: "Pat Partner", startupName: sample.startupName, retailerName: "Sample Retail Co" }),
  "introduction-made": E.buildIntroductionMade({ founderName: sample.founderName, startupName: sample.startupName, retailerName: "Sample Retail Co", introductionDate: "2026-11-09", channel: "Email" }),
  "invoice-issued": E.buildInvoiceIssued({ founderName: sample.founderName, startupName: sample.startupName, invoiceId: 12, amount: 1500, dueDate: "2026-12-01", retailers: "Sample Retail Co", rivOwner: sample.rivOwner }),
  "payment-received": E.buildPaymentReceived({ founderName: sample.founderName, startupName: sample.startupName, invoiceId: 12, amount: 1500 }),
  "payout-issued": E.buildPayoutIssued({ partnerName: "Pat Partner", amount: 700, retailers: "Sample Retail Co" }),
  "riv-alert": E.buildRivAlert({ event: "Startup commit status: OK to introduce", startupName: sample.startupName, retailerName: "Sample Retail Co", detail: `${sample.startupName} responded "OK to introduce" on the Sample Retail Co opportunity.` }),
  "startup-acknowledgement": buildIntroductionRequestAck({
    founderName: sample.founderName,
    retailerName: "Sample Retail Co",
    requestedAt: new Date().toISOString(),
  }),
};

const outDir = path.join(__dirname, "..", "email-preview");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, mail] of Object.entries(mails)) {
  fs.writeFileSync(path.join(outDir, `${name}.html`), mail.html);
  fs.writeFileSync(path.join(outDir, `${name}.txt`), mail.text);
  console.log(`\n===== ${name} =====\nSubject: ${mail.subject}\n\n${mail.text}\n`);
}
console.log(`Wrote HTML/text previews to ${outDir}`);

(async () => {
  const args = process.argv.slice(2);
  const sendIdx = args.indexOf("--send");
  if (sendIdx === -1) return;
  const to = args[sendIdx + 1];
  if (!to || to.startsWith("--")) throw new Error("Usage: --send <your-test-address>");
  for (const [name, mail] of Object.entries(mails)) {
    const r = await sendEmail({
      to,
      subject: `[TEST] ${mail.subject}`,
      text: mail.text,
      html: mail.html,
      replyTo: adminNotifyEmail(),
      type: `test-${name}`,
    });
    console.log(`${name} -> ${to}:`, r);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
