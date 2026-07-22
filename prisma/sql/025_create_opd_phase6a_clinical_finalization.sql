-- Surgical, additive OPD V2 Phase 6A migration.
-- Creates immutable application-owned clinical-finalization evidence and adds
-- the sensitive OPD_FINALIZE permission catalog entry without granting it to
-- any default role. No legacy HealthX table is altered.

CREATE TABLE IF NOT EXISTS "opd_clinical_finalization" (
    "clinical_finalization_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "source_encounter_version" INTEGER NOT NULL,
    "result_encounter_version" INTEGER NOT NULL,
    "queue_ticket_id" UUID NOT NULL,
    "source_queue_ticket_version" INTEGER NOT NULL,
    "result_queue_ticket_version" INTEGER NOT NULL,
    "source_queue_step" VARCHAR(30) NOT NULL,
    "result_queue_step" VARCHAR(30) NOT NULL,
    "manifest_schema" VARCHAR(50) NOT NULL,
    "resource_manifest" JSONB NOT NULL,
    "manifest_hash" CHAR(64) NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "finalized_by" VARCHAR(50) NOT NULL,
    "finalized_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_clinical_finalization_pkey" PRIMARY KEY
        ("clinical_finalization_id"),
    CONSTRAINT "opd_clinical_finalization_encounter_tenant_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_clinical_finalization_ticket_tenant_fkey" FOREIGN KEY
        ("queue_ticket_id", "clinic_id", "branch_id")
        REFERENCES "opd_queue_ticket"(
            "queue_ticket_id",
            "clinic_id",
            "branch_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_clinical_finalization_encounter_version_check" CHECK (
        "source_encounter_version" > 0
        AND "result_encounter_version" = "source_encounter_version" + 1
    ),
    CONSTRAINT "opd_clinical_finalization_queue_version_check" CHECK (
        "source_queue_ticket_version" > 0
        AND "result_queue_ticket_version" = "source_queue_ticket_version" + 1
    ),
    CONSTRAINT "opd_clinical_finalization_transition_check" CHECK (
        "source_queue_step" = 'IN_SERVICE'
        AND "result_queue_step" = 'DISPENSING'
    ),
    CONSTRAINT "opd_clinical_finalization_manifest_check" CHECK (
        "manifest_schema" = 'opd-clinical-finalization-v1'
        AND JSONB_TYPEOF("resource_manifest") = 'object'
    ),
    CONSTRAINT "opd_clinical_finalization_hash_check" CHECK (
        "manifest_hash" ~ '^[0-9a-f]{64}$'
        AND "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_clinical_finalization_identity_uq"
    ON "opd_clinical_finalization"(
        "clinical_finalization_id",
        "clinic_id",
        "branch_id",
        "encounter_id",
        "queue_ticket_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_clinical_finalization_encounter_uq"
    ON "opd_clinical_finalization"(
        "encounter_id",
        "clinic_id",
        "branch_id"
    );
CREATE INDEX IF NOT EXISTS "opd_clinical_finalization_actor_time_idx"
    ON "opd_clinical_finalization"(
        "clinic_id",
        "branch_id",
        "finalized_by",
        "finalized_at" DESC
    );

INSERT INTO "permission" (
    "permission_id",
    "name_TH",
    "name_EN",
    "created_at",
    "updated_at",
    "group_name_TH",
    "group_name_EN",
    "sequence"
)
VALUES (
    'OPD_FINALIZE',
    'ยืนยันและสิ้นสุดการบันทึกทางคลินิก OPD',
    'Finalize OPD clinical record',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'OPD',
    'OPD',
    12
)
ON CONFLICT ("permission_id") DO NOTHING;
