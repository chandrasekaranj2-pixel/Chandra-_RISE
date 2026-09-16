// RISE Portal — GTM Partner Introduction Workflow & Startup Introduction
// Request Workflow (PRD: "RISE Module", 10 Sep 2026).
//
// This is a standalone application with its own database, own users table,
// and own auth — it does not share infrastructure with the RIOS monorepo
// (rios.retailinnovation.ai). It's a separate app under the same parent
// company (Retail Innovation Ventures / RIV), meant to eventually live at
// rise.retailinnovation.ventures. Because it's isolated in its own repo,
// there's no naming collision to design around the way there was inside
// RIOS (which has an unrelated "Rise.RIV" startup-scouting module) — table
// and role names here are plain: partners, startups, retailers,
// introductions, invoices, payouts, notifications; roles 'admin' /
// 'partner' / 'startup'.
const pg = require("pg");

const { Pool } = pg;

// Same Supabase-vs-local SSL auto-detection as the RIOS backend, so this
// works against a local Postgres in dev and Supabase in production with no
// extra config. Override with PGSSL=true/false if pointing at something else.
function wantsSsl() {
  if (process.env.PGSSL === "true") return true;
  if (process.env.PGSSL === "false") return false;
  const url = process.env.DATABASE_URL || "";
  return url.includes("supabase.co") || url.includes("supabase.com");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: wantsSsl() ? { rejectUnauthorized: false } : false,
});

// Every status the PRD's Section 6.5 lifecycle can be in, in order. Kept as
// one exported list so routes validate transitions against the same source
// of truth instead of duplicating the string list. (PRD uses an en-dash in
// "Closed – Won" / "Closed – Lost"; a plain hyphen is used here instead so
// the value round-trips safely through JSON/SQL/URLs without encoding
// surprises — cosmetic only, same meaning.)
const INTRODUCTION_STATUSES = [
  "Requested",
  "Pending Startup Agreement",
  "Approved",
  "Introduced",
  "In Progress",
  "Closed - Won",
  "Closed - Lost",
  "Stalled",
  "Invoiced",
  "Paid",
  "Payout Complete",
];

// GTM Portal / Startup Portal restructure (RISE Module addendum, 12 Sep
// 2026): the approval chain that gates whether an introduction is even
// live yet — kept as its OWN field (approval_status) rather than folded
// into the legacy INTRODUCTION_STATUSES lifecycle above, because the two
// answer different questions ("is this approved to happen" vs "how is the
// resulting deal going") and the addendum explicitly wants them shown as
// two separate columns (Introduction Request Status vs Deal Status).
const APPROVAL_STATUSES = [
  "Pending RIV Approval",
  "RIV Approved",
  "Rejected",
  "GTM Notified",
  "Startup Confirmed",
  "Introduced",
  "Proof Recorded",
];

