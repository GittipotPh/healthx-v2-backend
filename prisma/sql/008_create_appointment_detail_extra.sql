CREATE TABLE IF NOT EXISTS appointment_detail_extra (
  appointment_id varchar(50) PRIMARY KEY,
  clinic_id varchar(50) NOT NULL,
  branch_id varchar(50) NOT NULL,
  marketing_platform varchar(120),
  campaign varchar(120),
  numbing_time integer,
  preparation text,
  preparation_tags jsonb,
  internal_note text,
  internal_tags jsonb,
  notifications jsonb,
  recurring jsonb,
  created_by varchar(50),
  updated_at timestamp(6) NOT NULL,
  created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE appointment_detail_extra
  ADD COLUMN IF NOT EXISTS marketing_platform varchar(120),
  ADD COLUMN IF NOT EXISTS preparation_tags jsonb,
  ADD COLUMN IF NOT EXISTS internal_tags jsonb,
  ADD COLUMN IF NOT EXISTS notifications jsonb,
  ADD COLUMN IF NOT EXISTS recurring jsonb;

CREATE INDEX IF NOT EXISTS appointment_detail_extra_clinic_branch_idx
  ON appointment_detail_extra(clinic_id, branch_id);
