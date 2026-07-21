-- Surgical, additive OPD V2 Phase 2B migration.
-- Creates ONLY app-owned symptom and diagnosis resources. All database foreign
-- keys connect app-owned OPD tables and carry tenant/encounter identity.

CREATE TABLE IF NOT EXISTS "opd_symptom_section" (
    "symptom_section_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "examination_id" UUID NOT NULL,
    "patient_quote" VARCHAR(4000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_symptom_section_pkey" PRIMARY KEY ("symptom_section_id"),
    CONSTRAINT "opd_symptom_section_examination_identity_fkey" FOREIGN KEY
        ("examination_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_examination"("examination_id", "clinic_id", "branch_id", "encounter_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_symptom_section_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_symptom_section_identity_uq"
    ON "opd_symptom_section"("symptom_section_id", "clinic_id", "branch_id", "encounter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_symptom_section_examination_uq"
    ON "opd_symptom_section"("examination_id", "clinic_id", "branch_id", "encounter_id");
CREATE INDEX IF NOT EXISTS "opd_symptom_section_encounter_idx"
    ON "opd_symptom_section"("clinic_id", "branch_id", "encounter_id", "examination_id");

CREATE TABLE IF NOT EXISTS "opd_symptom" (
    "symptom_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "symptom_section_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL,
    "main_code" VARCHAR(50),
    "main_text" VARCHAR(300) NOT NULL,
    "duration_value" DECIMAL(10,2),
    "duration_unit" VARCHAR(30),
    "location" VARCHAR(200),
    "laterality" VARCHAR(20),
    "severity" INTEGER,
    "character" VARCHAR(200),
    "modifying_factors" VARCHAR(1000),
    "staff_summary" VARCHAR(4000),
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_symptom_pkey" PRIMARY KEY ("symptom_id"),
    CONSTRAINT "opd_symptom_section_identity_fkey" FOREIGN KEY
        ("symptom_section_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_symptom_section"("symptom_section_id", "clinic_id", "branch_id", "encounter_id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "opd_symptom_order_check" CHECK ("display_order" > 0),
    CONSTRAINT "opd_symptom_main_text_check" CHECK (BTRIM("main_text") <> ''),
    CONSTRAINT "opd_symptom_duration_check" CHECK ("duration_value" IS NULL OR "duration_value" >= 0),
    CONSTRAINT "opd_symptom_severity_check" CHECK ("severity" IS NULL OR "severity" BETWEEN 0 AND 10),
    CONSTRAINT "opd_symptom_laterality_check" CHECK (
        "laterality" IS NULL OR "laterality" IN ('UNSPECIFIED', 'LEFT', 'RIGHT', 'BILATERAL', 'MIDLINE')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_symptom_identity_uq"
    ON "opd_symptom"("symptom_id", "clinic_id", "branch_id", "encounter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_symptom_order_uq"
    ON "opd_symptom"("symptom_section_id", "display_order");
CREATE INDEX IF NOT EXISTS "opd_symptom_section_idx"
    ON "opd_symptom"("clinic_id", "branch_id", "encounter_id", "symptom_section_id");

CREATE TABLE IF NOT EXISTS "opd_symptom_association" (
    "symptom_association_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "symptom_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL,
    "code" VARCHAR(50),
    "label" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_symptom_association_pkey" PRIMARY KEY ("symptom_association_id"),
    CONSTRAINT "opd_symptom_association_symptom_identity_fkey" FOREIGN KEY
        ("symptom_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_symptom"("symptom_id", "clinic_id", "branch_id", "encounter_id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "opd_symptom_association_order_check" CHECK ("display_order" > 0),
    CONSTRAINT "opd_symptom_association_label_check" CHECK (BTRIM("label") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_symptom_association_order_uq"
    ON "opd_symptom_association"("symptom_id", "display_order");
CREATE INDEX IF NOT EXISTS "opd_symptom_association_symptom_idx"
    ON "opd_symptom_association"("clinic_id", "branch_id", "encounter_id", "symptom_id");

CREATE TABLE IF NOT EXISTS "opd_diagnosis_section" (
    "diagnosis_section_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_diagnosis_section_pkey" PRIMARY KEY ("diagnosis_section_id"),
    CONSTRAINT "opd_diagnosis_section_encounter_tenant_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_diagnosis_section_status_check" CHECK (
        "status" IN ('DRAFT', 'FINAL', 'CORRECTED', 'VOID')
    ),
    CONSTRAINT "opd_diagnosis_section_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_diagnosis_section_identity_uq"
    ON "opd_diagnosis_section"("diagnosis_section_id", "clinic_id", "branch_id", "encounter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_diagnosis_section_encounter_uq"
    ON "opd_diagnosis_section"("encounter_id", "clinic_id", "branch_id");
CREATE INDEX IF NOT EXISTS "opd_diagnosis_section_encounter_idx"
    ON "opd_diagnosis_section"("clinic_id", "branch_id", "encounter_id", "status");

CREATE TABLE IF NOT EXISTS "opd_diagnosis" (
    "diagnosis_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "diagnosis_section_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL,
    "code_system" VARCHAR(30) NOT NULL DEFAULT 'ICD-10',
    "code_edition" VARCHAR(30),
    "code" VARCHAR(30),
    "label" VARCHAR(300) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,
    "onset_text" VARCHAR(200),
    "note" VARCHAR(2000),
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_diagnosis_pkey" PRIMARY KEY ("diagnosis_id"),
    CONSTRAINT "opd_diagnosis_section_identity_fkey" FOREIGN KEY
        ("diagnosis_section_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_diagnosis_section"("diagnosis_section_id", "clinic_id", "branch_id", "encounter_id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "opd_diagnosis_order_check" CHECK ("display_order" > 0),
    CONSTRAINT "opd_diagnosis_code_system_check" CHECK (BTRIM("code_system") <> ''),
    CONSTRAINT "opd_diagnosis_label_check" CHECK (BTRIM("label") <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_diagnosis_order_uq"
    ON "opd_diagnosis"("diagnosis_section_id", "display_order");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_diagnosis_primary_uq"
    ON "opd_diagnosis"("diagnosis_section_id")
    WHERE "is_primary" = TRUE;
CREATE INDEX IF NOT EXISTS "opd_diagnosis_section_idx"
    ON "opd_diagnosis"("clinic_id", "branch_id", "encounter_id", "diagnosis_section_id");
