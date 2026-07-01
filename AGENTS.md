# AGENTS.md — HealthX Clinic Operations Backend

## Project Context

This is the backend for the HealthX **clinic-operations** app (frontend in
`../frontend`). It is a NestJS application serving five features — Today's Queue
(คิววันนี้), OPD, Appointments (นัดหมาย), Customers (ลูกค้า), and Audit Log.

Business logic mirrors the legacy HealthX API (`../ref_api_old_healthx`, compiled
`dist` only). The app runs against the existing HealthX `public` PostgreSQL schema
and adds exactly one new table, `audit_log`.

## Core Database Boundary

The most important rules:

1. **Never alter existing HealthX tables.** Do not change columns, constraints, or
   drop/recreate any table the legacy HealthX app owns. The two apps share one
   database and schema.
2. **New tables are allowed** (e.g. `audit_log`) and must reference HealthX rows by
   app-level string IDs only — no Prisma `@relation` and no DB foreign key to
   existing models.
3. **Writes to operational tables are permitted** for clinic workflows (e.g. a
   queue/appointment status transition, creating/updating customers or OPD records),
   mirroring the legacy API behavior. Prefer narrow, intentional writes (status
   transitions) over broad edits, and wrap multi-step writes in `$transaction`.

HealthX operational tables include (read/write per the rules above):
clinic, branch, user, role, permission, customer, customer_info, appointment,
appointment_reminder, opd, opd_image, prescription, product, course, inventory,
sale_order, receipt, customer_wallet, wallet_log, clinic_subscription,
subscription_plan, documents_signed.

## Database Schema Strategy

Single shared database and schema (`public`) with the legacy HealthX app.

Important Prisma files:

```txt
prisma/schema.prisma                  - Full HealthX public schema + the new audit_log model
prisma.config.ts                      - Prisma 7 config: loads .env, sets DATABASE_URL datasource
prisma/sql/001_create_audit_log.sql   - Surgical, idempotent migration for the audit_log table
```

In Prisma 7 the `url` is configured in `prisma.config.ts`, not the schema file.

## Prisma Safety Rules

- **Never alter existing HealthX tables.** New tables only.
- **Do NOT use `prisma db push`** here — it syncs the entire schema and can ALTER
  existing tables to match the datamodel (e.g. add a drifted index). Instead:
  1. Preview: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  2. Confirm the diff only creates your new table/enum/indexes (no DROP/ALTER on existing tables).
  3. Apply a targeted, idempotent SQL file via `npx prisma db execute --file <file>.sql`.
- New tables reference HealthX rows by app-level string IDs (no `@relation`, no FK).

Example new model (references by string id, no relation):

```prisma
model audit_log {
  audit_log_id String   @id @default(uuid()) @db.Uuid
  clinic_id    String   @db.VarChar(50)
  reference_id String   @db.VarChar(50)
  // ...
}
```

## Environment Rules

Example local environment (`.env`):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/healthx_optionb_test?schema=public"
APP_PORT=8080
WEB_BASE_URL=http://localhost:3000
```

`DATABASE_URL` points at the shared HealthX `public` schema. `.env` is loaded via
`process.loadEnvFile()` in `main.ts` and `prisma.config.ts`. Do not use production
URLs for local experiments.

## Deployment DNS / Environment Names

HealthX has separate dev and production app/API hostnames. Keep these values in
environment variables and Terraform inputs; do not hard-code them in source code
or tests except as documented fixtures.

```txt
dev:
  frontend app: https://app-dev.healthx-pro.com
  backend API:  https://api-dev.healthx-pro.com/api/v1

production:
  frontend app: https://app.healthx-pro.com
  backend API:  https://api.healthx-pro.com/api/v1
```

Backend environment mapping:

```env
# dev
WEB_BASE_URL=https://app-dev.healthx-pro.com
CORS_ORIGINS=https://app-dev.healthx-pro.com

# production
WEB_BASE_URL=https://app.healthx-pro.com
CORS_ORIGINS=https://app.healthx-pro.com
```

Frontend environment mapping:

```env
# dev
NEXT_PUBLIC_API_BASE_URL=https://api-dev.healthx-pro.com/api/v1

