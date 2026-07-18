-- Surgical, additive migration for the OPD V2 Phase 1 identity foundation.
-- Creates ONLY app-owned tables and indexes. HealthX-owned customer,
-- appointment, OPD, and user identifiers remain scalar string references:
-- there are deliberately no foreign keys to legacy HealthX tables.
-- New-to-new foreign keys include clinic/branch so a child cannot cross tenants.
-- Idempotent for repeated execution (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS "opd_queue_ticket" (
    "queue_ticket_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "appointment_id" VARCHAR(50),
    "legacy_queue_status_id" UUID,
    "source_type" VARCHAR(20) NOT NULL,
    "business_date" DATE NOT NULL,
    "current_step" VARCHAR(30) NOT NULL,
    "entered_at" TIMESTAMPTZ(6) NOT NULL,
    "queue_sequence" INTEGER NOT NULL,
    "display_number" VARCHAR(30) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(50),
    "cancellation_reason" VARCHAR(500),
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_queue_ticket_pkey" PRIMARY KEY ("queue_ticket_id"),
    CONSTRAINT "opd_queue_ticket_current_step_fkey" FOREIGN KEY ("current_step")
        REFERENCES "ref_queue_step_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_queue_ticket_source_type_check" CHECK (
        "source_type" IN ('APPOINTMENT', 'WALK_IN')
    ),
    CONSTRAINT "opd_queue_ticket_source_appointment_check" CHECK (
        ("source_type" = 'APPOINTMENT' AND "appointment_id" IS NOT NULL)
        OR ("source_type" = 'WALK_IN' AND "appointment_id" IS NULL)
    ),
    CONSTRAINT "opd_queue_ticket_sequence_check" CHECK ("queue_sequence" > 0),
    CONSTRAINT "opd_queue_ticket_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_queue_ticket_tenant_uq"
    ON "opd_queue_ticket"("queue_ticket_id", "clinic_id", "branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_queue_ticket_appointment_uq"
    ON "opd_queue_ticket"("clinic_id", "branch_id", "appointment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_queue_ticket_daily_seq_uq"
    ON "opd_queue_ticket"("clinic_id", "branch_id", "business_date", "queue_sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_queue_ticket_display_no_uq"
    ON "opd_queue_ticket"("clinic_id", "branch_id", "business_date", "display_number");
CREATE INDEX IF NOT EXISTS "opd_queue_ticket_worklist_idx"
    ON "opd_queue_ticket"("clinic_id", "branch_id", "business_date", "current_step");
CREATE INDEX IF NOT EXISTS "opd_queue_ticket_customer_idx"
    ON "opd_queue_ticket"("clinic_id", "branch_id", "customer_id", "business_date");

CREATE TABLE IF NOT EXISTS "opd_number_sequence" (
    "number_sequence_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "number_kind" VARCHAR(30) NOT NULL,
    "period_key" VARCHAR(30) NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_number_sequence_pkey" PRIMARY KEY ("number_sequence_id"),
    CONSTRAINT "opd_number_sequence_value_check" CHECK ("next_value" > 0),
    CONSTRAINT "opd_number_sequence_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_number_sequence_scope_uq"
    ON "opd_number_sequence"("clinic_id", "branch_id", "number_kind", "period_key");

CREATE TABLE IF NOT EXISTS "opd_encounter" (
    "encounter_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "appointment_id" VARCHAR(50),
    "queue_ticket_id" UUID NOT NULL,
    "legacy_opd_id" VARCHAR(50),
    "attending_user_id" VARCHAR(50),
    "encounter_type" VARCHAR(20) NOT NULL,
    "workflow_status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "clinical_record_status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "reconciliation_status" VARCHAR(20) NOT NULL DEFAULT 'RECONCILED',
    "business_date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "started_by" VARCHAR(50) NOT NULL,
    "finalized_at" TIMESTAMPTZ(6),
    "finalized_by" VARCHAR(50),
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" VARCHAR(50),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(50),
    "close_reason" VARCHAR(500),
    "cancellation_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_encounter_pkey" PRIMARY KEY ("encounter_id"),
    CONSTRAINT "opd_encounter_queue_ticket_tenant_fkey" FOREIGN KEY
        ("queue_ticket_id", "clinic_id", "branch_id")
        REFERENCES "opd_queue_ticket"("queue_ticket_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_encounter_type_check" CHECK (
        "encounter_type" IN ('APPOINTMENT', 'WALK_IN', 'IMPORTED')
    ),
    CONSTRAINT "opd_encounter_type_appointment_check" CHECK (
        ("encounter_type" = 'APPOINTMENT' AND "appointment_id" IS NOT NULL)
        OR ("encounter_type" = 'WALK_IN' AND "appointment_id" IS NULL)
        OR "encounter_type" = 'IMPORTED'
    ),
    CONSTRAINT "opd_encounter_workflow_status_check" CHECK (
        "workflow_status" IN ('OPEN', 'POST_VISIT', 'CLOSED', 'CANCELLED')
    ),
    CONSTRAINT "opd_encounter_clinical_status_check" CHECK (
        "clinical_record_status" IN ('DRAFT', 'FINALIZED', 'AMENDED')
    ),
    CONSTRAINT "opd_encounter_reconciliation_status_check" CHECK (
        "reconciliation_status" IN ('RECONCILED', 'PENDING', 'QUARANTINED')
    ),
    CONSTRAINT "opd_encounter_legacy_opd_check" CHECK (
        "reconciliation_status" <> 'RECONCILED' OR "legacy_opd_id" IS NOT NULL
    ),
    CONSTRAINT "opd_encounter_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_encounter_tenant_uq"
    ON "opd_encounter"("encounter_id", "clinic_id", "branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_encounter_queue_ticket_uq"
    ON "opd_encounter"("queue_ticket_id", "clinic_id", "branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_encounter_legacy_opd_uq"
    ON "opd_encounter"("clinic_id", "branch_id", "legacy_opd_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_encounter_active_appointment_uq"
    ON "opd_encounter"("clinic_id", "branch_id", "appointment_id")
    WHERE "appointment_id" IS NOT NULL
      AND "workflow_status" IN ('OPEN', 'POST_VISIT');
CREATE INDEX IF NOT EXISTS "opd_encounter_worklist_idx"
    ON "opd_encounter"("clinic_id", "branch_id", "business_date", "workflow_status");
CREATE INDEX IF NOT EXISTS "opd_encounter_customer_idx"
    ON "opd_encounter"("clinic_id", "branch_id", "customer_id", "business_date");
CREATE INDEX IF NOT EXISTS "opd_encounter_appointment_idx"
    ON "opd_encounter"("clinic_id", "branch_id", "appointment_id");

CREATE TABLE IF NOT EXISTS "queue_transition" (
    "queue_transition_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "queue_ticket_id" UUID NOT NULL,
    "encounter_id" UUID,
    "appointment_id" VARCHAR(50),
    "from_step" VARCHAR(30) NOT NULL,
    "to_step" VARCHAR(30) NOT NULL,
    "actor_user_id" VARCHAR(50) NOT NULL,
    "reason" VARCHAR(500),
    "expected_version" INTEGER NOT NULL,
    "result_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_transition_pkey" PRIMARY KEY ("queue_transition_id"),
    CONSTRAINT "queue_transition_ticket_tenant_fkey" FOREIGN KEY
        ("queue_ticket_id", "clinic_id", "branch_id")
        REFERENCES "opd_queue_ticket"("queue_ticket_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "queue_transition_encounter_tenant_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "queue_transition_steps_check" CHECK ("from_step" <> "to_step"),
    CONSTRAINT "queue_transition_expected_version_check" CHECK ("expected_version" > 0),
    CONSTRAINT "queue_transition_result_version_check" CHECK (
        "result_version" = "expected_version" + 1
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "queue_transition_ticket_version_uq"
    ON "queue_transition"("clinic_id", "branch_id", "queue_ticket_id", "result_version");
CREATE INDEX IF NOT EXISTS "queue_transition_encounter_idx"
    ON "queue_transition"("clinic_id", "branch_id", "encounter_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "queue_transition_appointment_idx"
    ON "queue_transition"("clinic_id", "branch_id", "appointment_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "api_idempotency" (
    "api_idempotency_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "actor_user_id" VARCHAR(50) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    "locked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lock_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "resource_type" VARCHAR(50),
    "resource_id" VARCHAR(100),
    "result_snapshot" JSONB,
    "response_code" INTEGER,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_idempotency_pkey" PRIMARY KEY ("api_idempotency_id"),
    CONSTRAINT "api_idempotency_state_check" CHECK (
        "state" IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')
    ),
    CONSTRAINT "api_idempotency_lock_range_check" CHECK (
        "lock_expires_at" > "locked_at"
    ),
    CONSTRAINT "api_idempotency_expiry_range_check" CHECK (
        "expires_at" > "created_at"
    ),
    CONSTRAINT "api_idempotency_response_code_check" CHECK (
        "response_code" IS NULL OR "response_code" BETWEEN 100 AND 599
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "api_idempotency_scope_key_uq"
    ON "api_idempotency"("clinic_id", "branch_id", "actor_user_id", "operation", "idempotency_key");
CREATE INDEX IF NOT EXISTS "api_idempotency_lock_idx"
    ON "api_idempotency"("state", "lock_expires_at");
CREATE INDEX IF NOT EXISTS "api_idempotency_expiry_idx"
    ON "api_idempotency"("expires_at");
CREATE INDEX IF NOT EXISTS "api_idempotency_resource_idx"
    ON "api_idempotency"("clinic_id", "branch_id", "resource_type", "resource_id");

CREATE TABLE IF NOT EXISTS "opd_draft_checkpoint" (
    "draft_checkpoint_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "checkpoint_number" INTEGER NOT NULL,
    "resource_versions" JSONB NOT NULL,
    "actor_user_id" VARCHAR(50) NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_draft_checkpoint_pkey" PRIMARY KEY ("draft_checkpoint_id"),
    CONSTRAINT "opd_draft_checkpoint_encounter_tenant_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_draft_checkpoint_number_check" CHECK ("checkpoint_number" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_checkpoint_number_uq"
    ON "opd_draft_checkpoint"("clinic_id", "branch_id", "encounter_id", "checkpoint_number");
CREATE INDEX IF NOT EXISTS "opd_draft_checkpoint_created_idx"
    ON "opd_draft_checkpoint"("clinic_id", "branch_id", "encounter_id", "created_at");
