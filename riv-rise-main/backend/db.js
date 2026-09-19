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

// 18 Sep 2026 feedback restores the GTM partner's ability to originate an
// introduction (POST /api/introductions is partner+startup again in
// routes/portal.js — the 12 Sep addendum's removal of that branch is
// reversed). initiated_by already had 'GTM Partner' as a valid value from
// the original PRD, so no schema change was needed there, only the route.
// The approval chain above is unchanged and applies the same way
// regardless of who initiated: RIV always approves first either way.

// Deal Status dropdown (addendum §2) — repurposes the existing
// engagement_stage column, replacing its old five-value set (In
// discussion/Piloting/Stalled/Won/Lost) with this one.
//
// 18 Sep 2026 addendum (Startup Retailer Introductions — two-tab split):
// replaced with the copy-ready list from that PRD (was: Demo/Pilot/
// Proposal/Negotiation/Follow-up/Closed Won/Closed Lost). Only the
// literal string values change here — everything that reads/writes
// engagement_stage (this list, the CHECK constraint below, and the
// frontend's DEAL_STATUS_OPTIONS) stays wired the same way.
const DEAL_STATUSES = [
  "Not Started", "In Discussion", "PoC/Evaluation", "Proposal",
  "Negotiation", "Closed - Won", "Closed - Lost", "Stalled",
];

// Startup Commit Status (18 Sep 2026 addendum) — Tab 2 ("Retailer
// Introductions Initiated by RIV") only. The startup's first response to
// an opportunity RIV has surfaced, before any introduction is made.
const COMMIT_STATUSES = ["OK to introduce", "Already in touch", "Not a right customer"];

