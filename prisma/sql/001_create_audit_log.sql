-- Surgical migration for the clinic-operations Audit Log feature.
-- Creates ONLY the new audit_log table + its enum/indexes in the public schema.
-- Does NOT touch any existing HealthX table. Idempotent (IF NOT EXISTS guards).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auditReferenceType') THEN
    CREATE TYPE "auditReferenceType" AS ENUM ('QUEUE', 'APPOINTMENT', 'OPD', 'CUSTOMER', 'SYSTEM');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "audit_log" (
    "audit_log_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "reference_type" "auditReferenceType" NOT NULL,
    "reference_id" VARCHAR(50) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "action_label" VARCHAR(200) NOT NULL,
    "from_status" VARCHAR(100),
    "to_status" VARCHAR(100),
    "actor_user_id" VARCHAR(50) NOT NULL,
    "actor_name" VARCHAR(200),
    "actor_role" VARCHAR(50),
    "on_behalf_of_user_id" VARCHAR(50),
    "on_behalf_of_name" VARCHAR(200),
    "duration_sec" INTEGER,
    "notes" TEXT,
    "reason" TEXT,
    "ip_address" VARCHAR(64),
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("audit_log_id")
);

CREATE INDEX IF NOT EXISTS "audit_log_clinic_id_branch_id_idx" ON "audit_log"("clinic_id", "branch_id");
CREATE INDEX IF NOT EXISTS "audit_log_reference_type_reference_id_idx" ON "audit_log"("reference_type", "reference_id");
CREATE INDEX IF NOT EXISTS "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log"("created_at");
