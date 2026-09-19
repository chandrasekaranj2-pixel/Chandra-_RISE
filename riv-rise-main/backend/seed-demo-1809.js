require("dotenv/config");
const bcrypt = require("bcryptjs");
const { pool, initSchema } = require("./db.js");

// Additive demo seed (built 18 Sep 2026) — does NOT touch or delete any
// existing data. Creates/updates its OWN dedicated partner, startup, and
// retailer, plus one introduction carried all the way through the full
// GTM-partner-originated workflow (GTM Partner originates it → RIV
// approves → partner logs the introduction → startup confirms → partner
// records proof → deal progressed to Closed - Won → Expected GTM Success
// Fee computed and locked).
//
// Every display name is intentionally generic ("Retail Startup" / "GTM
// Partner" / "Croma Retail") — nothing reading "demo"/"test"/"18/09"
// appears anywhere in the app's UI, so this looks like a real account in
// front of a client. All lookups below use STABLE keys (email/user_id),
// not display names, so re-running this script after a display name
// change updates the existing rows in place rather than creating
// duplicates — safe to run as many times as you like.
//
// Run with: node seed-demo-1809.js
async function seedDemo() {
  await initSchema();

  const partnerEmail = "demo-partner-1809@rise-gtm.demo";
  const startupEmail = "demo-startup-1809@rise-gtm.demo";
  const partnerPassword = "demopartner123";
  const startupPassword = "demostartup123";
  const retailerContactEmail = "digital@croma-demo.demo"; // stable lookup key for the retailer row

  async function upsertUser(email, password, name, role, company) {
    const { rows: existing } = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.length) {
      await pool.query("UPDATE users SET name = $2, company = $3 WHERE id = $1", [existing[0].id, name, company]);
      return existing[0].id;
    }
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, company) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email, hash, name, role, company]
    );
    return rows[0].id;
  }

  const partnerUserId = await upsertUser(partnerEmail, partnerPassword, "GTM Partner", "partner", "GTM Partner");
  const startupUserId = await upsertUser(startupEmail, startupPassword, "Retail Startup", "startup", "Retail Startup");

  let { rows: partnerRows } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [partnerUserId]);
  let partnerId;
  if (partnerRows.length) {
    partnerId = partnerRows[0].id;
    await pool.query("UPDATE partners SET full_name = 'GTM Partner', company = 'GTM Partner' WHERE id = $1", [partnerId]);
  } else {
    const { rows } = await pool.query(
      `INSERT INTO partners (user_id, full_name, company, email, phone, sector_focus, region, onboarding_stage, agreement_signed_date, portal_login_status, riv_owner, status, default_payout_split)
       VALUES ($1, 'GTM Partner', 'GTM Partner', $2, '+91 90000 18091', ARRAY['Retail Tech'], 'India', 'Onboarded', CURRENT_DATE - INTERVAL '60 days', 'Provisioned', 'Saravana Mani', 'Active', 66.7)
       RETURNING id`,
      [partnerUserId, partnerEmail]
    );
    partnerId = rows[0].id;
  }

  let { rows: startupRows } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [startupUserId]);
  let startupId;
  if (startupRows.length) {
    startupId = startupRows[0].id;
    await pool.query("UPDATE startups SET startup_name = 'Retail Startup', founder_name = 'Retail Startup' WHERE id = $1", [startupId]);
  } else {
    const { rows } = await pool.query(
      `INSERT INTO startups (user_id, startup_name, founder_name, email, phone, sector, solution_summary, onboarding_stage, agreement_signed_date, participation_fee_status, equity_pct, portal_login_status, riv_owner, status)
       VALUES ($1, 'Retail Startup', 'Retail Startup', $2, '+91 90000 18092', 'Retail Data & AI', 'Agentic demand-forecasting layer for omnichannel retailers.', 'Onboarded', CURRENT_DATE - INTERVAL '50 days', 'Paid', 2.5, 'Provisioned', 'Saravana Mani', 'Active')
       RETURNING id`,
      [startupUserId, startupEmail]
    );
    startupId = rows[0].id;
  }

  let { rows: retailerRows } = await pool.query("SELECT id FROM retailers WHERE contact_email = $1", [retailerContactEmail]);
  let retailerId;
  if (retailerRows.length) {
    retailerId = retailerRows[0].id;
    await pool.query("UPDATE retailers SET name = 'Croma Retail', owning_partner_id = $2 WHERE id = $1", [retailerId, partnerId]);
  } else {
    const { rows } = await pool.query(
      `INSERT INTO retailers (name, category, location, network_source, owning_partner_id, contact_name, contact_email, contact_phone, riv_owner, status)
       VALUES ('Croma Retail', 'Consumer Electronics', 'Pune, India', 'GTM Partner', $1, 'Head of Digital, Croma', $2, '+91 20 4000 0000', 'Saravana Mani', 'Active in network')
       RETURNING id`,
      [partnerId, retailerContactEmail]
    );
    retailerId = rows[0].id;
  }

  const demoDealValue = 3000000; // ₹30L — illustrative
  const demoClosureRate = 25;
  const demoFeeAmountDue = (demoDealValue * demoClosureRate) / 100; // 750,000
  const demoPartnerFeePct = 66.7;
  const demoPartnerFeeAmount = (demoFeeAmountDue * demoPartnerFeePct) / 100; // ~500,250
  const gtmContextNote = "Croma is refreshing in-store demand forecasting ahead of festive season; a direct fit for their POS/ERP stack.";
  const howIntroduced = "Introduced Croma's Head of Digital to the founder over a joint call on 20 Aug 2026.";
  const proofOfIntroduction = "Call recording + intro email thread on file with RIV.";
  const poDocument = "croma-po.pdf";
  const followUpLog = JSON.stringify([
    { date: new Date(Date.now() - 24 * 86400000).toISOString(), author: "GTM Partner", note: "Croma greenlit a 4-store pilot in Pune & Mumbai." },
    { date: new Date(Date.now() - 10 * 86400000).toISOString(), author: "Retail Startup", note: "Pilot results strong; Croma issued a PO for full rollout." },
    { date: new Date(Date.now() - 2 * 86400000).toISOString(), author: "Saravana Mani", note: "Deal closed won, PO on file, success fee computed and locked." },
  ]);

  const { rows: existingIntro } = await pool.query(
    "SELECT id FROM introductions WHERE partner_id = $1 AND startup_id = $2 AND retailer_id = $3",
    [partnerId, startupId, retailerId]
  );

  if (existingIntro.length) {
    // Already seeded from an earlier run — just refresh the free-text
    // fields in place (e.g. if they still carry an older "Demo test
    // 18/09" tag) rather than inserting a duplicate introduction.
    await pool.query(
      `UPDATE introductions
       SET gtm_context_note = $2, how_introduced = $3, proof_of_introduction = $4,
           po_document = $5, follow_up_log = $6::jsonb
       WHERE id = $1`,
      [existingIntro[0].id, gtmContextNote, howIntroduced, proofOfIntroduction, poDocument, followUpLog]
    );
    console.log("Demo data refreshed (already existed) — display names cleaned up, existing other data untouched.");
    console.log("  GTM partner login:  " + partnerEmail + " / " + partnerPassword);
    console.log("  Startup login:      " + startupEmail + " / " + startupPassword);
    await pool.end();
    return;
  }

  await pool.query(
    `INSERT INTO introductions
       (initiated_by, partner_id, startup_id, retailer_id, network_source, request_date,
        gtm_context_note, how_introduced, approval_status,
        startup_agreed, startup_agreed_at, intro_rate, closure_rate,
        status, channel, introduction_date, proof_of_introduction, follow_up_log, engagement_stage,
        deal_value, po_document, sale_confirmation_date, fee_amount_due, partner_fee_pct, partner_fee_amount,
        updated_by)
     VALUES
       ('GTM Partner', $1, $2, $3, 'GTM Partner', CURRENT_DATE - INTERVAL '30 days',
        $10, $11, 'Proof Recorded',
        true, now() - INTERVAL '29 days', 15, $6,
        'Closed - Won', 'In-person', CURRENT_DATE - INTERVAL '27 days',
        $12, $7::jsonb, 'Closed - Won',
        $4, $13, CURRENT_DATE - INTERVAL '2 days', $5, $8, $9,
        'Saravana Mani')`,
    [
      partnerId,
      startupId,
      retailerId,
      demoDealValue,
      demoFeeAmountDue,
      demoClosureRate,
      followUpLog,
      demoPartnerFeePct,
      demoPartnerFeeAmount,
      gtmContextNote,
      howIntroduced,
      proofOfIntroduction,
      poDocument,
    ]
  );

  console.log("Demo data added — existing data untouched.");
  console.log("  GTM partner login:  " + partnerEmail + " / " + partnerPassword);
  console.log("  Startup login:      " + startupEmail + " / " + startupPassword);
  console.log("  (Use your existing admin login to view it from the Admin side.)");
  await pool.end();
}

seedDemo().catch((err) => {
  console.error("Demo seed failed:", err);
  process.exit(1);
});
