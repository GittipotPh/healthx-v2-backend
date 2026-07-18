-- OPD V2 Phase 1 app-owned consistency hardening.
--
-- The existing tenant FK proves that an encounter's ticket exists in the same
-- clinic/branch. This additional key also proves that the customer and Bangkok
-- business date copied into the encounter are the ticket's values. It changes
-- only OPD V2 app-owned tables and is safe to run repeatedly.

CREATE UNIQUE INDEX IF NOT EXISTS "opd_queue_ticket_encounter_identity_uq"
    ON "opd_queue_ticket" (
        "queue_ticket_id",
        "clinic_id",
        "branch_id",
        "customer_id",
        "business_date"
    );

CREATE UNIQUE INDEX IF NOT EXISTS "opd_encounter_ticket_identity_uq"
    ON "opd_encounter" (
        "queue_ticket_id",
        "clinic_id",
        "branch_id",
        "customer_id",
        "business_date"
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "pg_constraint"
        WHERE "conname" = 'opd_encounter_ticket_identity_fkey'
          AND "conrelid" = 'opd_encounter'::REGCLASS
    ) THEN
        ALTER TABLE "opd_encounter"
            ADD CONSTRAINT "opd_encounter_ticket_identity_fkey"
            FOREIGN KEY (
                "queue_ticket_id",
                "clinic_id",
                "branch_id",
                "customer_id",
                "business_date"
            )
            REFERENCES "opd_queue_ticket" (
                "queue_ticket_id",
                "clinic_id",
                "branch_id",
                "customer_id",
                "business_date"
            )
            ON DELETE RESTRICT
            ON UPDATE CASCADE;
    END IF;
END
$$;

-- 011 initially linked the ticket only by tenant. Once the stronger identity
-- constraint exists, remove that now-redundant app-owned foreign key so the
-- live database exactly matches the Prisma relation above.
ALTER TABLE "opd_encounter"
    DROP CONSTRAINT IF EXISTS "opd_encounter_queue_ticket_tenant_fkey";
