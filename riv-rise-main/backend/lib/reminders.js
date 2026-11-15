// Reminder emails for New Opportunities a startup hasn't answered.
//
// When RIV Admin creates a New Opportunity, the startup is asked for a
// Commit Status (OK to introduce / Already in touch / Not a right
// customer). If nothing has been recorded after a few days, RISE nudges the
// startup by email, up to a couple of times, then stops. It stops for good
// the moment a Commit Status is recorded by either the startup (portal) or
// RIV Admin (the phone/email fallback), or when the deal closes or is
// rejected.
//
// Env (all optional):
//   REMINDERS_ENABLED          - "false" switches the job off (default on)
//   OPPORTUNITY_REMINDER_DAYS  - days of silence before each reminder (default 3)
//   OPPORTUNITY_REMINDER_MAX   - most reminders per opportunity (default 2)
//
// Runs inside the long-lived server process (server.js), shortly after boot
// and then every few hours. Each reminder is "claimed" with a single UPDATE
// (reminder_count / last_reminder_at) before it's sent, so two server
// instances, or an overlapping run, can never send the same reminder twice.
// If the send doesn't go out, the claim is rolled back so a later run retries.
const { pool } = require("../db.js");
const { sendEmail, adminNotifyEmail, buildOpportunityReminder } = require("./email.js");

const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

function intEnv(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function sendDueReminders() {
  if (process.env.REMINDERS_ENABLED === "false") return { sent: 0 };
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return { sent: 0, skipped: "mail not configured" };

  const days = intEnv("OPPORTUNITY_REMINDER_DAYS", 3);
  const max = intEnv("OPPORTUNITY_REMINDER_MAX", 2);

  // Claim every due opportunity in one statement, remembering the previous
  // last_reminder_at so a failed send can be rolled back exactly.
  const { rows: claimed } = await pool.query(
    `WITH due AS (
       SELECT i.id, i.last_reminder_at AS old_last
         FROM introductions i
         JOIN startups s ON s.id = i.startup_id
        WHERE i.initiated_by = 'RIV Admin'
          AND i.startup_commit_status IS NULL
          AND i.approval_status <> 'Rejected'
          AND (i.engagement_stage IS NULL OR i.engagement_stage NOT IN ('Closed - Won','Closed - Lost','Stalled'))
          AND i.reminder_count < $2
          AND COALESCE(i.last_reminder_at, i.created_at) < now() - make_interval(days => $1)
          AND s.status = 'Active' AND s.email IS NOT NULL
        FOR UPDATE OF i SKIP LOCKED
     )
     UPDATE introductions i
        SET reminder_count = i.reminder_count + 1, last_reminder_at = now()
       FROM due
      WHERE i.id = due.id
      RETURNING i.id, due.old_last`,
    [days, max]
  );

  let sent = 0;
  for (const { id, old_last } of claimed) {
    const rollback = () =>
      pool
        .query("UPDATE introductions SET reminder_count = GREATEST(reminder_count - 1, 0), last_reminder_at = $2 WHERE id = $1", [id, old_last])
        .catch(() => {});
    try {
      const { rows } = await pool.query(
        `SELECT s.startup_name, s.founder_name, s.email, s.user_id, r.name AS retailer_name
           FROM introductions i JOIN startups s ON s.id = i.startup_id JOIN retailers r ON r.id = i.retailer_id
          WHERE i.id = $1`,
        [id]
      );
      const row = rows[0];
      if (!row) continue;
      const result = await sendEmail({
        to: row.email,
        ...buildOpportunityReminder({
          founderName: row.founder_name,
          startupName: row.startup_name,
          retailerName: row.retailer_name,
          hasPortalLogin: !!row.user_id,
        }),
        replyTo: adminNotifyEmail(),
        type: "opportunity-reminder",
      });
      if (result.skipped) await rollback();
      else sent += 1;
    } catch (err) {
      console.error(`Opportunity reminder failed (introduction ${id}):`, err);
      await rollback();
    }
  }
  return { sent };
}

function startReminderJob() {
  const run = () =>
    sendDueReminders()
      .then((r) => r.sent && console.log(`Opportunity reminders sent: ${r.sent}`))
      .catch((err) => console.error("Opportunity reminder job failed:", err));
  setTimeout(run, FIRST_RUN_DELAY_MS).unref();
  setInterval(run, RUN_EVERY_MS).unref();
}

module.exports = { sendDueReminders, startReminderJob };
