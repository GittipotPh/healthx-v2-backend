-- Surgical migration: the "ส่งปรึกษา" consult detail record. Creates ONLY the
-- new app-owned appointment_consultation table. String refs to HealthX rows
-- (appointment_id/clinic_id/branch_id) — no FK. Idempotent.

CREATE TABLE IF NOT EXISTS "appointment_consultation" (
    "consultation_id"     UUID          NOT NULL,
    "clinic_id"           VARCHAR(50)   NOT NULL,
    "branch_id"           VARCHAR(50)   NOT NULL,
    "appointment_id"      VARCHAR(50)   NOT NULL,
    "consultant_ref"      VARCHAR(100),
    "budget"              DECIMAL(10,2),
    "promotion"           VARCHAR(200),
    "outcome"             VARCHAR(30)   NOT NULL,
    "services_interested" JSONB,
    "notes"               TEXT,
    "created_by"          VARCHAR(50),
    "updated_at"          TIMESTAMP(6)  NOT NULL,
    "created_at"          TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_consultation_pkey" PRIMARY KEY ("consultation_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "appointment_consultation_appointment_id_key"
    ON "appointment_consultation"("appointment_id");
CREATE INDEX IF NOT EXISTS "appointment_consultation_clinic_id_branch_id_idx"
    ON "appointment_consultation"("clinic_id", "branch_id");