// How the introduction itself was made. CREATE TABLE below only fires on a
// brand-new database — on any DB where the introductions table already
// existed (every real deployment, including this one as of 18 Sep 2026),
// whatever CHECK constraint was live when that table was first created is
// what still applies, no matter what this list says, until it's explicitly
// re-applied via the migration block further down. Same class of bug as
// the approval_status/engagement_stage/startup_commit_status constraints
// (see the big comment near their migration block) — caught 18 Sep 2026
// when the demo seed's 'Call' value (not in ANY version of this list)
// violated introductions_channel_check against a live table whose
// constraint had never been migrated forward.
const CHANNELS = ["Email", "WhatsApp", "In-person", "Event"];

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
      legal_entity TEXT,
      website TEXT,
      city TEXT,
      hq_country TEXT,
      year_incorporated TEXT,
      founding_team_details TEXT,
      past_fund_raised TEXT,
      currently_raising_capital TEXT,
      fundraising_support_interest TEXT,
      additional_notes TEXT,
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

    -- RISE GTM Application Form field parity (18 Sep 2026 feedback — "RIV
    -- Portfolio Startups" detail view should mirror the Bigin application
    -- form in full). These sit alongside the addendum §4 fields above.
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS legal_entity TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS website TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS hq_country TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS year_incorporated TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS founding_team_details TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS past_fund_raised TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS currently_raising_capital TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS fundraising_support_interest TEXT;
    ALTER TABLE startups ADD COLUMN IF NOT EXISTS additional_notes TEXT;

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
    -- Real file attachments (18 Sep 2026 addendum), replacing the old
    -- free-text URL field above for new submissions. supporting_material_url
    -- is left in place (not backfilled, not dropped) so any pre-addendum
    -- rows that used it still read back fine. Each element of this array is
    -- {name, path, size, mime_type} — "path" is the Supabase Storage object
    -- key, not a public URL, since the bucket is private (RIV's supporting
    -- material is business-sensitive pitch content); a signed URL is
    -- generated on demand by the download route instead of being stored.
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS supporting_material JSONB NOT NULL DEFAULT '[]'::jsonb;
    -- GTM Partner's "Add Retailer" submission fields (Bigin form parity) —
    -- context for why this retailer/startup pairing is relevant and how
    -- the partner has already engaged the enterprise contact.
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS gtm_context_note TEXT;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS how_introduced TEXT;

    -- Startup Commit Status (18 Sep 2026 addendum, Tab 2 only) — the
    -- startup's first response to a RIV-initiated opportunity. Nullable:
    -- unset until the startup picks one, and never used on Tab 1
    -- (startup-requested) rows.
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS startup_commit_status TEXT;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS startup_commit_status_at TIMESTAMPTZ;

    -- GTM Partner login restore + Expected GTM Success Fee (18 Sep 2026
    -- feedback). partner_fee_pct/partner_fee_amount are locked in at
    -- Closed-Won time (not recomputed live off the partner's current
    -- default_payout_split) so a later change to that partner's rate never
    -- retroactively changes a figure already shown/paid on a closed deal —
    -- see computePartnerFee() in routes/portal.js and routes/admin.js.
    -- Only ever set for initiated_by = 'GTM Partner' rows (per 18 Sep 2026
    -- decision: the partner's cut only applies when THEY originated the
    -- introduction via "Introduce Startup to Retailers", not merely
    -- because the retailer sits in their network).
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS partner_fee_pct NUMERIC;
    ALTER TABLE introductions ADD COLUMN IF NOT EXISTS partner_fee_amount NUMERIC;
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
  // on introductions_engagement_stage_check).
  //
  // NOT VALID only skips checking existing rows AT THE MOMENT the
  // constraint is (re)created — it does NOT exempt them going forward.
  // Postgres re-validates a row's *entire* CHECK constraint set on every
  // subsequent write to that row, even an UPDATE that never touches the
  // constrained column. So an old row still holding a stale
  // engagement_stage value (e.g. 'Piloting') would pass right up until
  // the next Approve/Reject/follow-up/etc. touches it — then throws
  // "violates check constraint introductions_engagement_stage_check" out
  // of nowhere (this is exactly what happened in production, 18 Sep 2026,
  // on the seeded demo row). Old rows have to be normalized to the current
  // value set *before* the constraint is applied, every boot — not just
  // exempted from the one-time validation.
  await pool.query(`
    UPDATE introductions SET engagement_stage = CASE engagement_stage
      -- Original five-value set (pre-12-Sep-2026 addendum).
      WHEN 'In discussion' THEN 'In Discussion'
      WHEN 'Piloting' THEN 'PoC/Evaluation'
      WHEN 'Won' THEN 'Closed - Won'
      WHEN 'Lost' THEN 'Closed - Lost'
      -- 12-Sep-2026 addendum's set (superseded by this 18-Sep set).
      WHEN 'Demo' THEN 'Not Started'
      WHEN 'Pilot' THEN 'PoC/Evaluation'
      WHEN 'Follow-up' THEN 'Negotiation'
      WHEN 'Closed Won' THEN 'Closed - Won'
      WHEN 'Closed Lost' THEN 'Closed - Lost'
      ELSE engagement_stage
    END
    WHERE engagement_stage IS NOT NULL
      AND engagement_stage NOT IN (${DEAL_STATUSES.map((s) => `'${s}'`).join(",")});
  `);
  await pool.query(`
    ALTER TABLE introductions DROP CONSTRAINT IF EXISTS introductions_approval_status_check;
    ALTER TABLE introductions ADD CONSTRAINT introductions_approval_status_check
      CHECK (approval_status IN (${APPROVAL_STATUSES.map((s) => `'${s}'`).join(",")})) NOT VALID;

    ALTER TABLE introductions DROP CONSTRAINT IF EXISTS introductions_engagement_stage_check;
    ALTER TABLE introductions ADD CONSTRAINT introductions_engagement_stage_check
      CHECK (engagement_stage IN (${DEAL_STATUSES.map((s) => `'${s}'`).join(",")})) NOT VALID;

    ALTER TABLE introductions DROP CONSTRAINT IF EXISTS introductions_startup_commit_status_check;
    ALTER TABLE introductions ADD CONSTRAINT introductions_startup_commit_status_check
      CHECK (startup_commit_status IN (${COMMIT_STATUSES.map((s) => `'${s}'`).join(",")})) NOT VALID;
  `);

  // channel — see the CHANNELS comment above: this table's channel CHECK
  // constraint was never migrated forward before 18 Sep 2026, so a live
  // deployment could be stuck on whatever set was live when the table was
  // first created. Normalize any out-of-list existing value to NULL
  // (channel is optional) rather than guess at a mapping, then re-apply
  // the current CHANNELS list, same NOT VALID pattern as above.
  await pool.query(`
    UPDATE introductions SET channel = NULL
    WHERE channel IS NOT NULL AND channel NOT IN (${CHANNELS.map((c) => `'${c}'`).join(",")});
  `);
  await pool.query(`
    ALTER TABLE introductions DROP CONSTRAINT IF EXISTS introductions_channel_check;
    ALTER TABLE introductions ADD CONSTRAINT introductions_channel_check
      CHECK (channel IN (${CHANNELS.map((c) => `'${c}'`).join(",")})) NOT VALID;
  `);

  // Retailer status: Prospect (submitted, unreviewed — "Submitted for
  // review", blue in the UI) / In Process (RIV is actively reviewing —
  // yellow; 18 Sep 2026 feedback, display-only state with no separate
  // trigger beyond RIV marking it) / Duplicate (name matched an existing
  // retailer at submission time — flagged yellow/amber, kept distinct from
  // In Process since it's informational) / Active in network (RIV approved
  // — "Approved", green) / Rejected (RIV declined, with a reason — red).
  // NOT VALID for the same reason as above: existing rows already hold
  // 'Prospect'/'Active in network', which are still valid, but NOT VALID
  // keeps this safe against any future superset changes the same way.
  await pool.query(`
    ALTER TABLE retailers DROP CONSTRAINT IF EXISTS retailers_status_check;
    ALTER TABLE retailers ADD CONSTRAINT retailers_status_check
      CHECK (status IN ('Active in network','Prospect','In Process','Duplicate','Rejected')) NOT VALID;
  `);
}

module.exports = { pool, INTRODUCTION_STATUSES, APPROVAL_STATUSES, DEAL_STATUSES, COMMIT_STATUSES, initSchema };