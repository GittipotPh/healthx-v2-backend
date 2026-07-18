-- OPD V2 Phase 1 least-privilege role defaults.
--
-- The routed worklist explicitly supports Doctor and Nurse workflows. Grant
-- only the three permissions required by the Phase 1 surface. A branch-level
-- user_permission true/false remains the authoritative per-user override in
-- PermissionsGuard, so an explicit deny still wins over these defaults.

INSERT INTO "default_permission" (
    "role_id",
    "permission_id",
    "created_at",
    "updated_at"
)
SELECT
    "role"."role_id",
    "permission"."permission_id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "role"
CROSS JOIN "permission"
WHERE "role"."role_id" IN ('DOCTOR'::"role_enum", 'NURSE'::"role_enum")
  AND "permission"."permission_id" IN ('OPD_READ', 'OPD_CREATE', 'OPD_EDIT')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                ('DOCTOR'::"role_enum", 'OPD_READ'),
                ('DOCTOR'::"role_enum", 'OPD_CREATE'),
                ('DOCTOR'::"role_enum", 'OPD_EDIT'),
                ('NURSE'::"role_enum", 'OPD_READ'),
                ('NURSE'::"role_enum", 'OPD_CREATE'),
                ('NURSE'::"role_enum", 'OPD_EDIT')
        ) AS "required" ("role_id", "permission_id")
        LEFT JOIN "default_permission" AS "granted"
          ON "granted"."role_id" = "required"."role_id"
         AND "granted"."permission_id" = "required"."permission_id"
        WHERE "granted"."permission_id" IS NULL
    ) THEN
        RAISE EXCEPTION
            'OPD V2 Phase 1 role grant failed: required role or permission catalog row is missing';
    END IF;
END
$$;