// Deal Status dropdown (addendum §2) — repurposes the existing
// engagement_stage column, replacing its old five-value set (In
// discussion/Piloting/Stalled/Won/Lost) with this one.
const DEAL_STATUSES = ["Demo", "Pilot", "Proposal", "Negotiation", "Follow-up", "Closed Won", "Closed Lost"];

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','partner','startup')),
      company TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- GTM Partner (PRD §8.1). user_id is nullable: RIV Ops can enter a
    -- partner (e.g. from Bigin) before RISE Portal login is provisioned.
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      full_name TEXT NOT NULL,
      company TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      linkedin_url TEXT,
      sector_focus TEXT[] NOT NULL DEFAULT '{}',
      region TEXT,
      onboarding_stage TEXT NOT NULL DEFAULT 'New'
        CHECK (onboarding_stage IN ('New','Agreement Sent','Signed','Onboarded')),
      agreement_link TEXT,
      agreement_signed_date DATE,
      -- % of RIV's own revenue share paid out to this partner. Default 2/3
      -- per the rate card; independently overridable per PRD §7 (different
      -- from a startup's revenue_share_override below — one answers "what
      -- the startup pays RIV", the other "what RIV pays the partner").
      default_payout_split NUMERIC NOT NULL DEFAULT 66.7,
      revenue_share_override NUMERIC,
      portal_login_status TEXT NOT NULL DEFAULT 'Not Provisioned'
        CHECK (portal_login_status IN ('Not Provisioned','Provisioned','Suspended')),
      riv_owner TEXT,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- RISE Startup (PRD §8.2) — a post-funded RISE-program startup using
    -- the introduction workflow.
    CREATE TABLE IF NOT EXISTS startups (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      startup_name TEXT NOT NULL,
      founder_name TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      sector TEXT,
      solution_summary TEXT,
      onboarding_stage TEXT NOT NULL DEFAULT 'New'
        CHECK (onboarding_stage IN ('New','Agreement Sent','Signed','Onboarded')),
      agreement_link TEXT,
      agreement_signed_date DATE,
      participation_fee_status TEXT NOT NULL DEFAULT 'Pending'
        CHECK (participation_fee_status IN ('Paid','Pending')),
      participation_fee_due_date DATE,
      equity_pct NUMERIC,
      revenue_share_override NUMERIC,
      portal_login_status TEXT NOT NULL DEFAULT 'Not Provisioned'
        CHECK (portal_login_status IN ('Not Provisioned','Provisioned','Suspended')),
      riv_owner TEXT,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Retailer directory (PRD §8.3) — reference data. Contact fields are
    -- "internal only" per the PRD (never returned to partner/startup
    -- roles — enforced in routes/portal.js's SELECT column list, not just
    -- hidden in the UI).
    CREATE TABLE IF NOT EXISTS retailers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      location TEXT,
      network_source TEXT NOT NULL DEFAULT 'RIV Direct'
        CHECK (network_source IN ('RIV Direct','GTM Partner')),
      owning_partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      riv_owner TEXT,
      status TEXT NOT NULL DEFAULT 'Active in network'
        CHECK (status IN ('Active in network','Prospect')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Introduction (PRD §8.4) — the core transactional object; one row per
    -- request → agreement → introduction → proof → follow-up → sale →
    -- invoice → payout thread. invoice_id/payout_id are plain nullable
    -- integers rather than hard FKs (invoices/payouts reference *this*
    -- table, not the other way round, so a circular FK pair would need a
    -- deferred/ALTER-after-create step for no real benefit here — the app
    -- layer is the only thing that ever writes them).
    CREATE TABLE IF NOT EXISTS introductions (
      id SERIAL PRIMARY KEY,
      initiated_by TEXT NOT NULL CHECK (initiated_by IN ('GTM Partner','Startup','RIV Admin')),
      partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
      startup_id INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
      retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
      network_source TEXT,
      request_date DATE NOT NULL DEFAULT CURRENT_DATE,
      startup_agreed BOOLEAN NOT NULL DEFAULT false,
      startup_agreed_at TIMESTAMPTZ,
      intro_rate NUMERIC NOT NULL DEFAULT 15,
      closure_rate NUMERIC NOT NULL DEFAULT 25,
      status TEXT NOT NULL DEFAULT 'Requested',
      channel TEXT CHECK (channel IN ('Email','WhatsApp','In-person','Event')),
      introduction_date DATE,
      proof_of_introduction TEXT,
      follow_up_log JSONB NOT NULL DEFAULT '[]'::jsonb,
      engagement_stage TEXT CHECK (engagement_stage IN ('In discussion','Piloting','Stalled','Won','Lost')),
      sale_confirmation_date DATE,
      po_document TEXT,
      deal_value NUMERIC,
      fee_amount_due NUMERIC,
      invoice_id INTEGER,
      payout_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- PRD §8.4 "Last updated | Timestamp + user" — updated_at alone only
      -- gave the timestamp half of that; this carries the name of whoever
      -- (partner/startup/admin) took the action that produced the current
      -- state, so the audit trail says who as well as when.
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      startup_id INTEGER NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
      related_introduction_ids INTEGER[] NOT NULL DEFAULT '{}',
      billing_period_start DATE,
      billing_period_end DATE,
      amount NUMERIC NOT NULL,
      payment_terms TEXT,
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Sent','Paid','Overdue')),
      paid_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Payout, RIV -> GTM Partner (PRD §8.7).
    CREATE TABLE IF NOT EXISTS payouts (
      id SERIAL PRIMARY KEY,
      partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
      related_introduction_ids INTEGER[] NOT NULL DEFAULT '{}',
      amount NUMERIC NOT NULL,
      pct_applied NUMERIC,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Paid')),
      payout_date DATE,
      payment_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Notification log (PRD §8.8). v1 is in-app only — email/WhatsApp
    -- channels are recorded here for future wiring but nothing actually
    -- sends yet (open question, PRD §12).
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      related_introduction_id INTEGER REFERENCES introductions(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_ack BOOLEAN NOT NULL DEFAULT false,
      channel TEXT NOT NULL DEFAULT 'In-app',
      message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_intros_partner ON introductions(partner_id);
    CREATE INDEX IF NOT EXISTS idx_intros_startup ON introductions(startup_id);
    CREATE INDEX IF NOT EXISTS idx_intros_retailer ON introductions(retailer_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id);
  `);

  // Idempotent add-column for the updated_by field above — safe to run
  // every boot, and picks up the column on any database created before
  // this field existed (the CREATE TABLE IF NOT EXISTS above only applies
  // to brand-new databases).
  await pool.query(`ALTER TABLE introductions ADD COLUMN IF NOT EXISTS updated_by TEXT;`);

  // --- GTM Portal / Startup Portal restructure (12 Sep 2026 addendum) ---
  // All ADD COLUMN IF NOT EXISTS below are safe to run every boot the same
  // way updated_by is above; they only take effect on the first boot after
  // this code ships and are no-ops afterward.
  await pool.query(`
    ALTER TABLE retailers ADD COLUMN IF NOT EXISTS website TEXT;
    ALTER TABLE retailers ADD COLUMN IF NOT EXISTS brand TEXT;
    ALTER TABLE retailers ADD COLUMN IF NOT EXISTS hq_country TEXT;
    ALTER TABLE retailers ADD COLUMN IF NOT EXISTS contact_designation TEXT;
    ALTER TABLE retailers ADD COLUMN IF NOT EXISTS submitted_by_partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL;
    -- Duplicate-detection + reject-with-comment (12 Sep 2026 addendum #2).
    -- duplicate_of_retailer_id is informational only (surfaced to admin so
    -- they know which existing row to compare against) — it does not
    -- block the submission, RIV still makes the call either way.
    ALTER TABLE retailers ADD COLUMN IF NOT EXISTS duplicate_of_retailer_id INTEGER REFERENCES retailers(id) ON DELETE SET NULL;
    ALTER TABLE retailers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

    -- Startup profile fields for the new Startup Detail View (addendum §4).
    -- Company deck upload is explicitly Phase 2 (per the source notes) and
    -- deliberately not modeled here yet.
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS problem_description TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS solution_description TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS top_benefits TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS tech_stack TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS sub_vertical TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS competition TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS competitive_advantage TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS paying_customer_count TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS notable_customers TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS key_milestones TEXT;

    -- New Introduction Request Status chain (separate from the legacy
    -- "status" lifecycle above — see APPROVAL_STATUSES comment).
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'Pending RIV Approval';
    -- Opportunity Value (addendum §2) — distinct from deal_value, which is
    -- the final confirmed-sale figure logged with a PO at Closed-Won.
    -- Opportunity Value is an in-flight, startup-editable estimate.
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS opportunity_value NUMERIC;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS consent_accepted BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;
    -- Request Intro popup fields (addendum §2), matching the existing
    -- Google Sheet/tracker columns exactly.
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS why_interested TEXT;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS problem_solved TEXT;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS relevant_offering TEXT;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS buyer_persona TEXT;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS previously_engaged BOOLEAN;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS prior_engagement_details TEXT;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS supporting_material_url TEXT;
    -- GTM Partner's "Add Retailer" submission fields (Bigin form parity) —
    -- context for why this retailer/startup pairing is relevant and how
    -- the partner has already engaged the enterprise contact.
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS gtm_context_note TEXT;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS how_introduced TEXT;
  `);

  // approval_status / engagement_stage (repurposed as Deal Status) both
  // need their CHECK constraints (re)applied on every boot — dropped and
  // recreated unconditionally rather than ADD COLUMN's inline CHECK, since
  // engagement_stage already existed pre-addendum with a different value
  // set and Postgres has no "ADD COLUMN CHECK IF NOT EXISTS" equivalent
  // for altering an existing constraint.
  //
  // NOT VALID is required here: without it, ADD CONSTRAINT validates every
  // EXISTING row against the new check, and any pre-addendum row still
  // holding an old engagement_stage value (e.g. seeded demo data with "In
  // discussion"/"Piloting"/"Won"/"Lost" — the old five-value set, not the
  // new Deal Status list) fails validation and crashes the boot outright
  // (this is exactly what happened in production — ATRewriteTable erroring
  // on introductions_engagement_stage_check). NOT VALID skips validating
  // old rows retroactively while still enforcing the constraint on every
  // new insert/update going forward, which is all we actually need.
  await pool.query(`
    ALTER TABLE introductions DROP CONSTRAINT IF EXISTS introductions_approval_status_check;
    ALTER TABLE introductions ADD CONSTRAINT introductions_approval_status_check
      CHECK (approval_status IN (${APPROVAL_STATUSES.map((s) => `'${s}'`).join(",")})) NOT VALID;

    ALTER TABLE introductions DROP CONSTRAINT IF EXISTS introductions_engagement_stage_check;
    ALTER TABLE introductions ADD CONSTRAINT introductions_engagement_stage_check
      CHECK (engagement_stage IN (${DEAL_STATUSES.map((s) => `'${s}'`).join(",")})) NOT VALID;
  `);

  // Retailer status: Prospect (submitted, unreviewed — neutral/grey in the
  // UI) / Duplicate (name matched an existing retailer at submission time
  // — yellow) / Active in network (RIV approved — green) / Rejected (RIV
  // declined, with a reason — red). NOT VALID for the same reason as
  // above: existing rows already hold 'Prospect'/'Active in network',
  // which are still valid, but NOT VALID keeps this safe against any
  // future superset changes the same way.
  await pool.query(`
    ALTER TABLE retailers DROP CONSTRAINT IF EXISTS retailers_status_check;
    ALTER TABLE retailers ADD CONSTRAINT retailers_status_check
      CHECK (status IN ('Active in network','Prospect','Duplicate','Rejected')) NOT VALID;
  `);
}

module.exports = { pool, INTRODUCTION_STATUSES, APPROVAL_STATUSES, DEAL_STATUSES, initSchema };