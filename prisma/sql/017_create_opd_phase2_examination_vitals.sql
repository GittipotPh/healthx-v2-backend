-- Surgical, additive OPD V2 Phase 2A migration.
-- Creates ONLY app-owned examination and vital-observation tables. All legacy
-- HealthX customer/user references remain scalar VARCHAR values with no FK.
-- Every database FK below connects app-owned OPD tables and carries tenant
-- scope so a child cannot be attached across clinic/branch boundaries.

CREATE TABLE IF NOT EXISTS "opd_examination" (
    "examination_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "examination_number" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "recorder_user_id" VARCHAR(50) NOT NULL,
    "examiner_user_id" VARCHAR(50),
    "finalized_at" TIMESTAMPTZ(6),
    "finalized_by" VARCHAR(50),
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" VARCHAR(50),
    "void_reason" VARCHAR(500),
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_examination_pkey" PRIMARY KEY ("examination_id"),
    CONSTRAINT "opd_examination_encounter_tenant_fkey" FOREIGN KEY
        ("encounter_id", "clinic_id", "branch_id")
        REFERENCES "opd_encounter"("encounter_id", "clinic_id", "branch_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_examination_number_check" CHECK ("examination_number" > 0),
    CONSTRAINT "opd_examination_status_check" CHECK (
        "status" IN ('DRAFT', 'FINAL', 'CORRECTED', 'VOID')
    ),
    CONSTRAINT "opd_examination_version_check" CHECK ("version" > 0),
    CONSTRAINT "opd_examination_final_state_check" CHECK (
        ("status" IN ('FINAL', 'CORRECTED') AND "finalized_at" IS NOT NULL AND "finalized_by" IS NOT NULL)
        OR ("status" NOT IN ('FINAL', 'CORRECTED') AND "finalized_at" IS NULL AND "finalized_by" IS NULL)
    ),
    CONSTRAINT "opd_examination_void_state_check" CHECK (
        ("status" = 'VOID' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)
        OR ("status" <> 'VOID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_examination_tenant_uq"
    ON "opd_examination"("examination_id", "clinic_id", "branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_examination_identity_uq"
    ON "opd_examination"("examination_id", "clinic_id", "branch_id", "encounter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_examination_number_uq"
    ON "opd_examination"("clinic_id", "branch_id", "encounter_id", "examination_number");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_examination_active_draft_uq"
    ON "opd_examination"("clinic_id", "branch_id", "encounter_id")
    WHERE "status" = 'DRAFT';
CREATE INDEX IF NOT EXISTS "opd_examination_encounter_idx"
    ON "opd_examination"("clinic_id", "branch_id", "encounter_id", "status", "examination_number");

CREATE TABLE IF NOT EXISTS "opd_vital_observation" (
    "vital_observation_id" UUID NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "encounter_id" UUID NOT NULL,
    "examination_id" UUID NOT NULL,
    "weight_kg" DECIMAL(7,2),
    "height_cm" DECIMAL(7,2),
    "body_mass_index" DECIMAL(5,2),
    "systolic_blood_pressure_mmhg" INTEGER,
    "diastolic_blood_pressure_mmhg" INTEGER,
    "pulse_rate_per_minute" INTEGER,
    "temperature_celsius" DECIMAL(4,1),
    "oxygen_saturation_percent" DECIMAL(5,2),
    "respiratory_rate_per_minute" INTEGER,
    "dtx_mg_dl" DECIMAL(7,2),
    "pain_score" INTEGER,
    "reference_rule_version" VARCHAR(50),
    "interpretation_snapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(50) NOT NULL,
    "updated_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opd_vital_observation_pkey" PRIMARY KEY ("vital_observation_id"),
    CONSTRAINT "opd_vital_observation_examination_identity_fkey" FOREIGN KEY
        ("examination_id", "clinic_id", "branch_id", "encounter_id")
        REFERENCES "opd_examination"("examination_id", "clinic_id", "branch_id", "encounter_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "opd_vital_observation_version_check" CHECK ("version" > 0),
    CONSTRAINT "opd_vital_observation_weight_check" CHECK ("weight_kg" IS NULL OR "weight_kg" >= 0),
    CONSTRAINT "opd_vital_observation_height_check" CHECK ("height_cm" IS NULL OR "height_cm" >= 0),
    CONSTRAINT "opd_vital_observation_bmi_check" CHECK ("body_mass_index" IS NULL OR "body_mass_index" >= 0),
    CONSTRAINT "opd_vital_observation_systolic_check" CHECK ("systolic_blood_pressure_mmhg" IS NULL OR "systolic_blood_pressure_mmhg" >= 0),
    CONSTRAINT "opd_vital_observation_diastolic_check" CHECK ("diastolic_blood_pressure_mmhg" IS NULL OR "diastolic_blood_pressure_mmhg" >= 0),
    CONSTRAINT "opd_vital_observation_pulse_check" CHECK ("pulse_rate_per_minute" IS NULL OR "pulse_rate_per_minute" >= 0),
    CONSTRAINT "opd_vital_observation_temperature_check" CHECK ("temperature_celsius" IS NULL OR "temperature_celsius" >= 0),
    CONSTRAINT "opd_vital_observation_oxygen_check" CHECK ("oxygen_saturation_percent" IS NULL OR ("oxygen_saturation_percent" >= 0 AND "oxygen_saturation_percent" <= 100)),
    CONSTRAINT "opd_vital_observation_respiratory_check" CHECK ("respiratory_rate_per_minute" IS NULL OR "respiratory_rate_per_minute" >= 0),
    CONSTRAINT "opd_vital_observation_dtx_check" CHECK ("dtx_mg_dl" IS NULL OR "dtx_mg_dl" >= 0),
    CONSTRAINT "opd_vital_observation_pain_check" CHECK ("pain_score" IS NULL OR "pain_score" BETWEEN 0 AND 10)
);

CREATE UNIQUE INDEX IF NOT EXISTS "opd_vital_observation_examination_uq"
    ON "opd_vital_observation"("examination_id", "clinic_id", "branch_id");
CREATE UNIQUE INDEX IF NOT EXISTS "opd_vital_observation_identity_uq"
    ON "opd_vital_observation"("examination_id", "clinic_id", "branch_id", "encounter_id");
CREATE INDEX IF NOT EXISTS "opd_vital_observation_encounter_idx"
    ON "opd_vital_observation"("clinic_id", "branch_id", "encounter_id", "examination_id");
