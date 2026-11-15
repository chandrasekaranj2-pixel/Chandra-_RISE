// Database-aware wrappers around the notification emails in lib/email.js.
//
// Each function looks up what the email needs, builds it, and sends it
// through safely() so a mail problem (or a slow provider) can never fail or
// noticeably delay the request that triggered it. Callers just `await` the
// one function at the point in the route where the event has been saved.
//
// Who gets what is the approved plan in "RISE Portal – Notification Plan &
// Email Templates"; numbers in comments below match that document.
const { pool } = require("../db.js");
const email = require("./email.js");

const { sendEmail, adminNotifyEmail, safely } = email;

// One introduction with the people and retailer behind it.
async function loadIntro(introId) {
  const { rows } = await pool.query(
    `SELECT i.*, r.name AS retailer_name,
            s.startup_name, s.founder_name, s.email AS startup_email, s.riv_owner AS startup_riv_owner, s.user_id AS startup_user_id,
            p.full_name AS partner_name, p.email AS partner_email
       FROM introductions i
       JOIN startups s ON s.id = i.startup_id
       JOIN retailers r ON r.id = i.retailer_id
       LEFT JOIN partners p ON p.id = i.partner_id
      WHERE i.id = $1`,
    [introId]
  );
  return rows[0] || null;
}

// Retailer names behind a list of introduction ids ("Acme, Globex").
async function retailerNames(introIds) {
  if (!introIds?.length) return "";
  const { rows } = await pool.query(
    `SELECT DISTINCT r.name FROM introductions i JOIN retailers r ON r.id = i.retailer_id WHERE i.id = ANY($1::int[]) ORDER BY r.name`,
    [introIds]
  );
  return rows.map((r) => r.name).join(", ");
}

const toStartup = (intro, mail, type) =>
  sendEmail({ to: intro.startup_email, ...mail, replyTo: adminNotifyEmail(), type });
const toPartner = (intro, mail, type) =>
  sendEmail({ to: intro.partner_email, ...mail, replyTo: adminNotifyEmail(), type });

// 3. Portal login ready — startup or GTM partner, first provisioning only.
function loginReady({ role, row }) {
  return safely("Login-ready", () =>
    sendEmail({
      to: row.email,
      ...email.buildLoginReady({
        name: role === "partner" ? row.full_name : row.founder_name || row.startup_name,
        email: row.email,
        rivOwner: row.riv_owner,
        role,
      }),
      replyTo: adminNotifyEmail(),
      type: "login-ready",
    })
  );
}

// 4. New opportunity from RIV -> startup.
function newOpportunity(introId) {
  return safely("New-opportunity", async () => {
    const intro = await loadIntro(introId);
    if (!intro?.startup_email) return;
    await toStartup(
      intro,
      email.buildNewOpportunity({
        founderName: intro.founder_name,
        startupName: intro.startup_name,
        retailerName: intro.retailer_name,
        context: intro.gtm_context_note,
      }),
      "new-opportunity"
    );
  });
}

// 5. Request approved -> startup (only the cases where the startup is the
// one RIV is answering: RIV-direct, or a request the startup made itself).
function requestApproved(introId) {
  return safely("Request-approved", async () => {
    const intro = await loadIntro(introId);
    if (!intro?.startup_email) return;
    await toStartup(
      intro,
      email.buildRequestApproved({ founderName: intro.founder_name, startupName: intro.startup_name, retailerName: intro.retailer_name }),
      "request-approved"
    );
  });
}

// 6. Request not taken forward -> startup (only requests the startup made).
function requestRejected(introId) {
  return safely("Request-rejected", async () => {
    const intro = await loadIntro(introId);
    if (!intro?.startup_email || intro.initiated_by !== "Startup") return;
    await toStartup(
      intro,
      email.buildRequestRejected({
        founderName: intro.founder_name,
        startupName: intro.startup_name,
        retailerName: intro.retailer_name,
        rivOwner: intro.startup_riv_owner,
      }),
      "request-rejected"
    );
  });
}