# production
NEXT_PUBLIC_API_BASE_URL=https://api.healthx-pro.com/api/v1
```

Cookie note: prefer host-only auth cookies on the API host. Be careful with
`AUTH_COOKIE_DOMAIN=.healthx-pro.com` because the shared `hx_token` / `hx_refresh`
cookie names could collide between dev and production subdomains unless cookie
names or domains are environment-isolated.

## Applying a new table (safe flow)

Local/test database only. Never alter existing tables; never `db push`.

```bash
# 1. Preview what would change against the live DB (read-only)
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script

# 2. Confirm the diff only CREATEs your new table/enum/indexes (no DROP/ALTER on existing tables)

# 3. Apply a targeted, idempotent SQL file (only the new-table DDL)
npx prisma db execute --file prisma/sql/001_create_audit_log.sql
```

If the diff shows any DROP/ALTER on an existing HealthX table, do not apply it —
hand-write the new-table DDL instead.

## Prisma Client Generation

```bash
npx prisma generate   # uses prisma.config.ts; client at @prisma/client
```

## Prisma 7 Config

Prisma 7 uses `prisma.config.ts` (not `--schema` flags or `url` in the schema file)
and requires a driver adapter at runtime. `PrismaService` uses `@prisma/adapter-pg`
over `DATABASE_URL`. There is a single client (HealthX `public` schema).

## HealthX Reference Field Rules

In a **new** table, any field pointing to a HealthX row must be app-level only:

- No Prisma `@relation`, no database foreign key.
- Store the id as `String @db.VarChar(50)` (e.g. `clinic_id`, `branch_id`,
  `customer_id`, `actor_user_id`, `reference_id`).

Correct example:

```prisma
clinic_id String @db.VarChar(50)
```

Incorrect (do not relate a new table to an existing HealthX model):

```prisma
clinic clinic @relation(...)
```

Note: existing HealthX models already have `@relation`s among themselves — that is
fine to read. The rule applies to NEW tables you add.

## Relations in new tables

Prisma `@relation`s are allowed only between new tables you own (e.g. a parent and
its child rows). Never add a relation from a new table to an existing HealthX model.

## NestJS Architecture Rules

Use feature modules.

Preferred structure:

```txt
src/modules/<feature>/
  controllers/
  services/
  dto/
  entities-or-types/
  repositories/
  mappers/
  schemas/
  <feature>.module.ts
```

For example:

```txt
src/modules/leads/
  controllers/leads.controller.ts
  services/leads.service.ts
  dto/create-lead.dto.ts
  dto/update-lead.dto.ts
  repositories/leads.repository.ts
  mappers/lead.mapper.ts
  leads.module.ts
```

## Controller Rules

Controllers should:

- Handle routing only.
- Use DTOs for request validation.
- Call services.
- Return consistent response contracts.
- Not contain database query logic.
- Not contain business-heavy logic.

## Service Rules

Services should:

- Own business logic.
- Coordinate repositories and external APIs.
- Enforce data boundary rules.
- Create audit logs for important changes.
- Avoid direct Prisma usage if a repository layer exists.
- Avoid returning raw Prisma objects if API DTO shape differs.

## Repository Rules

Repositories should:

- Contain Prisma queries.
- Be feature-scoped.
- Avoid business logic.
- Use typed query inputs and typed return values.
- Never write to HealthX SaaS source tables unless explicitly approved.

## DTO and Validation Rules

Use DTOs with class-validator/class-transformer if this is the existing project convention.

Align and validate backend schema rules with frontend definitions (e.g. React Hook Form combined with Zod Schema Validation) for forms, API queryparams, and payloads.

DTOs should validate:

- required fields
- enum fields
- UUID fields for Backoffice IDs
- string ID fields for HealthX references
- pagination parameters
- search/filter parameters

Do not accept `any`.

Do not pass raw request bodies directly into Prisma.

## Response Contract Rules

All APIs must return a consistent response shape wrapped globally by `CustomResponseInterceptor` and `CustomExceptionFilter`.

- **Success Responses**: Must always be structured as:
  ```json
  {
    "status": "0000",
    "data": ...
  }
  ```
- **Error/Exception Responses**: Must always be structured as:
  ```json
  {
    "status": "8999" (GENERIC_ERROR) or "9999" (TECHNICAL_ERROR),
    "message": "Error description message"
  }
  ```

## Logging Rules

- All application logs, request logs, and runtime exceptions must be handled through the globally configured `nestjs-pino` Logger (`pino` engine) to produce consistent structured logs. Do not print plain logs or bypass NestJS Logger.

## TypeScript Rules

- No `any`. Never use `any` in function parameters, return types, class fields, or variable declarations where a strict type can be defined.
- No unsafe casts.
- Use strict DTOs and domain types.
- Prefer explicit return types for public methods.
- Do not suppress TypeScript errors.
- Do not use `// @ts-ignore`.

