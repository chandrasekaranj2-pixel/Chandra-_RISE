// RISE Portal — GTM Partner + Startup facing endpoints (PRD §6.3, §6.4,
// §6.5, §9 access rules). Admin-only management lives in admin.js.
//
// 12 Sep 2026 addendum removed a GTM partner's ability to originate an
// introduction directly. 18 Sep 2026 feedback restores it as a distinct
// "Introduce Startup to Retailers" action (see POST /introductions'
// partner branch below), run alongside a "Confirm Introduction" step for
// pairings proposed to the partner by RIV or a startup — both still run
// through the exact same approval_status chain as everything else (see
// db.js): RIV approves first no matter who initiated.
const { Router } = require("express");
const { pool, APPROVAL_STATUSES, DEAL_STATUSES, COMMIT_STATUSES } = require("../db.js");
const { requireAuth, requireRole } = require("../middleware/auth.js");
const { handleSupportingMaterialUpload } = require("../lib/supportingMaterialUpload.js");
const { handleProofAttachmentUpload } = require("../lib/proofAttachmentUpload.js");
const { uploadSupportingMaterial, uploadProofAttachment, getSignedUrl } = require("../lib/supportingMaterialStorage.js");
const { sendIntroductionRequestAck } = require("../lib/email.js");

const router = Router();
router.use(requireAuth);

// Columns safe to return to partner/startup roles — contact_name/email/
// phone are deliberately excluded here (PRD §7/§9: "Retailer contact
// details are never shown to startups... only RIV or the introducing GTM
// partner"). The admin route file selects contact_* explicitly.
const RETAILER_PUBLIC_COLUMNS =
  "id, name, brand, website, category, location, hq_country, network_source, owning_partner_id, submitted_by_partner_id, status, rejection_reason";

function isPartner(req) {
  return req.user.role === "partner";
}
function isStartup(req) {
  return req.user.role === "startup";
}