// 7. Startup confirmed -> GTM partner can make the introduction.
function partnerGoAhead(introId) {
  return safely("Partner-go-ahead", async () => {
    const intro = await loadIntro(introId);
    if (!intro?.partner_email) return;
    await toPartner(
      intro,
      email.buildPartnerGoAhead({ partnerName: intro.partner_name, startupName: intro.startup_name, retailerName: intro.retailer_name }),
      "partner-go-ahead"
    );
  });
}

// 8. Introduction made -> startup.
function introductionMade(introId) {
  return safely("Introduction-made", async () => {
    const intro = await loadIntro(introId);
    if (!intro?.startup_email) return;
    await toStartup(
      intro,
      email.buildIntroductionMade({
        founderName: intro.founder_name,
        startupName: intro.startup_name,
        retailerName: intro.retailer_name,
        introductionDate: intro.introduction_date,
        channel: intro.channel,
      }),
      "introduction-made"
    );
  });
}

async function loadStartup(startupId) {
  const { rows } = await pool.query("SELECT * FROM startups WHERE id = $1", [startupId]);
  return rows[0] || null;
}

// 9. Invoice issued -> startup.
function invoiceIssued(invoice) {
  return safely("Invoice-issued", async () => {
    const startup = await loadStartup(invoice.startup_id);
    if (!startup?.email) return;
    await sendEmail({
      to: startup.email,
      ...email.buildInvoiceIssued({
        founderName: startup.founder_name,
        startupName: startup.startup_name,
        invoiceId: invoice.id,
        amount: invoice.amount,
        dueDate: invoice.due_date,
        retailers: await retailerNames(invoice.related_introduction_ids),
        rivOwner: startup.riv_owner,
      }),
      replyTo: adminNotifyEmail(),
      type: "invoice-issued",
    });
  });
}

// 10. Payment received -> startup.
function paymentReceived(invoice) {
  return safely("Payment-received", async () => {
    const startup = await loadStartup(invoice.startup_id);
    if (!startup?.email) return;
    await sendEmail({
      to: startup.email,
      ...email.buildPaymentReceived({
        founderName: startup.founder_name,
        startupName: startup.startup_name,
        invoiceId: invoice.id,
        amount: invoice.amount,
      }),
      replyTo: adminNotifyEmail(),
      type: "payment-received",
    });
  });
}

// 11. Payout issued -> GTM partner (when the payout is marked Paid).
function payoutIssued(payout) {
  return safely("Payout-issued", async () => {
    const { rows } = await pool.query("SELECT full_name, email FROM partners WHERE id = $1", [payout.partner_id]);
    const partner = rows[0];
    if (!partner?.email) return;
    await sendEmail({
      to: partner.email,
      ...email.buildPayoutIssued({
        partnerName: partner.full_name,
        amount: payout.amount,
        retailers: await retailerNames(payout.related_introduction_ids),
      }),
      replyTo: adminNotifyEmail(),
      type: "payout-issued",
    });
  });
}

// 13. RIV team alert -> the shared inbox. Off unless RIV_ALERT_EMAILS=true.
function rivAlert(introId, event, detailFor) {
  if (process.env.RIV_ALERT_EMAILS !== "true") return Promise.resolve();
  return safely("RIV-alert", async () => {
    const intro = await loadIntro(introId);
    if (!intro) return;
    await sendEmail({
      to: adminNotifyEmail(),
      ...email.buildRivAlert({
        event,
        startupName: intro.startup_name,
        retailerName: intro.retailer_name,
        detail: detailFor(intro),
      }),
      type: "riv-alert",
    });
  });
}

module.exports = {
  loadIntro,
  loginReady,
  newOpportunity,
  requestApproved,
  requestRejected,
  partnerGoAhead,
  introductionMade,
  invoiceIssued,
  paymentReceived,
  payoutIssued,
  rivAlert,
};
