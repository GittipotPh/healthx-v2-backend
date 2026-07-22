-- Surgical, additive OPD V2 Phase 2G migration.
-- Creates only application-owned immutable draft snapshots and copy-forward
-- provenance. Legacy customer/clinic/branch/user identifiers remain scalar
-- strings with no database foreign keys or Prisma relations.

CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_checkpoint_identity_uq"
    ON "opd_draft_checkpoint"(
        "draft_checkpoint_id",
        "clinic_id",
        "branch_id",
        "encounter_id"
    );

CREATE TABLE IF NOT EXISTS "opd_draft_snapshot" (
    "draft_snapshot_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "source_encounter_id" UUID NOT NULL,
    "draft_checkpoint_id" UUID NOT NULL,
    "schema_version" VARCHAR(40) NOT NULL,
    "copyable_content" JSONB NOT NULL,
    "available_sections" JSONB NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "captured_by_user_id" VARCHAR(50) NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_draft_snapshot_pkey" PRIMARY KEY ("draft_snapshot_id"),
    CONSTRAINT "opd_draft_snapshot_encounter_tenant_fkey" FOREIGN KEY
        ("source_encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_draft_snapshot_checkpoint_identity_fkey" FOREIGN KEY
        (
            "draft_checkpoint_id",
            "clinic_id",
            "branch_id",
            "source_encounter_id"
        )
        REFERENCES "opd_draft_checkpoint"(
            "draft_checkpoint_id",
            "clinic_id",
            "branch_id",
            "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_draft_snapshot_schema_check" CHECK (
        "schema_version" = 'opd-draft-copy-v1'
    ),
    CONSTRAINT "opd_draft_snapshot_json_check" CHECK (
        JSONB_TYPEOF("copyable_content") = 'object'
        AND JSONB_TYPEOF("available_sections") = 'array'
        AND OCTET_LENGTH("copyable_content"::TEXT) <= 1100000
    ),
    CONSTRAINT "opd_draft_snapshot_hash_check" CHECK (
        "content_sha256" ~ '^[0-9a-f]{64}$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_snapshot_checkpoint_uq"
    ON "opd_draft_snapshot"("draft_checkpoint_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_snapshot_checkpoint_identity_uq"
    ON "opd_draft_snapshot"(
        "draft_checkpoint_id",
        "clinic_id",
        "branch_id",
        "source_encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_snapshot_identity_uq"
    ON "opd_draft_snapshot"(
        "draft_snapshot_id",
        "clinic_id",
        "branch_id",
        "customer_id"
    );
CREATE INDEX IF NOT EXISTS "opd_draft_snapshot_customer_captured_idx"
    ON "opd_draft_snapshot"(
        "clinic_id",
        "branch_id",
        "customer_id",
        "captured_at" DESC
    );
CREATE INDEX IF NOT EXISTS "opd_draft_snapshot_encounter_captured_idx"
    ON "opd_draft_snapshot"(
        "clinic_id",
        "branch_id",
        "source_encounter_id",
        "captured_at" DESC
    );

CREATE TABLE IF NOT EXISTS "opd_draft_import" (
    "draft_import_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "customer_id" VARCHAR(50) NOT NULL,
    "source_snapshot_id" UUID NOT NULL,
    "source_checkpoint_id" UUID NOT NULL,
    "source_encounter_id" UUID NOT NULL,
    "target_encounter_id" UUID NOT NULL,
    "selected_sections" JSONB NOT NULL,
    "source_content_sha256" CHAR(64) NOT NULL,
    "target_before_manifest" JSONB NOT NULL,
    "target_after_manifest" JSONB NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "imported_by_user_id" VARCHAR(50) NOT NULL,
    "imported_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_draft_import_pkey" PRIMARY KEY ("draft_import_id"),
    CONSTRAINT "opd_draft_import_source_snapshot_identity_fkey" FOREIGN KEY
        ("source_snapshot_id", "clinic_id", "branch_id", "customer_id")
        REFERENCES "opd_draft_snapshot"(
            "draft_snapshot_id",
            "clinic_id",
            "branch_id",
            "customer_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_draft_import_target_encounter_fkey" FOREIGN KEY
        ("target_encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_draft_import_source_target_check" CHECK (
        "source_encounter_id" <> "target_encounter_id"
    ),
    CONSTRAINT "opd_draft_import_json_check" CHECK (
        JSONB_TYPEOF("selected_sections") = 'array'
        AND JSONB_ARRAY_LENGTH("selected_sections") > 0
        AND JSONB_TYPEOF("target_before_manifest") = 'object'
        AND JSONB_TYPEOF("target_after_manifest") = 'object'
    ),
    CONSTRAINT "opd_draft_import_hash_check" CHECK (
        "source_content_sha256" ~ '^[0-9a-f]{64}$'
        AND "idempotency_key_hash" ~ '^[0-9a-f]{64}$'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_import_identity_uq"
    ON "opd_draft_import"(
        "draft_import_id",
        "clinic_id",
        "branch_id",
        "target_encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_import_target_uq"
    ON "opd_draft_import"(
        "target_encounter_id",
        "clinic_id",
        "branch_id"
    );
CREATE INDEX IF NOT EXISTS "opd_draft_import_source_idx"
    ON "opd_draft_import"(
        "clinic_id",
        "branch_id",
        "source_encounter_id",
        "imported_at" DESC
    );

CREATE TABLE IF NOT EXISTS "opd_draft_import_section" (
    "draft_import_section_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "draft_import_id" UUID NOT NULL,
    "target_encounter_id" UUID NOT NULL,
    "section_code" VARCHAR(40) NOT NULL,
    "source_section_sha256" CHAR(64) NOT NULL,
    "target_resource_type" VARCHAR(40) NOT NULL,
    "target_resource_id" UUID NOT NULL,
    "target_resource_version" INTEGER NOT NULL,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "reviewed_target_version" INTEGER,
    "reviewed_by_user_id" VARCHAR(50),
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_draft_import_section_pkey" PRIMARY KEY
        ("draft_import_section_id"),
    CONSTRAINT "opd_draft_import_section_import_identity_fkey" FOREIGN KEY
        (
            "draft_import_id",
            "clinic_id",
            "branch_id",
            "target_encounter_id"
        )
        REFERENCES "opd_draft_import"(
            "draft_import_id",
            "clinic_id",
            "branch_id",
            "target_encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_draft_import_section_code_check" CHECK (
        "section_code" IN (
            'SYMPTOMS',
            'INTAKE',
            'DIAGNOSES',
            'NOTE_CHIEF_COMPLAINT',
            'NOTE_PHYSICAL_EXAMINATION',
            'NOTE_DIAGNOSIS_NARRATIVE',
            'NOTE_TREATMENT',
            'NOTE_TREATMENT_PLAN',
            'NOTE_ADDITIONAL_NOTES',
            'NOTE_FREE_NOTE'
        )
    ),
    CONSTRAINT "opd_draft_import_section_resource_check" CHECK (
        "target_resource_type" IN (
            'OPD_SYMPTOM_SECTION',
            'OPD_INTAKE',
            'OPD_DIAGNOSIS_SECTION',
            'OPD_NOTE_SECTION'
        )
        AND "target_resource_version" > 0
    ),
    CONSTRAINT "opd_draft_import_section_hash_check" CHECK (
        "source_section_sha256" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "opd_draft_import_section_review_check" CHECK (
        (
            "review_status" = 'REVIEW_REQUIRED'
            AND "reviewed_target_version" IS NULL
            AND "reviewed_by_user_id" IS NULL
            AND "reviewed_at" IS NULL
        )
        OR (
            "review_status" = 'REVIEWED'
            AND "reviewed_target_version" > 0
            AND "reviewed_by_user_id" IS NOT NULL
            AND "reviewed_at" IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_import_section_identity_uq"
    ON "opd_draft_import_section"(
        "draft_import_section_id",
        "clinic_id",
        "branch_id",
        "target_encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_draft_import_section_code_uq"
    ON "opd_draft_import_section"("draft_import_id", "section_code");
CREATE INDEX IF NOT EXISTS "opd_draft_import_section_review_idx"
    ON "opd_draft_import_section"(
        "clinic_id",
        "branch_id",
        "target_encounter_id",
        "review_status"
    );
