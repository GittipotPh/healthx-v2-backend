CREATE TABLE IF NOT EXISTS appointment_detail_extra (
  appointment_id varchar(50) PRIMARY KEY,
  clinic_id varchar(50) NOT NULL,
  branch_id varchar(50) NOT NULL,
  campaign varchar(120),
  numbing_time integer,
  preparation text,
  internal_note text,
  created_by varchar(50),
  updated_at timestamp(6) NOT NULL,
  created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS appointment_detail_extra_clinic_branch_idx
  ON appointment_detail_extra(clinic_id, branch_id);
