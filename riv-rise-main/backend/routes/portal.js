// RISE Portal — GTM Partner + Startup facing endpoints (PRD §6.3, §6.4,
// §6.5, §9 access rules). Admin-only management lives in admin.js.
//
// 12 Sep 2026 addendum: GTM partners no longer initiate introductions
// directly (the old "Introduce" action from the Startups tab is gone —
// see the removed partner branch of POST /introductions below). Their
// only write action now is submitting a retailer via "Add Retailer" /
// My Retailers, which goes to RIV for approval like everything else.
// Startups are the only role that can request an introduction, and every
// request now runs through the approval_status chain (see db.js) rather
// than going live immediately.
const { Router } = require("express");
const { pool, APPROVAL_STATUSES, DEAL_STATUSES } = require("../db.js");
const { requireAuth, requireRole } = require("../middleware/auth.js");

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
              competitive_advantage, paying_customer_count, notable_customers, key_milestones
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
      const { rows } = await pool.query(
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
const INTRO_SELECT = `
  SELECT i.*, s.startup_name, r.name AS retailer_name, r.category AS retailer_category,
         p.full_name AS partner_name
  FROM introductions i
  JOIN startups s ON s.id = i.startup_id
  JOIN retailers r ON r.id = i.retailer_id
  LEFT JOIN partners p ON p.id = i.partner_id
`;

// GET /api/introductions — "own" introductions only (PRD §9).
router.get("/introductions", requireRole("partner", "startup"), async (req, res, next) => {
  try {
    if (isPartner(req)) {
      const { rows: partnerRows } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
      const partnerId = partnerRows[0]?.id ?? -1;
      const { rows } = await pool.query(`${INTRO_SELECT} WHERE i.partner_id = $1 ORDER BY i.updated_at DESC`, [partnerId]);
      return res.json({ introductions: rows });
    }
    const { rows: startupRows } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const startupId = startupRows[0]?.id ?? -1;
    const { rows } = await pool.query(`${INTRO_SELECT} WHERE i.startup_id = $1 ORDER BY i.updated_at DESC`, [startupId]);
    res.json({ introductions: rows });
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
    res.json({ introduction: intro });
  } catch (err) {
    next(err);
  }
});

// POST /api/introductions — "Request Intro" (addendum §2/§3). Startup-only
// now: GTM partners no longer propose introductions directly (their old
// branch here is gone — see the file header note). Every request starts
// at "Pending RIV Approval" regardless of whether the retailer sits in a
// partner's network or is RIV Direct; RIV reviews everything before
// anyone downstream hears about it. Fields mirror the Google Sheet/
// tracker's Request Intro questionnaire exactly.
router.post("/introductions", requireRole("startup"), async (req, res, next) => {
  try {
    const {
      retailerId, whyInterested, problemSolved, relevantOffering, buyerPersona,
      previouslyEngaged, priorEngagementDetails, supportingMaterialUrl, consentAccepted,
    } = req.body || {};
    if (!retailerId) return res.status(400).json({ error: "Select the target enterprise (retailer)." });
    if (!consentAccepted) return res.status(400).json({ error: "You must accept the Terms & Conditions to submit a request." });

    const { rows: s } = await pool.query("SELECT id FROM startups WHERE user_id = $1", [req.user.id]);
    const startupId = s[0]?.id;
    if (!startupId) return res.status(403).json({ error: "No startup profile linked to this login." });

    const { rows: retailerRows } = await pool.query(
      "SELECT network_source, owning_partner_id FROM retailers WHERE id = $1 AND status = 'Active in network'",
      [retailerId]
    );
    const retailer = retailerRows[0];
    if (!retailer) return res.status(404).json({ error: "Retailer not found or not yet approved." });

    // Routing stays the same as before for who eventually gets notified
    // once RIV approves (RIV Direct -> no partner in the loop; GTM Partner
    // network -> that partner) — it just no longer determines the initial
    // status, which is always Pending RIV Approval now.
    const partnerId = retailer.network_source === "GTM Partner" ? retailer.owning_partner_id : null;

    const { rows } = await pool.query(
      `INSERT INTO introductions
         (initiated_by, partner_id, startup_id, retailer_id, network_source, approval_status, status,
          why_interested, problem_solved, relevant_offering, buyer_persona, previously_engaged,
          prior_engagement_details, supporting_material_url, consent_accepted, consent_accepted_at)
       VALUES ('Startup', $1, $2, $3, $4, 'Pending RIV Approval', 'Requested',
               $5, $6, $7, $8, $9, $10, $11, true, now())
       RETURNING *`,
      [partnerId, startupId, retailerId, retailer.network_source,
       whyInterested || null, problemSolved || null, relevantOffering || null, buyerPersona || null,
       previouslyEngaged ?? null, priorEngagementDetails || null, supportingMaterialUrl || null]
    );
    res.status(201).json({ introduction: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/opportunity — startup edits Opportunity Value
// and/or Deal Status at any point once the request exists (addendum §2's
// "My Introduction Requests" columns — both are startup-editable, unlike
// the RIV-driven approval_status).
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

    const { rows } = await pool.query(
      `UPDATE introductions SET opportunity_value = COALESCE($2, opportunity_value),
         engagement_stage = COALESCE($3, engagement_stage), updated_at = now(), updated_by = $4
       WHERE id = $1 RETURNING *`,
      [req.params.id, opportunityValue ?? null, dealStatus || null, req.user.name]
    );
    res.json({ introduction: rows[0] });
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
    res.json({ introduction: rows[0] });
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
    res.json({ introduction: rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/introductions/:id/log-introduction — GTM partner (or RIV admin,
// via admin.js) logs the actual introduction with proof (PRD §6.3 step 7).
// Proof is required before status can move to "Introduced" (§7).
router.put("/introductions/:id/log-introduction", requireRole("partner"), async (req, res, next) => {
  try {
    const { channel, introductionDate, proofOfIntroduction } = req.body || {};
    if (!proofOfIntroduction) return res.status(400).json({ error: "Proof of introduction is required before this can be logged." });

    const { rows: p } = await pool.query("SELECT id FROM partners WHERE user_id = $1", [req.user.id]);
    const { rows: introRows } = await pool.query("SELECT * FROM introductions WHERE id = $1", [req.params.id]);
    const intro = introRows[0];
    if (!intro || intro.partner_id !== p[0]?.id) return res.status(404).json({ error: "Introduction not found." });
    if (intro.approval_status !== "Startup Confirmed") {
      return res.status(400).json({ error: `Cannot log an introduction from approval status "${intro.approval_status}" — the startup must confirm first.` });
    }

    const { rows } = await pool.query(
      `UPDATE introductions
       SET channel = $2, introduction_date = COALESCE($3, CURRENT_DATE), proof_of_introduction = $4,
           status = 'Introduced', approval_status = 'Proof Recorded', updated_at = now(), updated_by = $5
       WHERE id = $1 RETURNING *`,
      [req.params.id, channel || "Email", introductionDate || null, proofOfIntroduction, req.user.name]
    );
    await notify(pool, "Introduction made", req.params.id, "startup", intro.startup_id);
    res.json({ introduction: rows[0] });
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
    res.json({ introduction: rows[0] });
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

    const feeAmountDue = Number(dealValue) * (Number(intro.closure_rate) / 100);
    const { rows } = await pool.query(
      `UPDATE introductions
       SET deal_value = $2, po_document = $3, sale_confirmation_date = CURRENT_DATE, fee_amount_due = $4,
           status = 'Closed - Won', engagement_stage = 'Won', updated_at = now(), updated_by = $5
       WHERE id = $1 RETURNING *`,
      [req.params.id, dealValue, poDocument, feeAmountDue, req.user.name]
    );
    if (intro.partner_id) {
      const { rows: partnerUserRows } = await pool.query("SELECT user_id FROM partners WHERE id = $1", [intro.partner_id]);
      if (partnerUserRows[0]?.user_id) await notifyUserId(pool, "Status updated", req.params.id, partnerUserRows[0].user_id);
    }
    res.json({ introduction: rows[0] });
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

    const status = outcome === "Lost" ? "Closed - Lost" : "Stalled";
    const engagementStage = outcome === "Lost" ? "Lost" : "Stalled";
    const { rows } = await pool.query(
      `UPDATE introductions SET status = $2, engagement_stage = $3, updated_at = now(), updated_by = $4 WHERE id = $1 RETURNING *`,
      [req.params.id, status, engagementStage, req.user.name]
    );
    await notifyOtherParty(req, intro, "Status updated");
    res.json({ introduction: rows[0] });
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