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
        -- 'Piloting' was the pre-12-Sep-2026 Deal Status value; the 18-Sep-2026
        -- addendum's list (backend/db.js's DEAL_STATUSES) uses 'PoC/Evaluation'
        -- for the equivalent stage. Keep this in sync with that list.
        $4::jsonb, 'PoC/Evaluation')`,
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

  // ---------------------------------------------------------------------
  // "Demo test 18/09" — a SECOND retailer plus one introduction carried
  // all the way through the full 18-Sep-2026 workflow (GTM Partner
  // originates it → RIV approves → partner logs the introduction →
  // startup confirms → partner records proof → deal is progressed to
  // Closed - Won → RIV's Expected GTM Success Fee is computed and locked).
  // This exists purely so a client demo has one row, in every login, that
  // already sits at the END of the lifecycle — Admin's Introductions tab,
  // the partner's Dashboard (with a locked success fee), and the
  // startup's "Retailer Introductions from GTM Partners" tab all show the
  // same fully-worked deal. Every free-text field below is tagged so it's
  // unmistakable in a demo. Uses the same partner/startup logins seeded
  // above — no extra credentials needed.
  // ---------------------------------------------------------------------
  const { rows: demoRetailerRows } = await pool.query(
    `INSERT INTO retailers (name, category, location, network_source, owning_partner_id, contact_name, contact_email, contact_phone, riv_owner, status)
     VALUES ('Croma Retail (Demo test 18/09)', 'Consumer Electronics', 'Pune, India', 'GTM Partner', $1, 'Head of Digital, Croma', 'digital@croma-demo.demo', '+91 20 4000 0000', 'Saravana Mani', 'Active in network')
     RETURNING id`,
    [partnerId]
  );
  const demoRetailerId = demoRetailerRows[0].id;

  const demoDealValue = 3000000; // ₹30L — illustrative
  const demoClosureRate = 25;
  const demoFeeAmountDue = (demoDealValue * demoClosureRate) / 100; // 750,000
  const demoPartnerFeePct = 66.7; // partners.default_payout_split — "2/3rd to GTM partner" rule
  const demoPartnerFeeAmount = (demoFeeAmountDue * demoPartnerFeePct) / 100; // ~500,250

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
        'Demo test 18/09 — Croma is refreshing in-store demand forecasting ahead of festive season; RDEP''s agentic layer is a direct fit for their POS/ERP stack.',
        'Demo test 18/09 — introduced Croma''s Head of Digital to RDEP''s founder over a joint call on 20 Aug 2026.',
        'Proof Recorded',
        true, now() - INTERVAL '29 days', 15, $6,
        'Closed - Won', 'Call', CURRENT_DATE - INTERVAL '27 days',
        'Demo test 18/09 — call recording + intro email thread on file with RIV.',
        $7::jsonb, 'Closed - Won',
        $4, 'demo-test-18-09-po.pdf', CURRENT_DATE - INTERVAL '2 days', $5, $8, $9,
        'Saravana Mani')`,
    [
      partnerId,
      startupId,
      demoRetailerId,
      demoDealValue,
      demoFeeAmountDue,
      demoClosureRate,
      JSON.stringify([
        { date: new Date(Date.now() - 24 * 86400000).toISOString(), author: "Vijetha Shastry", note: "Demo test 18/09 — Croma greenlit a 4-store pilot in Pune & Mumbai." },
        { date: new Date(Date.now() - 10 * 86400000).toISOString(), author: "RDEP Founder", note: "Demo test 18/09 — pilot results strong; Croma issued a PO for full rollout." },
        { date: new Date(Date.now() - 2 * 86400000).toISOString(), author: "Saravana Mani", note: "Demo test 18/09 — deal closed won, PO on file, success fee computed and locked." },
      ]),
      demoPartnerFeePct,
      demoPartnerFeeAmount,
    ]
  );

  console.log("Seed complete.");
  console.log("  Admin login:   admin@rise-gtm.demo / admin123");
  console.log("  Partner login: partner@rise-gtm.demo / partner123");
  console.log("  Startup login: startup@rise-gtm.demo / startup123");
  console.log("  Plus one full-cycle 'Demo test 18/09' introduction (Croma Retail x RDEP), Closed - Won, success fee locked.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});