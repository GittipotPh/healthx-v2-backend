CREATE TABLE IF NOT EXISTS customer_note (
  note_id varchar(50) PRIMARY KEY,
  clinic_id varchar(50) NOT NULL,
  branch_id varchar(50) NOT NULL,
  customer_id varchar(50) NOT NULL,
  content text NOT NULL,
  status record_status NOT NULL DEFAULT 'ACTIVE',
  created_by varchar(50) NOT NULL,
  updated_by varchar(50),
  created_at timestamp(6) NOT NULL,
  updated_at timestamp(6) NOT NULL,
  CONSTRAINT customer_note_customer_fk
    FOREIGN KEY (customer_id, clinic_id)
    REFERENCES customer(customer_id, clinic_id),
  CONSTRAINT customer_note_created_by_fk
    FOREIGN KEY (created_by)
    REFERENCES "user"(user_id),
  CONSTRAINT customer_note_updated_by_fk
    FOREIGN KEY (updated_by)
    REFERENCES "user"(user_id)
);

CREATE INDEX IF NOT EXISTS customer_note_customer_clinic_idx
  ON customer_note(customer_id, clinic_id);

CREATE INDEX IF NOT EXISTS customer_note_clinic_branch_idx
  ON customer_note(clinic_id, branch_id);

CREATE INDEX IF NOT EXISTS customer_note_created_at_idx
  ON customer_note(created_at);

CREATE TABLE IF NOT EXISTS customer_file (
  file_id varchar(50) PRIMARY KEY,
  clinic_id varchar(50) NOT NULL,
  branch_id varchar(50) NOT NULL,
  customer_id varchar(50) NOT NULL,
  display_name varchar(255) NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  file_size integer NOT NULL,
  storage_provider varchar(30) NOT NULL,
  bucket_name varchar(100) NOT NULL,
  object_key text NOT NULL,
  public_url text,
  status record_status NOT NULL DEFAULT 'ACTIVE',
  uploaded_by varchar(50) NOT NULL,
  created_at timestamp(6) NOT NULL,
  updated_at timestamp(6) NOT NULL,
  CONSTRAINT customer_file_customer_fk
    FOREIGN KEY (customer_id, clinic_id)
    REFERENCES customer(customer_id, clinic_id),
  CONSTRAINT customer_file_uploaded_by_fk
    FOREIGN KEY (uploaded_by)
    REFERENCES "user"(user_id)
);

CREATE INDEX IF NOT EXISTS customer_file_customer_clinic_idx
  ON customer_file(customer_id, clinic_id);

CREATE INDEX IF NOT EXISTS customer_file_clinic_branch_idx
  ON customer_file(clinic_id, branch_id);

CREATE INDEX IF NOT EXISTS customer_file_created_at_idx
  ON customer_file(created_at);

CREATE INDEX IF NOT EXISTS customer_file_object_key_idx
  ON customer_file(object_key);
