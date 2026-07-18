-- Phase 1 walk-in identity policy: one active WALK_IN encounter per
-- clinic/branch/customer/Bangkok business date. A second start resumes the
-- active encounter; CLOSED/CANCELLED visits are deliberately excluded so a
-- later explicit visit can start normally.
--
-- Fail loudly if pre-existing duplicates need reconciliation instead of
-- silently choosing a clinical record to keep.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "opd_encounter"
        WHERE "encounter_type" = 'WALK_IN'
          AND "appointment_id" IS NULL
          AND "workflow_status" IN ('OPEN', 'POST_VISIT')
        GROUP BY "clinic_id", "branch_id", "customer_id", "business_date"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce active walk-in uniqueness: duplicate active daily walk-ins require reconciliation';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "opd_encounter_active_daily_walk_in_uq"
    ON "opd_encounter" (
        "clinic_id",
        "branch_id",
        "customer_id",
        "business_date"
    )
    WHERE "encounter_type" = 'WALK_IN'
      AND "appointment_id" IS NULL
      AND "workflow_status" IN ('OPEN', 'POST_VISIT');
