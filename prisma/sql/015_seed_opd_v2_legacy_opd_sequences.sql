-- OPD V2 Phase 1 legacy-OPD number allocator bootstrap.
--
-- The compatibility ID format is OPDV2-YYYYMMDD-NNNNNN. OPDV2 is reserved to
-- this application, and the numeric suffix may grow beyond six digits up to
-- JavaScript's safe integer limit. Read any pre-existing IDs in that namespace and
-- advance only the app-owned allocator to one past the scoped maximum. No
-- legacy OPD row is modified. The lock prevents a concurrent OPD start from
-- allocating from a stale sequence while this bootstrap runs.

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE "opd_number_sequence" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "opd"
        WHERE "opd_id" ~ '^OPDV2-[0-9]{8}-[0-9]{6,}$'
          AND SUBSTRING("opd_id" FROM 16)::NUMERIC >= 9007199254740991
    ) THEN
        RAISE EXCEPTION
            'OPD V2 legacy OPD number suffix exceeds the safe allocator range';
    END IF;
END
$$;

WITH "required" AS (
    SELECT
        "clinic_id",
        "branch_id",
        SUBSTRING("opd_id" FROM 7 FOR 8) AS "period_key",
        MAX(SUBSTRING("opd_id" FROM 16)::BIGINT) + 1 AS "next_value"
    FROM "opd"
    WHERE "opd_id" ~ '^OPDV2-[0-9]{8}-[0-9]{6,16}$'
      AND SUBSTRING("opd_id" FROM 16)::NUMERIC < 9007199254740991
    GROUP BY
        "clinic_id",
        "branch_id",
        SUBSTRING("opd_id" FROM 7 FOR 8)
)
INSERT INTO "opd_number_sequence" (
    "number_sequence_id",
    "clinic_id",
    "branch_id",
    "number_kind",
    "period_key",
    "next_value",
    "version",
    "created_at",
    "updated_at"
)
SELECT
    (
        SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "required"."clinic_id" || ':'
            || "required"."branch_id" || ':'
            || 'LEGACY_OPD:'
            || "required"."period_key"
        ), 1, 8) || '-'
        || SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "required"."clinic_id" || ':'
            || "required"."branch_id" || ':'
            || 'LEGACY_OPD:'
            || "required"."period_key"
        ), 9, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "required"."clinic_id" || ':'
            || "required"."branch_id" || ':'
            || 'LEGACY_OPD:'
            || "required"."period_key"
        ), 13, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "required"."clinic_id" || ':'
            || "required"."branch_id" || ':'
            || 'LEGACY_OPD:'
            || "required"."period_key"
        ), 17, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "required"."clinic_id" || ':'
            || "required"."branch_id" || ':'
            || 'LEGACY_OPD:'
            || "required"."period_key"
        ), 21, 12)
    )::UUID,
    "required"."clinic_id",
    "required"."branch_id",
    'LEGACY_OPD',
    "required"."period_key",
    "required"."next_value",
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "required"
ON CONFLICT ("clinic_id", "branch_id", "number_kind", "period_key")
DO UPDATE SET
    "next_value" = GREATEST(
        "opd_number_sequence"."next_value",
        EXCLUDED."next_value"
    ),
    "version" = CASE
        WHEN "opd_number_sequence"."next_value" < EXCLUDED."next_value"
        THEN "opd_number_sequence"."version" + 1
        ELSE "opd_number_sequence"."version"
    END,
    "updated_at" = CASE
        WHEN "opd_number_sequence"."next_value" < EXCLUDED."next_value"
        THEN CURRENT_TIMESTAMP
        ELSE "opd_number_sequence"."updated_at"
    END;

COMMIT;
