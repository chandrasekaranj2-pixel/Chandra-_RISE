require("dotenv/config");
const bcrypt = require("bcryptjs");
const { pool, initSchema } = require("./db.js");

// Demo data — one admin, one GTM partner, one RISE startup, three retailers
// (two in the partner's network, one RIV-direct), and two introductions at
// different points in the PRD §6.5 lifecycle, so the dashboards have
// something real to show on first login. Mirrors the worked example in the
// PRD (Vijetha Shastry / RDEP / Shoppers Stop).
async function seed() {
  await initSchema();

  const adminHash = bcrypt.hashSync("admin123", 10);
  const partnerHash = bcrypt.hashSync("partner123", 10);
  const startupHash = bcrypt.hashSync("startup123", 10);

  const { rows: adminRows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, company) VALUES ('admin@rise-gtm.demo', $1, 'Saravana Mani', 'admin', 'Retail Innovation Ventures')
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [adminHash]
  );

  const { rows: existingPartner } = await pool.query("SELECT id FROM partners LIMIT 1");
  if (existingPartner.length) {
    console.log("Seed already applied — skipping demo data.");
    await pool.end();
    return;
  }

  const { rows: partnerUserRows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, company) VALUES ('partner@rise-gtm.demo', $1, 'Vijetha Shastry', 'partner', 'Independent GTM Partner')
     RETURNING id`,
    [partnerHash]
  );
  const { rows: startupUserRows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, company) VALUES ('startup@rise-gtm.demo', $1, 'RDEP Founder', 'startup', 'RDEP')
     RETURNING id`,
    [startupHash]
  );

  const { rows: partnerRows } = await pool.query(
    `INSERT INTO partners (user_id, full_name, company, email, phone, sector_focus, region, onboarding_stage, agreement_signed_date, portal_login_status, riv_owner, status)
     VALUES ($1, 'Vijetha Shastry', 'Independent GTM Partner', 'partner@rise-gtm.demo', '+91 98765 43210', ARRAY['Apparel','F&B'], 'India', 'Onboarded', CURRENT_DATE - INTERVAL '90 days', 'Provisioned', 'Saravana Mani', 'Active')
     RETURNING id`,
    [partnerUserRows[0].id]
  );
  const partnerId = partnerRows[0].id;

  const { rows: startupRows } = await pool.query(
    `INSERT INTO startups (user_id, startup_name, founder_name, email, phone, sector, solution_summary, onboarding_stage, agreement_signed_date, participation_fee_status, equity_pct, portal_login_status, riv_owner, status)
     VALUES ($1, 'RDEP', 'RDEP Founder', 'startup@rise-gtm.demo', '+91 90000 11111', 'Retail Data & AI', 'Agentic demand-forecasting layer for omnichannel fashion retailers — plugs into existing POS/ERP with no rip-and-replace.', 'Onboarded', CURRENT_DATE - INTERVAL '75 days', 'Paid', 2.5, 'Provisioned', 'Saravana Mani', 'Active')
     RETURNING id`,
    [startupUserRows[0].id]
  );
  const startupId = startupRows[0].id;

  const { rows: retailerRows } = await pool.query(
    `INSERT INTO retailers (name, category, location, network_source, owning_partner_id, contact_name, contact_email, contact_phone, riv_owner, status)
     VALUES
       ('Shoppers Stop', 'Fashion & Lifestyle', 'Mumbai, India', 'GTM Partner', $1, 'Head of Innovation', 'innovation@shoppersstop.demo', '+91 22 4000 0000', 'Saravana Mani', 'Active in network'),
       ('Lifestyle Stores', 'Fashion & Lifestyle', 'Bengaluru, India', 'GTM Partner', $1, 'VP Technology', 'tech@lifestylestores.demo', '+91 80 4000 0000', 'Saravana Mani', 'Active in network'),
       ('Reliance Retail', 'Omnichannel Retail', 'Mumbai, India', 'RIV Direct', NULL, 'Director, Digital Innovation', 'digital@reliance.demo', '+91 22 5000 0000', 'Saravana Mani', 'Active in network')
     RETURNING id, name`,
    [partnerId]
  );
  const shoppersStopId = retailerRows.find((r) => r.name === "Shoppers Stop").id;

  await pool.query(
    `INSERT INTO introductions
       (initiated_by, partner_id, startup_id, retailer_id, network_source, request_date, startup_agreed, startup_agreed_at, intro_rate, closure_rate, status, channel, introduction_date, proof_of_introduction, follow_up_log, engagement_stage)
     VALUES
       ('GTM Partner', $1, $2, $3, 'GTM Partner', CURRENT_DATE - INTERVAL '21 days', true, now() - INTERVAL '20 days', 15, 25, 'In Progress', 'Email', CURRENT_DATE - INTERVAL '18 days',
        'Forwarded intro email thread — Vijetha <> Shoppers Stop Head of Innovation, 18 days ago.',
        $4::jsonb, 'Piloting')`,
    [
      partnerId,
      startupId,
      shoppersStopId,
      JSON.stringify([
        { date: new Date(Date.now() - 15 * 86400000).toISOString(), author: "RDEP Founder", note: "First call done — Shoppers Stop keen to pilot on 3 stores in Mumbai." },
        { date: new Date(Date.now() - 6 * 86400000).toISOString(), author: "RDEP Founder", note: "Pilot scoping doc shared; POS data access being arranged on their side." },
      ]),
    ]
  );

  console.log("Seed complete.");
  console.log("  Admin login:   admin@rise-gtm.demo / admin123");
  console.log("  Partner login: partner@rise-gtm.demo / partner123");
  console.log("  Startup login: startup@rise-gtm.demo / startup123");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});