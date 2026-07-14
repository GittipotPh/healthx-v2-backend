-- Surgical migration for the ERP integration boundary (plan-latest.md §8, Phase 4).
-- Creates ONLY the two new app-owned tables in the public schema:
--   outbox_event        — transactional outbox for RabbitMQ publishing
--   erp_inbound_command — idempotent record of BC->HealthX commands applied
--                         through the internal x-service-key command API
-- Does NOT touch any existing HealthX table. Idempotent (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS "outbox_event" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" VARCHAR(50) NOT NULL,
    "clinic_id" VARCHAR(50) NOT NULL,
    "branch_id" VARCHAR(50),
    "payload" JSONB NOT NULL,
    "correlation_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(6),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outbox_event_status_created_at_idx" ON "outbox_event"("status", "created_at");

CREATE TABLE IF NOT EXISTS "erp_inbound_command" (
    "erp_inbound_command_id" UUID NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "command_id" VARCHAR(200) NOT NULL,
    "branch_id" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" VARCHAR(100),
    "result" VARCHAR(20) NOT NULL DEFAULT 'RECORDED',
    "received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_inbound_command_pkey" PRIMARY KEY ("erp_inbound_command_id"),
    -- (operation, command_id) IS the idempotency guarantee: the command_id is
    -- the erp-integration service's inbound_request idempotency key, so a
    -- replayed BC request can never apply twice.
    CONSTRAINT "erp_inbound_command_op_cmd_uq" UNIQUE ("operation", "command_id")
);

CREATE INDEX IF NOT EXISTS "erp_inbound_command_received_at_idx" ON "erp_inbound_command"("received_at");
