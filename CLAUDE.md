# CLAUDE.md — HealthX Clinic Operations Backend

> Full rules: see `AGENTS.md` in this directory.

## What this app is

NestJS API powering the clinic-operations frontend (`../frontend`). It serves
five features — Today's Queue (คิววันนี้), OPD, Appointments (นัดหมาย),
Customers (ลูกค้า), and Audit Log — backed by the existing HealthX `public`
PostgreSQL schema plus one new table, `audit_log`. Business logic mirrors the
legacy HealthX API (`../ref_api_old_healthx`).

## Stack

NestJS 11 · TypeScript · Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL (`public`) · pnpm

## Key Files

```
prisma.config.ts              → Prisma 7 config (loads .env, DATABASE_URL datasource)
prisma/schema.prisma          → Full HealthX public schema + app-owned models
prisma/sql/00*.sql            → Surgical idempotent migrations: audit_log, queue_status
                                + ref_queue_step_status, statusAppointment enum extension
src/main.ts                   → Bootstrap: /api/v1 prefix, ValidationPipe, response/error contract, CORS
src/prisma.service.ts         → PrismaClient over @prisma/adapter-pg
src/common/                   → ResponseInterceptor + AllExceptionsFilter, rate-limit,
                                branch-access (shared "which branches can this scope see")
src/api/<feature>/            → audit-log, queue, customers, appointments, opd
```

App-owned tables: `audit_log`, `queue_status`, `ref_queue_step_status` (string refs
to HealthX rows, no FK). Write endpoints today: `POST clinic/queue/transition`,
`POST clinic/appointments` (both transactional + audited), `POST clinic/audit-log[/login]`.

## Database Rules

- One shared database/schema (`public`) with the legacy HealthX app — **never alter
  existing tables**. New tables are allowed (e.g. `audit_log`) and must use app-level
  string references to HealthX rows (no `@relation`/FK to existing models).
- Composite keys exist: `customer` = `[customer_id, clinic_id]`, `opd` = `[opd_id, branch_id]`.
- Multi-step mutations: wrap in `$transaction`.
- Writes to operational tables (appointment/opd/customer) are allowed for clinic
  workflows, but be conservative and prefer status transitions over broad edits.

## Prisma Safety

```bash
# SAFE — validate / generate / preview
npx prisma validate
npx prisma generate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script

# Apply a NEW table only (preferred): surgical, idempotent SQL — never touches existing tables
npx prisma db execute --file prisma/sql/001_create_audit_log.sql

# AVOID `prisma db push` here: it syncs the WHOLE schema and may ALTER existing
# tables to match (e.g. add a drifted index). Apply targeted SQL instead.
```

If any command would DROP or ALTER an existing HealthX table, stop and apply only
the new-table DDL by hand.

## Module Structure

```
src/api/<feature>/
  <feature>.controller.ts     → routing + DTO validation, calls service
  <feature>.service.ts        → business logic, audit logging
  <feature>.repository.ts     → Prisma queries only
  <feature>.mapper.ts         → row → API view (camelCase, ISO dates)
  dto/                        → class-validator DTOs
  <feature>.module.ts
```

## Response Contract

Wrapped globally by `ResponseInterceptor` / `AllExceptionsFilter`:

```json
// Success
{ "status": "0000", "data": ... }
// Error
{ "status": "8999" | "9999", "message": "..." }
```

## API Namespace

```ts
app.setGlobalPrefix("api/v1")
@Controller("clinic/<resource>")   // → /api/v1/clinic/<resource>
```

## Deployment DNS

Use environment variables/Terraform inputs for DNS. Known stage mapping:

```txt
dev:        app https://app-dev.healthx-pro.com  | api https://api-dev.healthx-pro.com/api/v1
production: app https://app.healthx-pro.com      | api https://api.healthx-pro.com/api/v1
```

Backend CORS/origin env should point to the matching app host:
`WEB_BASE_URL` / `CORS_ORIGINS`. Prefer host-only API cookies; avoid a shared
`.healthx-pro.com` cookie domain unless dev/prod cookie isolation is handled.

## Audit Logs

The Audit Log feature stores entries in `public.audit_log`. Create an entry on
clinic status transitions (queue/opd/appointment) via `AuditLogService.create`
(or `.record` for non-fatal background logging). Reference HealthX rows by
`reference_type` + `reference_id` (string).

## TypeScript Rules

- No `any`. Explicit return types on public methods. No unsafe casts. No `// @ts-ignore`.

## Known Tech Debt

Full audit findings + priority-ranked punch list: `../docs/refactor-plan.md` —
re-verified 2026-07-02; read its status-update section first (it marks what's
already fixed, e.g. the queue transition is now transactional). Top remaining
items: remove/gate the ungated `POST /clinic/audit-log` create endpoint
(client-supplied actor identity); `PrismaService` must be provided by one shared
`@Global() PrismaModule`, not redeclared per feature module (currently 8x instances
→ 8x connection pools); OPD history drops branch scope; `ScopeGuard`, the queue
module, and the new appointment-create path have no tests despite being the most
security/write-critical code in the app. See `AGENTS.md`'s "Database Client and
Transaction Rules", "DTO and Validation Rules", and "Security Rules" for the
standing rules these findings turned into.

## Validation Commands

```bash
pnpm typecheck   # tsc --noEmit
pnpm build       # nest build
pnpm verify      # lint + typecheck + test + build
```
