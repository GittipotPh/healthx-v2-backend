/**
 * Phase 4 first-vertical-slice helper (plan-latest §12): enqueue ONE synthetic
 * erp.sales-order.created event through the transactional outbox. The running
 * backend's dispatcher publishes it to RabbitMQ, the erp-integration service
 * consumes it and creates the document in the BC365 simulator.
 *
 * Synthetic data only — no real customer, order, or clinic content. Run from
 * the backend dir (requires DATABASE_URL):
 *   node --env-file=.env --import tsx scripts/publish-test-erp-event.ts
 *
 * Re-running enqueues a NEW event with the SAME documentNo, which proves the
 * consumer's per-document dedup: the second event must produce zero extra BC
 * documents (erp_document_log unique constraint).
 */
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DOCUMENT_NO = process.env.TEST_ERP_DOCUMENT_NO ?? "SO-PHASE4-0001";

async function main(): Promise<void> {
  const correlationId = randomUUID();
  const row = await prisma.outbox_event.create({
    data: {
      event_type: "erp.sales-order.created",
      aggregate_type: "sale_order",
      aggregate_id: DOCUMENT_NO,
      clinic_id: "TEST-CLINIC",
      branch_id: "BR-001",
      correlation_id: correlationId,
      payload: {
        documentNo: DOCUMENT_NO,
        customerNumber: "CUST-0001",
        orderDate: new Date().toISOString().slice(0, 10),
        externalDocumentNo: "PHASE4-SLICE",
        // Item/customer numbers must exist in the simulator's seeded master
        // data — like real BC, it rejects unknown references with a 400.
        lines: [
          { itemNo: "MED-AMX-500", quantity: 2, unitPrice: 420 },
          { itemNo: "CRS-FACIAL-01", quantity: 1, unitPrice: 1500 },
        ],
      },
    },
    select: { id: true, event_type: true, status: true, created_at: true },
  });

  console.log("outbox event enqueued:", {
    eventId: row.id,
    eventType: row.event_type,
    documentNo: DOCUMENT_NO,
    correlationId,
    status: row.status,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