## API Namespace Rules

The NestJS app uses a global prefix such as:

```ts
app.setGlobalPrefix("/api/v1");
```

Clinic controllers use:

```ts
@Controller("clinic/<resource>")
```

Final API path example:

```txt
/api/v1/clinic/queue/today
/api/v1/clinic/appointments
/api/v1/clinic/opd
/api/v1/clinic/customers
/api/v1/clinic/audit-log
```

## Modules

The five feature modules under `src/api/`:

1. customers — list / detail (read)
2. appointments — list with branch/date/status filters (read)
3. opd — list + history-by-customer (read)
4. queue — today's queue (derived from appointments + opd) + status transition (write + audit)
5. audit-log — list + create (the new feature; `public.audit_log`)

## Audit Log Rules

Create an `audit_log` entry for clinic status transitions and important actions:

- queue status transitions (check-in, send-to-consulting, payment, complete, etc.)
- OPD record status changes
- appointment confirm / reschedule / cancel
- customer create / approve / status change

Use `AuditLogService.create` (surfaces errors) or `.record` (non-fatal background
logging). Reference HealthX rows by `reference_type` + `reference_id`.

## Security Rules

- Do not expose internal DB IDs unnecessarily.
- Do not log sensitive payloads.
- Do not expose patient medical details in Backoffice unless explicitly required and authorized.
- Do not return full HealthX customer/OPD records unless a specific permission exists.
- Prefer minimal lookup data for HealthX references, such as clinic name, branch name, user display name, and customer display name.

## Testing Rules

When adding or refactoring backend code, add tests if the project already has test setup.

Prioritize tests for:

- service business logic
- repository query behavior where practical
- DTO validation
- assignment rules
- status transitions
- response contract

## Validation Commands

Run available commands from `package.json`.

Common commands:

```bash
pnpm lint
pnpm test
pnpm build
```

Prisma validation:

```bash
npx prisma validate
```

Do not run `db push`. Never run migrations that touch existing tables. New tables
are applied via targeted SQL (see "Applying a new table").

## Task Completion Checklist

Before reporting completion:

1. No unsafe Prisma command was run (no `db push`, no ALTER/DROP on existing tables).
2. No existing HealthX table was modified.
3. No new table relates to an existing HealthX model.
4. References to HealthX rows use `String @db.VarChar(50)`.
5. New-table primary keys use UUID where appropriate.
6. Feature code is split into controller/service/repository/dto layers.
7. No `any` is introduced.
8. Lint/build/test results are reported.
9. Remaining risks or backend contract questions are listed clearly.

## Database Client and Transaction Rules

1. **Prisma Client Usage**: Use `PrismaService` (`src/prisma.service.ts`), a single
   `@prisma/adapter-pg` client over the `public` schema. There is no separate
   backoffice client.
2. **Transaction Integrity**: When a mutation spans multiple operations (e.g. update
   an appointment status and write an audit_log entry), use `$transaction`.

## Final Rule

Never alter existing HealthX tables. Add new tables only (referencing HealthX rows
by string IDs, no FK). Operational writes for clinic workflows are allowed but must
be narrow and intentional, mirroring the legacy HealthX API behavior.