// GET /api/me — this role's own partner or startup profile row.
router.get("/me", requireRole("partner", "startup", "admin"), async (req, res, next) => {
  try {
    if (isPartner(req)) {
      const { rows } = await pool.query("SELECT * FROM partners WHERE user_id = $1", [req.user.id]);
      return res.json({ role: "partner", profile: rows[0] || null });
    }
    if (isStartup(req)) {
      const { rows } = await pool.query("SELECT * FROM startups WHERE user_id = $1", [req.user.id]);
      return res.json({ role: "startup", profile: rows[0] || null });
    }
    res.json({ role: "admin", profile: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/startups — GTM partners browse the onboarded startup roster
// (PRD §6.3 step 2). View-only per the addendum — no introduce action
// hangs off this list anymore, just enough to decide whether to open the
// detail view.
router.get("/startups", requireRole("partner", "admin"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, startup_name, founder_name, sector, solution_summary
       FROM startups WHERE status = 'Active' ORDER BY startup_name`
    );
    res.json({ startups: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/startups/:id — full profile for the Startup Detail View
// (addendum §4). Same "nothing sensitive" bar as the list above, just
// every field a GTM partner needs to assess the startup before backing an
// introduction with their reputation.
router.get("/startups/:id", requireRole("partner", "startup", "admin"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, startup_name, founder_name, sector, solution_summary, problem_description,
              solution_description, top_benefits, tech_stack, sub_vertical, competition,
              competitive_advantage, paying_customer_count, notable_customers, key_milestones,
              legal_entity, website, city, hq_country, year_incorporated, founding_team_details,
              past_fund_raised, currently_raising_capital, fundraising_support_interest, additional_notes
       FROM startups WHERE id = $1 AND status = 'Active'`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Startup not found." });
    res.json({ startup: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/retailers — "My Retailers" for a partner: retailers they
// submitted (any approval state) plus anything RIV has approved into the
// network, from any source (addendum §1). A startup still sees the full
// approved directory. Contact fields never included (see
// RETAILER_PUBLIC_COLUMNS).
router.get("/retailers", requireRole("partner", "startup", "admin"), async (req, res, next) => {
  try {
    if (isPartner(req)) {
      const { rows: partnerRows } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
      const partnerId = partnerRows[0]?.id ?? null;
      // item 1 (25 Sep 2026 batch): "My Retail Network" (?mine=true) is now
      // scoped to ONLY retailers this partner owns/submitted — the old
      // "OR status = 'Active in network'" fallback showed any approved
      // retailer regardless of owner, which is dropped here. The default
      // (no ?mine=true) keeps the old, broader query, since
      // CheckIntroductionInterestSection's retailer picker (item 2 — the
      // partner needs to be able to pick ANY approved retailer to propose
      // a pairing, not just their own) still calls this same endpoint.
      const { rows } = req.query.mine === "true"
        ? await pool.query(
            `SELECT ${RETAILER_PUBLIC_COLUMNS} FROM retailers
             WHERE submitted_by_partner_id = $1 OR owning_partner_id = $1
             ORDER BY name`,
            [partnerId]
          )
        : await pool.query(
            `SELECT ${RETAILER_PUBLIC_COLUMNS} FROM retailers
             WHERE submitted_by_partner_id = $1 OR owning_partner_id = $1 OR status = 'Active in network'
             ORDER BY name`,
            [partnerId]
          );
      return res.json({ retailers: rows });
    }
    const { rows } = await pool.query(
      `SELECT ${RETAILER_PUBLIC_COLUMNS} FROM retailers WHERE status = 'Active in network' ORDER BY name`
    );
    res.json({ retailers: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/retailers — "Add Retailer" (addendum §1). A GTM partner
// submits a retailer into their own network; it lands as a Prospect
// pending RIV approval, same as everywhere else in this workflow — it
// only becomes visible to startups (or counted as "approved by RIV" in
// another partner's My Retailers view) once RIV flips it to Active in
// network from the admin panel. Fields mirror the RISE Introduction
// Submission Form (Bigin) in full.
router.post("/retailers", requireRole("partner"), async (req, res, next) => {
  try {
    const {
      name, brand, website, location, hqCountry, category,
      contactName, contactDesignation, contactEmail, contactPhone,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: "Enter the retail enterprise you are referring." });

    const { rows: p } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
    const partnerId = p[0]?.id;
    if (!partnerId) return res.status(403).json({ error: "No partner profile linked to this login." });

    // Duplicate detection — case/whitespace-insensitive match on name
    // against every existing retailer (any status, any submitter), not
    // just this partner's own. A match doesn't block the submission; it
    // still goes to RIV for review, just flagged so admin knows to check
    // it against the existing row before approving both.
    const { rows: dup } = await pool.query(
      "SELECT id FROM retailers WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1",
      [name]
    );
    const duplicateOfId = dup[0]?.id || null;
    const status = duplicateOfId ? "Duplicate" : "Prospect";

    const { rows } = await pool.query(
      `INSERT INTO retailers
         (name, brand, website, location, hq_country, category, network_source, owning_partner_id,
          submitted_by_partner_id, contact_name, contact_designation, contact_email, contact_phone,
          status, duplicate_of_retailer_id)
       VALUES ($1,$2,$3,$4,$5,$6,'GTM Partner',$7,$7,$8,$9,$10,$11,$12,$13) RETURNING ${RETAILER_PUBLIC_COLUMNS}`,
      [name, brand || null, website || null, location || null, hqCountry || null, category || null,
       partnerId, contactName || null, contactDesignation || null, contactEmail || null, contactPhone || null,
       status, duplicateOfId]
    );
    res.status(201).json({ retailer: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Shared SELECT used by both the list and detail introduction endpoints —
// joins in display names so the frontend doesn't need N+1 lookups.
// duplicate_of_* columns (item 13b) mirror admin.js's INTRO_SELECT_ADMIN
// join — safe to expose to partner/startup since they're just the
// duplicate pairing's own approval_status/initiated_by/request_date, not
// anything from publicIntro()'s admin-only strip list.
const INTRO_SELECT = `
  SELECT i.*, s.startup_name, r.name AS retailer_name, r.category AS retailer_category,
         p.full_name AS partner_name,
         dup.approval_status AS duplicate_of_approval_status, dup.initiated_by AS duplicate_of_initiated_by,
         dup.request_date AS duplicate_of_request_date
  FROM introductions i
  JOIN startups s ON s.id = i.startup_id
  JOIN retailers r ON r.id = i.retailer_id
  LEFT JOIN partners p ON p.id = i.partner_id
  LEFT JOIN introductions dup ON dup.id = i.duplicate_of_introduction_id
`;

// 24 Sep 2026 addendum: Supporting Material (the files a startup attaches
// on "Request Intro") is admin-viewing-only — a GTM partner/startup should
// see THAT files were attached, never the files themselves or their
// storage paths/URLs. INTRO_SELECT above (and every other `SELECT i.*`
// route in this file) pulls the raw supporting_material jsonb column
// straight off the introductions row, so every partner/startup-facing
// response must be passed through this stripper before res.json() —
// otherwise the files are exposed in the API response even though no
// current button in the UI happens to surface them. Only the *count*
// survives, as supporting_material_count, so the frontend can still show
// "3 files attached" without handing back paths. The admin equivalent
// routes in admin.js are untouched — full access there is intentional.
function publicIntro(intro) {
  if (!intro) return intro;
  const { supporting_material, supporting_material_url, riv_proof_attachment, ...rest } = intro;
  return {
    ...rest,
    supporting_material_count: Array.isArray(supporting_material) ? supporting_material.length : 0,
    has_riv_proof_attachment: !!riv_proof_attachment,
  };
}

// A "live" pairing (25 Sep 2026 batch, items 2 & 13) — not Rejected, and
// not sitting at a closed/dead deal stage. Shared SQL fragment so the
// partner-form block (item 2), the startup-side duplicate flag (item 13),
// and admin's own New Opportunity check (9 Oct 2026 batch, item 10) use
// the exact same definition of "still in the pipeline".
//
// Qualified with the "i." alias (9 Oct 2026 fix) — every call site joins
// this against startups/retailers (both of which also have a `status`
// column) or self-joins introductions again as `dup`, and an unqualified
// `status`/`approval_status`/`engagement_stage` is ambiguous the moment
// more than one of those tables is in scope. Every call site aliases the
// introductions row it means as `i`, so qualifying here is safe everywhere
// this is used.
const LIVE_PAIRING_SQL = `
  i.approval_status != 'Rejected'
  AND (i.status IS NULL OR i.status NOT IN ('Closed - Lost', 'Stalled'))
  AND (i.engagement_stage IS NULL OR i.engagement_stage NOT IN ('Closed - Lost', 'Stalled'))
`;

// Mirrors App.jsx's interestStatusFor() — used only to compose the
// duplicate-pairing warning message server-side (item 2), not for any
// stored value.
function interestStatusForServer(approvalStatus) {
  if (approvalStatus === "Rejected") return "Startup Not interested";
  if (["Startup Confirmed", "Introduced", "Proof Recorded"].includes(approvalStatus)) return "Startup interested";
  return "Awaiting Startup interest";
}
function publicIntros(intros) {
  return (intros || []).map(publicIntro);
}

// GET /api/introductions — "own" introductions only (PRD §9).
//
// 18 Sep 2026 addendum: optional ?initiatedBy= filter, used by the two
// Startup Retailer Introductions tabs to pull just their half each
// ("Startup" for Tab 1 — Retailer Introductions Requested; "RIV Admin"
// for Tab 2 — Retailer Introductions Initiated by RIV) instead of
// fetching everything and splitting client-side.
router.get("/introductions", requireRole("partner", "startup"), async (req, res, next) => {
  try {
    const { initiatedBy } = req.query;
    const initiatedByFilter = ["GTM Partner", "Startup", "RIV Admin"].includes(initiatedBy) ? initiatedBy : null;

    if (isPartner(req)) {
      const { rows: partnerRows } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
      const partnerId = partnerRows[0]?.id ?? -1;
      const { rows } = initiatedByFilter
        ? await pool.query(`${INTRO_SELECT} WHERE i.partner_id = $1 AND i.initiated_by = $2 ORDER BY i.updated_at DESC`, [partnerId, initiatedByFilter])
        : await pool.query(`${INTRO_SELECT} WHERE i.partner_id = $1 ORDER BY i.updated_at DESC`, [partnerId]);
      return res.json({ introductions: publicIntros(rows) });
    }
    const { rows: startupRows } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const startupId = startupRows[0]?.id ?? -1;
    const { rows } = initiatedByFilter
      ? await pool.query(`${INTRO_SELECT} WHERE i.startup_id = $1 AND i.initiated_by = $2 ORDER BY i.updated_at DESC`, [startupId, initiatedByFilter])
      : await pool.query(`${INTRO_SELECT} WHERE i.startup_id = $1 ORDER BY i.updated_at DESC`, [startupId]);
    res.json({ introductions: publicIntros(rows) });
  } catch (err) {
    next(err);
  }
});

// GET /api/introductions/confirm-queue — "Confirm Introduction" (18 Sep
// 2026 feedback): the partner's queue of pairings proposed TO them (by
// RIV or a startup) that are ready for their action — RIV has approved
// and is waiting on the partner to make/log the introduction. Mirrors
// what used to be buried inside the detail modal's "Log the introduction"
// card at approval_status = 'Startup Confirmed'; this surfaces it as its
// own tab-level list per the feedback, with the same approved-retailer /
// approved-startup identifying columns. MUST be registered before
// GET /introductions/:id below, or Express would match "confirm-queue"
// as an :id instead.
router.get("/introductions/confirm-queue", requireRole("partner"), async (req, res, next) => {
  try {
    const { rows: p } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
    const partnerId = p[0]?.id ?? -1;
    const { rows } = await pool.query(
      `${INTRO_SELECT} WHERE i.partner_id = $1 AND i.approval_status = 'Startup Confirmed' ORDER BY i.updated_at DESC`,
      [partnerId]
    );
    res.json({ introductions: publicIntros(rows) });
  } catch (err) {
    next(err);
  }
});

// GET /api/introductions/:id — detail, scoped to owner.
router.get("/introductions/:id", requireRole("partner", "startup"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${INTRO_SELECT} WHERE i.id = $1`, [req.params.id]);
    const intro = rows[0];
    if (!intro) return res.status(404).json({ error: "Introduction not found." });

    if (!(await ownsIntro(req, intro))) return res.status(403).json({ error: "Not your introduction." });
    res.json({ introduction: publicIntro(intro) });
  } catch (err) {
    next(err);
  }
});

// POST /api/introductions — "Request Intro" (startup, addendum §2/§3) OR
// "Introduce Startup to Retailers" (partner, 18 Sep 2026 feedback — the
// restored origination action). Every request starts at "Pending RIV
// Approval" regardless of who initiated or whether the retailer sits in a
// partner's network or is RIV Direct; RIV reviews everything before
// anyone downstream hears about it.
//
// multipart/form-data for the startup branch only (18 Sep 2026 addendum —
// Supporting Material is now real file uploads, not a URL field): the
// partner branch still sends plain JSON. handleSupportingMaterialUpload is
// safe on both — multer recognizes a non-multipart request and calls
// next() immediately without touching req.body, so the partner branch's
// JSON body parsing (via the global express.json() in app.js) is
// untouched either way.
router.post("/introductions", requireRole("startup", "partner"), handleSupportingMaterialUpload, async (req, res, next) => {
  try {
    if (isPartner(req)) return createPartnerInitiatedIntroduction(req, res, next);

    const {
      retailerId, whyInterested, problemSolved, relevantOffering, buyerPersona,
      previouslyEngaged, priorEngagementDetails, consentAccepted,
    } = req.body || {};
    if (!retailerId) return res.status(400).json({ error: "Select the target enterprise (retailer)." });
    // Sent as a multipart form field now, so it arrives as the string "true", not a boolean.
    if (consentAccepted !== "true") return res.status(400).json({ error: "You must accept the Terms & Conditions to submit a request." });

    const { rows: s } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const startupId = s[0]?.id;
    if (!startupId) return res.status(403).json({ error: "No startup profile linked to this login." });

    const { rows: retailerRows } = await pool.query(
      "SELECT name, network_source, owning_partner_id FROM retailers WHERE id = $1 AND status = 'Active in network'",
      [retailerId]
    );
    const retailer = retailerRows[0];
    if (!retailer) return res.status(404).json({ error: "Retailer not found or not yet approved." });

    // Routing stays the same as before for who eventually gets notified
    // once RIV approves (RIV Direct -> no partner in the loop; GTM Partner
    // network -> that partner) — it just no longer determines the initial
    // status, which is always Pending RIV Approval now.
    const partnerId = retailer.network_source === "GTM Partner" ? retailer.owning_partner_id : null;

    // Upload before insert so a storage failure doesn't leave behind an
    // introduction row with files it claims to have but doesn't.
    const supportingMaterial = await uploadSupportingMaterial(req.files, { startupId });

    // Duplicate-introduction flagging (item 13) — unlike the GTM partner's
    // form (item 2), the startup's own Request Intro stays unblocked: a
    // duplicate is still created, just flagged for admin's attention.
    const { rows: dupRows } = await pool.query(
      `SELECT id FROM introductions i WHERE i.startup_id = $1 AND i.retailer_id = $2 AND ${LIVE_PAIRING_SQL} ORDER BY i.created_at ASC LIMIT 1`,
      [startupId, retailerId]
    );
    const duplicateOfIntroductionId = dupRows[0]?.id || null;

    const { rows } = await pool.query(
      `INSERT INTO introductions
         (initiated_by, partner_id, startup_id, retailer_id, network_source, approval_status, status,
          why_interested, problem_solved, relevant_offering, buyer_persona, previously_engaged,
          prior_engagement_details, supporting_material, consent_accepted, consent_accepted_at,
          duplicate_of_introduction_id)
       VALUES ('Startup', $1, $2, $3, $4, 'Pending RIV Approval', 'Requested',
               $5, $6, $7, $8, $9, $10, $11::jsonb, true, now(), $12)
       RETURNING *`,
      [partnerId, startupId, retailerId, retailer.network_source,
       whyInterested || null, problemSolved || null, relevantOffering || null, buyerPersona || null,
       previouslyEngaged === "true", priorEngagementDetails || null, JSON.stringify(supportingMaterial),
       duplicateOfIntroductionId]
    );
    res.status(201).json({ introduction: publicIntro(rows[0]) });

    // Acknowledgement email (addendum) — fired after the row is committed
    // and the response already sent, so a slow or failing SendGrid call
    // never delays or fails the actual submission. Errors are logged, not
    // thrown: req.user.email always exists (it's the logged-in startup
    // login), but a bad/missing SendGrid config or a transient provider
    // error shouldn't surface to the user as a failed request when the
    // introduction itself was created successfully.
    sendIntroductionRequestAck({
      to: req.user.email,
      founderName: req.user.name,
      retailerName: retailer.name,
      requestedAt: rows[0].created_at,
    }).catch((err) => console.error("Introduction ack email failed:", err));
  } catch (err) {
    next(err);
  }
});

// 24 Sep 2026 addendum: there used to be a
// GET /introductions/:id/supporting-material/:index route here, scoped to
// the owning partner/startup, that redirected straight to a signed
// download link for an attached file. Supporting Material is now
// admin-viewing-only (see publicIntro() above), so that route is removed
// entirely rather than left reachable — a partner/startup can no longer
// fetch the files at all, not even their own. The unscoped admin
// equivalent (GET /admin/introductions/:id/supporting-material/:index)
// remains in admin.js; that is the only place these files can be opened
// from now.

// "Check Introduction Interest with the Startup" (18 Sep 2026 feedback,
// renamed + reworked 19 Sep 2026) — a GTM partner proposes a retailer x
// startup pairing, to check whether RIV/the startup are interested.
// Fields mirror the RISE Introduction Submission Form by GTM Partners
// (Bigin) — name/email are the logged-in partner, so only the pairing +
// opportunity context are collected here. Both retailer and startup must
// already be approved (Active in network / Active) — enforced server-side,
// not just by the dropdown only offering approved options client-side.
// Always lands at 'Pending RIV Approval' like every other introduction;
// this is what makes the partner eligible for the Expected GTM Success
// Fee later (see computePartnerFee below) since initiated_by is set to
// 'GTM Partner'.
//
// 19 Sep 2026 feedback moved "how introduced" + the facilitation
// declaration to the separate proof-of-introduction step (see
// PUT /introductions/:id/log-introduction below) — at THIS step nothing
// has actually happened yet, it's just a check of interest, so neither is
// collected or required here any more.
async function createPartnerInitiatedIntroduction(req, res, next) {
  try {
    const { retailerId, startupId, opportunityContext } = req.body || {};
    if (!retailerId || !startupId) return res.status(400).json({ error: "Select both a retailer and a startup." });

    const { rows: p } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
    const partnerId = p[0]?.id;
    if (!partnerId) return res.status(403).json({ error: "No partner profile linked to this login." });

    const { rows: retailerRows } = await pool.query(
      "SELECT network_source FROM retailers WHERE id = $1 AND status = 'Active in network'", [retailerId]
    );
    if (!retailerRows[0]) return res.status(404).json({ error: "Retailer not found or not yet approved." });
    const { rows: startupRows } = await pool.query("SELECT id FROM startups WHERE id = $1 AND status = 'Active'", [startupId]);
    if (!startupRows[0]) return res.status(404).json({ error: "Startup not found or not yet approved." });

    // Duplicate-pairing validation (item 2) — server-side is the source of
    // truth; blocks the GTM partner's form outright (unlike the startup's
    // own Request Intro, which stays open and merely flags — see item 13).
    const { rows: dupRows } = await pool.query(
      `${INTRO_SELECT} WHERE i.startup_id = $1 AND i.retailer_id = $2 AND ${LIVE_PAIRING_SQL} ORDER BY i.created_at ASC LIMIT 1`,
      [startupId, retailerId]
    );
    if (dupRows[0]) {
      const dup = dupRows[0];
      const initiatorLabel = dup.initiated_by === "RIV Admin" ? "RIV" : dup.initiated_by;
      // 9 Oct 2026 batch — dropped the embedded interestStatusForServer(...)
      // ("Awaiting Startup interest" etc.) from this message; that wording
      // is admin/startup-only now, not shown in the GTM partner's flow.
      return res.status(409).json({
        error: `${dup.startup_name} has already been introduced to ${dup.retailer_name} — this pairing is already in the pipeline (Initiated by ${initiatorLabel}). Check the list below instead of submitting a duplicate.`,
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO introductions
         (initiated_by, partner_id, startup_id, retailer_id, network_source, approval_status, status,
          gtm_context_note, consent_accepted, consent_accepted_at)
       VALUES ('GTM Partner', $1, $2, $3, $4, 'Pending RIV Approval', 'Requested', $5, true, now())
       RETURNING *`,
      [partnerId, startupId, retailerId, retailerRows[0].network_source, opportunityContext || null]
    );
    await notifyAdmins("New partner-initiated introduction", rows[0].id);
    res.status(201).json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
}

// PUT /api/introductions/:id/opportunity — startup edits Opportunity Value
// and/or Deal Status at any point once the request exists (addendum §2's
// "My Introduction Requests" columns — both are startup-editable, unlike
// the RIV-driven approval_status). Shared by both Startup Retailer
// Introductions tabs (Tab 1 — Requested, and Tab 2 — Initiated by RIV);
// the gating rules below are identical for both per the 18 Sep 2026 PRD.
//
// Server-side mirror of the UI's editable/read-only rules (PRD §Tab 1
// items 8–10 / §Tab 2 items 10–12) — the frontend already disables these
// inputs at the same points, this just stops a direct API call from
// bypassing that.
router.put("/introductions/:id/opportunity", requireRole("startup"), async (req, res, next) => {
  try {
    const { opportunityValue, dealStatus } = req.body || {};
    if (dealStatus && !DEAL_STATUSES.includes(dealStatus)) {
      return res.status(400).json({ error: `dealStatus must be one of: ${DEAL_STATUSES.join(", ")}` });
    }
    const { rows: s } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro || intro.startup_id !== s[0]?.id) return res.status(404).json({ error: "Introduction not found." });

    if ((dealStatus || opportunityValue !== undefined) && intro.status !== "Introduced") {
      return res.status(400).json({ error: "Deal Status and Opportunity Value can only be set once Introduction Status is \"Introduced\"." });
    }
    if (opportunityValue !== undefined && intro.engagement_stage === "Closed - Won") {
      return res.status(400).json({ error: "Opportunity Value is read-only once Deal Status is \"Closed – Won\"." });
    }

    const { rows } = await pool.query(
      `UPDATE introductions SET opportunity_value = COALESCE($2, opportunity_value),
         engagement_stage = COALESCE($3, engagement_stage), updated_at = now(), updated_by = $4
       WHERE id = $1 RETURNING *`,
      [req.params.id, opportunityValue ?? null, dealStatus || null, req.user.name]
    );
    res.json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/commit-status — Tab 2 ("Retailer
// Introductions Initiated by RIV") only. Startup-editable again as of the
// 24 Sep 2026 addendum (Scenario C: "either can set Commit Status —
// startup directly if they're in the app, Admin as a fallback if the
// startup responded by phone/email instead"). This restores what the 21
// Sep 2026 addendum had made admin-only (PUT /api/admin/introductions/:id's
// startupCommitStatus field in admin.js, still there and still usable as
// the phone/email fallback) — both routes write the same column, so
// whichever side acts first is simply what sticks; neither one locks the
// other out.
//   - "OK to introduce"        -> notifies RIV to proceed with the intro.
//   - "Already in touch"       -> notifies RIV, flags a likely duplicate.
//   - "Not a right customer"   -> notifies RIV, who decides final disposition.
// Applies to anything the startup didn't initiate itself — RIV-direct
// opportunities (initiated_by = 'RIV Admin') and GTM-partner-proposed
// pairings (initiated_by = 'GTM Partner') alike, matching what Admin's own
// startupCommitStatus control already allows (`initiated_by !== 'Startup'`).
router.put("/introductions/:id/commit-status", requireRole("startup"), async (req, res, next) => {
  try {
    const { commitStatus } = req.body || {};
    if (!COMMIT_STATUSES.includes(commitStatus)) {
      return res.status(400).json({ error: `commitStatus must be one of: ${COMMIT_STATUSES.join(", ")}` });
    }
    const { rows: s } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro || intro.startup_id !== s[0]?.id) return res.status(404).json({ error: "Introduction not found." });
    if (intro.initiated_by === "Startup") {
      return res.status(400).json({ error: "Commit Status only applies to opportunities RIV or a GTM partner initiated." });
    }
    // Item 14 (server-side guard): once the deal has reached a closed
    // state, Commit Status is read-only ("N/A" in the UI) — reject any
    // attempt to change it via direct API call too, not just disable the
    // control client-side.
    if (["Closed - Won", "Closed - Lost", "Stalled"].includes(intro.engagement_stage)) {
      return res.status(400).json({ error: "Commit Status is read-only once the deal has reached a closed stage." });
    }

    // Item 9: auto-advance GTM-Notified -> Startup Confirmed. Only when the
    // startup picks "OK to introduce" AND the introduction is currently
    // sitting at exactly 'GTM Notified' — every other Commit Status value,
    // and every other starting approval_status (e.g. Scenario A/C, where
    // there's no partner in the loop and this never sits at GTM Notified in
    // the first place), leaves approval_status untouched and still requires
    // Admin's manual review via the existing approve route.
    const shouldAutoAdvance = commitStatus === "OK to introduce" && intro.approval_status === "GTM Notified";
    const { rows } = await pool.query(
      `UPDATE introductions
       SET startup_commit_status = $2, startup_commit_status_at = now(),
           approval_status = CASE WHEN $4 THEN 'Startup Confirmed' ELSE approval_status END,
           updated_at = now(), updated_by = $3
       WHERE id = $1 RETURNING *`,
      [req.params.id, commitStatus, req.user.name, shouldAutoAdvance]
    );
    await notifyAdmins(`Startup commit status: ${commitStatus}`, req.params.id);
    res.json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/confirm-request — startup's confirmation step
// after RIV has approved and the GTM partner has been notified (addendum
// §3's chain: ...RIV approves -> GTM partner notified -> Startup confirms
// -> Introduction is made). Not to be confused with the legacy /agree
// endpoint below, which belongs to the old charge-agreement lifecycle.
router.put("/introductions/:id/confirm-request", requireRole("startup"), async (req, res, next) => {
  try {
    const { rows: s } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro || intro.startup_id !== s[0]?.id) return res.status(404).json({ error: "Introduction not found." });
    if (intro.approval_status !== "GTM Notified") {
      return res.status(400).json({ error: `Cannot confirm from approval status "${intro.approval_status}".` });
    }
    const { rows } = await pool.query(
      `UPDATE introductions SET approval_status = 'Startup Confirmed', updated_at = now(), updated_by = $2
       WHERE id = $1 RETURNING *`,
      [req.params.id, req.user.name]
    );
    if (intro.partner_id) {
      const { rows: partnerUserRows } = await pool.query("SELECT user_id FROM partners WHERE id = $1", [intro.partner_id]);
      if (partnerUserRows[0]?.user_id) await notifyUserId(pool, "Status updated", req.params.id, partnerUserRows[0].user_id);
    }
    res.json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/agree — startup agrees to a partner-proposed
// introduction and its associated charge (PRD §6.3 step 5). Logs who
// agreed and when (mandatory-consent rule, §7).
router.put("/introductions/:id/agree", requireRole("startup"), async (req, res, next) => {
  try {
    const { rows: s } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro || intro.startup_id !== s[0]?.id) return res.status(404).json({ error: "Introduction not found." });
    if (intro.status !== "Pending Startup Agreement") return res.status(400).json({ error: `Cannot agree from status "${intro.status}".` });

    const { rows } = await pool.query(
      `UPDATE introductions SET startup_agreed = true, startup_agreed_at = now(), status = 'Approved', updated_at = now(), updated_by = $2
       WHERE id = $1 RETURNING *`,
      [req.params.id, req.user.name]
    );
    // "Agreement required" was the notification that got the partner here;
    // this is the resolution of it, so the partner is told the answer.
    if (intro.partner_id) {
      const { rows: partnerUserRows } = await pool.query("SELECT user_id FROM partners WHERE id = $1", [intro.partner_id]);
      if (partnerUserRows[0]?.user_id) await notifyUserId(pool, "Status updated", req.params.id, partnerUserRows[0].user_id);
    }
    res.json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/log-introduction — GTM partner (or RIV admin,
// via admin.js) logs the actual introduction with proof (PRD §6.3 step 7).
// Proof is required before status can move to "Introduced" (§7).
//
// 19 Sep 2026 feedback ("Submit Proof of Startup-Retailer Introduction"):
// proof is now an attached screenshot/PDF (multipart/form-data, field
// "proofAttachment") rather than a free-text description — see
// proofAttachmentUpload.js and uploadProofAttachment above. The
// facilitation declaration also moved here from the "check interest" step
// (createPartnerInitiatedIntroduction above), since it only makes sense
// once an introduction has actually happened. proof_of_introduction
// (TEXT) is still set, to the file's name, so every existing display of
// that column keeps showing something readable.
router.put("/introductions/:id/log-introduction", requireRole("partner"), handleProofAttachmentUpload, async (req, res, next) => {
  try {
    const { channel, introductionDate, declarationAccepted } = req.body || {};
    if (!req.file) return res.status(400).json({ error: "Attach proof of introduction (a screenshot or PDF) before this can be logged." });
    // Sent as a multipart form field, so it arrives as the string "true".
    if (declarationAccepted !== "true") return res.status(400).json({ error: "You must confirm you have personally facilitated this introduction." });

    const { rows: p } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro || intro.partner_id !== p[0]?.id) return res.status(404).json({ error: "Introduction not found." });
    if (intro.approval_status !== "Startup Confirmed") {
      return res.status(400).json({ error: `Cannot log an introduction from approval status "${intro.approval_status}" — the startup must confirm first.` });
    }

    // Upload before the UPDATE, same reasoning as POST /introductions
    // above — a storage failure shouldn't leave a row claiming proof it
    // doesn't have.
    const proofAttachment = await uploadProofAttachment(req.file, { introId: req.params.id });

    const { rows } = await pool.query(
      `UPDATE introductions
       SET channel = $2, introduction_date = COALESCE($3, CURRENT_DATE), proof_of_introduction = $4,
           proof_attachment = $5::jsonb, status = 'Introduced', approval_status = 'Proof Recorded',
           updated_at = now(), updated_by = $6
       WHERE id = $1 RETURNING *`,
      [req.params.id, channel || "Email", introductionDate || null, proofAttachment.name, JSON.stringify(proofAttachment), req.user.name]
    );
    await notify(pool, "Introduction made", req.params.id, "startup", intro.startup_id);
    res.json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// GET /api/introductions/:id/proof-attachment — redirects to a
// freshly-signed download link for the proof-of-introduction file logged
// above. Same owner-scoping pattern as the supporting-material route; the
// admin-unscoped equivalent lives in admin.js.
router.get("/introductions/:id/proof-attachment", requireRole("partner", "startup"), async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = rows[0];
    if (!intro) return res.status(404).json({ error: "Introduction not found." });
    if (!(await ownsIntro(req, intro))) return res.status(403).json({ error: "Not your introduction." });
    if (!intro.proof_attachment) return res.status(404).json({ error: "No proof attachment on file." });

    const url = await getSignedUrl(intro.proof_attachment.path);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/follow-up — either party (or admin) adds a
// timestamped note and optionally updates the retailer engagement stage;
// first follow-up on an "Introduced" record moves it to "In Progress".
router.put("/introductions/:id/follow-up", requireRole("partner", "startup"), async (req, res, next) => {
  try {
    const { note, engagementStage } = req.body || {};
    if (!note) return res.status(400).json({ error: "A follow-up note is required." });

    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro) return res.status(404).json({ error: "Introduction not found." });
    if (!(await ownsIntro(req, intro))) return res.status(403).json({ error: "Not your introduction." });

    const nextStatus = intro.status === "Introduced" ? "In Progress" : intro.status;
    const entry = { date: new Date().toISOString(), author: req.user.name, note };
    const { rows } = await pool.query(
      `UPDATE introductions
       SET follow_up_log = follow_up_log || $2::jsonb, engagement_stage = COALESCE($3, engagement_stage), status = $4, updated_at = now(), updated_by = $5
       WHERE id = $1 RETURNING *`,
      [req.params.id, JSON.stringify([entry]), engagementStage || null, nextStatus, req.user.name]
    );
    await notifyOtherParty(req, intro, "Status updated");
    res.json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/confirm-sale — startup confirms a closed deal
// and uploads the PO (PRD §6.3 step 10). PO required before "Closed - Won"
// (§7); the 25% closure rate replaces the 15% intro rate at this point,
// and fee_amount_due is computed off the disclosed deal value.
router.put("/introductions/:id/confirm-sale", requireRole("startup"), async (req, res, next) => {
  try {
    const { dealValue, poDocument } = req.body || {};
    if (!poDocument) return res.status(400).json({ error: "A PO / sale document is required to confirm a sale." });
    if (!dealValue || Number(dealValue) <= 0) return res.status(400).json({ error: "A positive deal value is required." });

    const { rows: s } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro || intro.startup_id !== s[0]?.id) return res.status(404).json({ error: "Introduction not found." });
    if (!["Introduced", "In Progress"].includes(intro.status)) {
      return res.status(400).json({ error: `Cannot confirm a sale from status "${intro.status}".` });
    }

    // 'Won' predates the 18-Sep-2026 DEAL_STATUSES list (db.js) and no
    // longer satisfies introductions_engagement_stage_check — same class of
    // bug the NOT VALID/normalization comments in db.js document. Use the
    // current value, 'Closed - Won', so this write doesn't fail outright.
    const feeAmountDue = Number(dealValue) * (Number(intro.closure_rate) / 100);
    const { partnerFeePct, partnerFeeAmount } = await computePartnerFee(intro, feeAmountDue);
    const { rows } = await pool.query(
      `UPDATE introductions
       SET deal_value = $2, po_document = $3, sale_confirmation_date = CURRENT_DATE, fee_amount_due = $4,
           status = 'Closed - Won', engagement_stage = 'Closed - Won', partner_fee_pct = $6, partner_fee_amount = $7,
           updated_at = now(), updated_by = $5
       WHERE id = $1 RETURNING *`,
      [req.params.id, dealValue, poDocument, feeAmountDue, req.user.name, partnerFeePct, partnerFeeAmount]
    );
    if (intro.partner_id) {
      const { rows: partnerUserRows } = await pool.query("SELECT user_id FROM partners WHERE id = $1", [intro.partner_id]);
      if (partnerUserRows[0]?.user_id) await notifyUserId(pool, "Status updated", req.params.id, partnerUserRows[0].user_id);
    }
    res.json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/close — either party marks a dead
// introduction as Lost or Stalled.
router.put("/introductions/:id/close", requireRole("partner", "startup"), async (req, res, next) => {
  try {
    const { outcome } = req.body || {}; // "Lost" | "Stalled"
    if (!["Lost", "Stalled"].includes(outcome)) return res.status(400).json({ error: 'outcome must be "Lost" or "Stalled".' });

    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro) return res.status(404).json({ error: "Introduction not found." });
    if (!(await ownsIntro(req, intro))) return res.status(403).json({ error: "Not your introduction." });

    // Same DEAL_STATUSES-vs-legacy-value fix as confirm-sale above — 'Lost'
    // isn't a current Deal Status value, 'Closed - Lost' is.
    const status = outcome === "Lost" ? "Closed - Lost" : "Stalled";
    const engagementStage = outcome === "Lost" ? "Closed - Lost" : "Stalled";
    const { rows } = await pool.query(
      `UPDATE introductions SET status = $2, engagement_stage = $3, updated_at = now(), updated_by = $4 WHERE id = $1 RETURNING *`,
      [req.params.id, status, engagementStage, req.user.name]
    );
    await notifyOtherParty(req, intro, "Status updated");
    res.json({ introduction: publicIntro(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications — in-app notification feed for the logged-in user.
router.get("/notifications", requireRole("partner", "startup"), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM notifications WHERE recipient_user_id = $1 ORDER BY sent_at DESC LIMIT 50",
      [req.user.id]
    );
    res.json({ notifications: rows });
  } catch (err) {
    next(err);
  }
});

router.put("/notifications/:id/ack", requireRole("partner", "startup"), async (req, res, next) => {
  try {
    await pool.query("UPDATE notifications SET read_ack = true WHERE id = $1 AND recipient_user_id = $2", [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Returns true if the logged-in partner/startup owns this introduction.
// Deliberately returns a boolean rather than throwing — server.js's error
// middleware always responds 500 regardless of a thrown error's .status.
async function ownsIntro(req, intro) {
  if (isPartner(req)) {
    const { rows } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
    return intro.partner_id === rows[0]?.id;
  }
  const { rows } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
  return intro.startup_id === rows[0]?.id;
}

// Expected GTM Success Fee (18 Sep 2026 decision): the partner's cut of
// the closure fee, LOCKED IN at Closed-Won time rather than recomputed
// live off the partner's current rate — so a later change to that
// partner's default_payout_split/revenue_share_override never
// retroactively changes a figure already shown or paid on a closed deal.
// Only ever applies when the partner actively originated the introduction
// via "Introduce Startup to Retailers" (initiated_by = 'GTM Partner') —
// per the 18 Sep 2026 decision, a startup-initiated introduction pays RIV
// in full even when the retailer happens to sit in that partner's
// network. Shared by portal.js's confirm-sale and admin.js's manual
// Closed-Won override so both paths compute it identically.
async function computePartnerFee(intro, feeAmountDue) {
  if (intro.initiated_by !== "GTM Partner" || !intro.partner_id) return { partnerFeePct: null, partnerFeeAmount: null };
  const { rows } = await pool.query("SELECT default_payout_split, revenue_share_override FROM partners WHERE id = $1", [intro.partner_id]);
  const partner = rows[0];
  if (!partner) return { partnerFeePct: null, partnerFeeAmount: null };
  const pct = Number(partner.revenue_share_override ?? partner.default_payout_split);
  return { partnerFeePct: pct, partnerFeeAmount: Number(feeAmountDue) * (pct / 100) };
}
// Exposed as a property on the router (not a bare module.exports.* line,
// which the `module.exports = router` at the bottom of this file would
// otherwise discard) so admin.js's manual Closed-Won override can reuse
// the exact same calculation.
router.computePartnerFee = computePartnerFee;
// 9 Oct 2026 batch, item 10 — admin's own "New Opportunity" creation route
// (admin.js) had no duplicate-pairing check at all, unlike the GTM
// partner's form (createPartnerInitiatedIntroduction above). Exposed here,
// same reasoning as computePartnerFee just above, so admin.js can run the
// exact same LIVE_PAIRING_SQL check instead of duplicating it.
router.LIVE_PAIRING_SQL = LIVE_PAIRING_SQL;
router.interestStatusForServer = interestStatusForServer;

// Small notification-log helpers.
async function notify(poolRef, type, introId, recipientRole, recipientProfileId) {
  const table = recipientRole === "startup" ? "startups" : "partners";
  const { rows } = await poolRef.query(`SELECT user_id FROM ${table} WHERE id = $1`, [recipientProfileId]);
  if (rows[0]?.user_id) await notifyUserId(poolRef, type, introId, rows[0].user_id);
}
async function notifyUserId(poolRef, type, introId, userId) {
  await poolRef.query(
    "INSERT INTO notifications (recipient_user_id, type, related_introduction_id, message) VALUES ($1,$2,$3,$4)",
    [userId, type, introId, type]
  );
}
// Fans a notification out to every RIV Admin login — there's no single
// "RIV" recipient row (admin.js's notifyStartup/notifyPartner target one
// partner/startup profile's user_id; there's no equivalent "the admin
// team" profile), so this is the startup-side mirror: look up every user
// with role='admin' and log one notification row each.
async function notifyAdmins(type, introId) {
  const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin'");
  await Promise.all(rows.map((u) => notifyUserId(pool, type, introId, u.id)));
}
// Notifies whichever side (partner or startup) did NOT just take the
// action — used for shared-access actions like follow-up/close where
// either party can act and the other should hear about it.
async function notifyOtherParty(req, intro, type) {
  if (isStartup(req) && intro.partner_id) {
    const { rows } = await pool.query("SELECT user_id FROM partners WHERE id = $1", [intro.partner_id]);
    if (rows[0]?.user_id) await notifyUserId(pool, type, intro.id, rows[0].user_id);
  } else if (isPartner(req)) {
    const { rows } = await pool.query("SELECT user_id FROM startups WHERE id = $1", [intro.startup_id]);
    if (rows[0]?.user_id) await notifyUserId(pool, type, intro.id, rows[0].user_id);
  }
}

module.exports = router;