CREATE TABLE IF NOT EXISTS ref_appointment_option (
  option_id varchar(80) PRIMARY KEY,
  clinic_id varchar(50),
  branch_id varchar(50),
  type varchar(50) NOT NULL,
  code varchar(100) NOT NULL,
  label_th varchar(200) NOT NULL,
  label_en varchar(200),
  sort_order integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb,
  created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS ref_appointment_option_scope_idx
  ON ref_appointment_option(clinic_id, branch_id);

CREATE INDEX IF NOT EXISTS ref_appointment_option_type_active_sort_idx
  ON ref_appointment_option(type, is_active, sort_order);

DELETE FROM ref_appointment_option
WHERE option_id IN (
  'GLOBAL-MARKETING_CAMPAIGN-BIRTHDAY',
  'GLOBAL-MARKETING_CAMPAIGN-NEW_YEAR'
)
AND clinic_id IS NULL
AND branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ref_appointment_option_global_type_code_uniq
  ON ref_appointment_option(type, code)
  WHERE clinic_id IS NULL AND branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ref_appointment_option_clinic_type_code_uniq
  ON ref_appointment_option(clinic_id, type, code)
  WHERE clinic_id IS NOT NULL AND branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ref_appointment_option_branch_type_code_uniq
  ON ref_appointment_option(clinic_id, branch_id, type, code)
  WHERE branch_id IS NOT NULL;

INSERT INTO ref_appointment_option
  (option_id, type, code, label_th, label_en, sort_order, metadata, updated_at)
VALUES
  ('GLOBAL-CONSULT_TYPE-CONSULT', 'CONSULT_TYPE', 'consult', 'Consult', 'Consult', 10, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-CONSULT_TYPE-PROCEDURE', 'CONSULT_TYPE', 'procedure', 'Procedure', 'Procedure', 20, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-CONSULT_TYPE-FOLLOW_UP', 'CONSULT_TYPE', 'follow-up', 'Follow-up', 'Follow-up', 30, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_PLATFORM-FACEBOOK', 'MARKETING_PLATFORM', 'facebook', 'Facebook', 'Facebook', 10, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_PLATFORM-LINE', 'MARKETING_PLATFORM', 'line', 'LINE', 'LINE', 20, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_PLATFORM-GOOGLE_ADS', 'MARKETING_PLATFORM', 'google-ads', 'Google Ads', 'Google Ads', 30, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_PLATFORM-WALK_IN', 'MARKETING_PLATFORM', 'walk-in', 'Walk-in', 'Walk-in', 40, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_PLATFORM-INSTAGRAM', 'MARKETING_PLATFORM', 'instagram', 'Instagram', 'Instagram', 50, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_CAMPAIGN-BIRTHDAY_PROMOTION', 'MARKETING_CAMPAIGN', 'birthday-promotion', 'Birthday Promotion', 'Birthday Promotion', 10, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_CAMPAIGN-MEMBER_SPECIAL', 'MARKETING_CAMPAIGN', 'member-special', 'Member Special', 'Member Special', 20, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_CAMPAIGN-FLASH_SALE', 'MARKETING_CAMPAIGN', 'flash-sale', 'Flash Sale', 'Flash Sale', 30, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-MARKETING_CAMPAIGN-NEW_YEAR_CAMPAIGN', 'MARKETING_CAMPAIGN', 'new-year-campaign', 'New Year Campaign', 'New Year Campaign', 40, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-PREPARATION_TAG-NO_VITAMINS', 'PREPARATION_TAG', 'no-vitamins', 'No vitamins', 'No vitamins', 10, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-PREPARATION_TAG-NO_ALCOHOL', 'PREPARATION_TAG', 'no-alcohol', 'No alcohol', 'No alcohol', 20, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-PREPARATION_TAG-FASTING', 'PREPARATION_TAG', 'fasting', 'Fasting', 'Fasting', 30, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-PREPARATION_TAG-WASH_FACE', 'PREPARATION_TAG', 'wash-face', 'Wash face', 'Wash face', 40, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-PREPARATION_TAG-NUMBING_CREAM', 'PREPARATION_TAG', 'numbing-cream', 'Numbing cream', 'Numbing cream', 50, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-INTERNAL_TAG-LASER_ZONE', 'INTERNAL_TAG', 'laser-zone', 'Laser zone', 'Laser zone', 10, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-INTERNAL_TAG-VIP', 'INTERNAL_TAG', 'vip', 'VIP patient', 'VIP patient', 20, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-INTERNAL_TAG-SPECIAL_CARE', 'INTERNAL_TAG', 'special-care', 'Special care', 'Special care', 30, NULL, CURRENT_TIMESTAMP),
  ('GLOBAL-NUMBING_DURATION-30', 'NUMBING_DURATION', '30', '30 minutes', '30 minutes', 10, '{"minutes":30}', CURRENT_TIMESTAMP),
  ('GLOBAL-NUMBING_DURATION-45', 'NUMBING_DURATION', '45', '45 minutes', '45 minutes', 20, '{"minutes":45}', CURRENT_TIMESTAMP),
  ('GLOBAL-NUMBING_DURATION-60', 'NUMBING_DURATION', '60', '60 minutes', '60 minutes', 30, '{"minutes":60}', CURRENT_TIMESTAMP)
ON CONFLICT (option_id) DO UPDATE SET
  label_th = EXCLUDED.label_th,
  label_en = EXCLUDED.label_en,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  metadata = EXCLUDED.metadata,
  updated_at = CURRENT_TIMESTAMP;
