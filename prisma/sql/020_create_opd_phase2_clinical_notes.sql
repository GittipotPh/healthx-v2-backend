-- Surgical, additive OPD V2 Phase 2E migration.
-- Creates ONLY app-owned clinical-note resources. Every database foreign key
-- connects app-owned OPD tables and carries clinic/branch/encounter identity.

CREATE TABLE IF NOT EXISTS "opd_note_workspace" (
    "note_workspace_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "selected_mode" VARCHAR(10) NOT NULL DEFAULT 'FORM',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_note_workspace_pkey" PRIMARY KEY ("note_workspace_id"),
    CONSTRAINT "opd_note_workspace_encounter_tenant_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_note_workspace_mode_check" CHECK (
        "selected_mode" IN ('FORM', 'FREE')
    ),
    CONSTRAINT "opd_note_workspace_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_note_workspace_identity_uq"
    ON "opd_note_workspace"(
        "note_workspace_id",
        "clinic_id",
        "branch_id",
        "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_note_workspace_encounter_uq"
    ON "opd_note_workspace"("encounter_id", "clinic_id", "branch_id");
CREATE INDEX IF NOT EXISTS "opd_note_workspace_scope_idx"
    ON "opd_note_workspace"("clinic_id", "branch_id", "encounter_id");

CREATE TABLE IF NOT EXISTS "opd_note_section" (
    "note_section_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "note_workspace_id" UUID NOT NULL,
    "section_code" VARCHAR(40) NOT NULL,
    "content_schema" VARCHAR(40) NOT NULL DEFAULT 'clinical-rich-text-v1',
    "rich_content" JSONB NOT NULL,
    "plain_text" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_note_section_pkey" PRIMARY KEY ("note_section_id"),
    CONSTRAINT "opd_note_section_workspace_identity_fkey" FOREIGN KEY
        ("note_workspace_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_note_workspace"(
            "note_workspace_id",
            "clinic_id",
            "branch_id",
            "encounter_id"
        )
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_note_section_code_check" CHECK (
        "section_code" IN (
            'CHIEF_COMPLAINT',
            'PHYSICAL_EXAMINATION',
            'DIAGNOSIS_NARRATIVE',
            'TREATMENT',
            'TREATMENT_PLAN',
            'ADDITIONAL_NOTES',
            'FREE_NOTE'
        )
    ),
    CONSTRAINT "opd_note_section_schema_check" CHECK (
        "content_schema" = 'clinical-rich-text-v1'
        AND JSONB_TYPEOF("rich_content") = 'object'
        AND "rich_content" ->> 'schema' = "content_schema"
    ),
    CONSTRAINT "opd_note_section_status_check" CHECK (
        "status" IN ('DRAFT', 'FINAL', 'CORRECTED', 'VOID')
    ),
    CONSTRAINT "opd_note_section_version_check" CHECK ("version" > 0),
    CONSTRAINT "opd_note_section_plain_text_size_check" CHECK (
        CHAR_LENGTH("plain_text") <= 50000
    ),
    CONSTRAINT "opd_note_section_rich_content_size_check" CHECK (
        -- Service contract is 128 KiB canonical JSON. JSONB text rendering may
        -- add whitespace, so this DB defense allows bounded serialization overhead.
        OCTET_LENGTH("rich_content"::TEXT) <= 196608
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_note_section_identity_uq"
    ON "opd_note_section"(
        "note_section_id",
        "clinic_id",
        "branch_id",
        "encounter_id"
    );
CREATE UNIQUE INDEX IF NOT EXISTS "opd_note_section_workspace_code_uq"
    ON "opd_note_section"("note_workspace_id", "section_code");
CREATE INDEX IF NOT EXISTS "opd_note_section_encounter_idx"
    ON "opd_note_section"(
        "clinic_id",
        "branch_id",
        "encounter_id",
        "section_code",
        "status"
    );
