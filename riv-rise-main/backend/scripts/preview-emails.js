// Renders the emails RISE sends to startups, using a sample "Test Startup"
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
const { buildIntroductionRequestAck, buildStartupWelcome, adminNotifyEmail, sendEmail } = require("../lib/email.js");

const sample = {
  founderName: "Asha Rao",
  startupName: "Test Startup Pvt Ltd",
  rivOwner: "Priya Nair",
};

const mails = {
  "startup-welcome": buildStartupWelcome({ ...sample, hasPortalLogin: true }),
  "startup-welcome-no-login": buildStartupWelcome({ ...sample, hasPortalLogin: false }),
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
