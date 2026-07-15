import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { decimalToNumber } from "../../common/decimal";
import { backendEnv } from "../../env";
import { OutboxService } from "../outbox/outbox.service";

export const SALES_ORDER_CREATED_EVENT = "erp.sales-order.created";
const SALES_ORDER_AGGREGATE = "sale_order";

export interface ErpEmitScope {
  clinicId: string;
  branchId: string;
}

/**
 * Phase 8 first real domain emitter (plan-latest §14): when a clinic workflow
 * finishes a visit, every PAID sale order attached to that visit's OPD becomes
 * one `erp.sales-order.created` outbox event, enqueued on the caller's
 * transaction so the event commits or rolls back with the workflow write.
 *
 * Mapping problems (a line with no item reference, an order with no mappable
 * lines) are logged and skipped, never thrown: ERP export must not block the
 * clinic from completing a visit. Duplicate protection is layered — an
 * existing outbox row for the same sale order suppresses re-enqueue here, and
 * the erp-integration consumer's erp_document_log dedups per documentNo even
 * if a duplicate event does slip through.
 */
@Injectable()
export class ErpSalesOrderEmitter {
  private readonly logger = new Logger(ErpSalesOrderEmitter.name);

  constructor(private readonly outbox: OutboxService) {}

  /**
   * Enqueues one event per PAID, non-deleted sale order linked (via
   * prescriptions) to the given OPD. Returns how many events were enqueued.
   * No-op while ERP_OUTBOX_ENABLED=false so the boundary stays inert where
   * the dispatcher isn't running.
   */
  async emitPaidSaleOrdersForOpd(
    tx: Prisma.TransactionClient,
    scope: ErpEmitScope,
    opdId: string,
  ): Promise<number> {
    if (!backendEnv().ERP_OUTBOX_ENABLED) return 0;

    const saleOrders = await tx.sale_order.findMany({
      where: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        sale_order_status: "PAID",
        status: { not: "DELETED" },
        prescription: { some: { opd_id: opdId } },
      },
      select: {
        sale_order_id: true,
        customer_id: true,
        date: true,
        sale_order_item: {
          select: {
            sale_order_item_id: true,
            item_id: true,
            course_item_id: true,
            bundle_set_id: true,
            item_name: true,
            quantity: true,
            price_per_unit: true,
          },
        },
      },
    });
    if (saleOrders.length === 0) return 0;

    const alreadyEnqueued = await tx.outbox_event.findMany({
      where: {
        event_type: SALES_ORDER_CREATED_EVENT,
        branch_id: scope.branchId,
        aggregate_id: { in: saleOrders.map((order) => order.sale_order_id) },
      },
      select: { aggregate_id: true },
    });
    const alreadyEnqueuedIds = new Set(alreadyEnqueued.map((row) => row.aggregate_id));

    let enqueued = 0;
    for (const order of saleOrders) {
      if (alreadyEnqueuedIds.has(order.sale_order_id)) continue;

      const lines = order.sale_order_item.flatMap((item) => {
        // BC lines need a master-data reference; item_name alone can't be one.
        const itemNo = item.item_id ?? item.course_item_id ?? item.bundle_set_id;
        if (!itemNo) {
          this.logger.warn(
            `sale_order_item ${item.sale_order_item_id} ("${item.item_name}") has no ` +
              `item/course/bundle reference; line omitted from ERP event for ${order.sale_order_id}`,
          );
          return [];
        }
        return [
          {
            itemNo,
            quantity: decimalToNumber(item.quantity),
            unitPrice: decimalToNumber(item.price_per_unit),
          },
        ];
      });
      if (lines.length === 0) {
        this.logger.warn(
          `sale order ${order.sale_order_id} has no mappable lines; ERP event skipped`,
        );
        continue;
      }

      const { correlationId } = await this.outbox.enqueue(tx, {
        eventType: SALES_ORDER_CREATED_EVENT,
        aggregateType: SALES_ORDER_AGGREGATE,
        aggregateId: order.sale_order_id,
        clinicId: scope.clinicId,
        branchId: scope.branchId,
        payload: {
          documentNo: order.sale_order_id,
          customerNumber: order.customer_id,
          ...(order.date ? { orderDate: order.date.toISOString().slice(0, 10) } : {}),
          externalDocumentNo: opdId,
          lines,
        },
      });
      this.logger.log(
        `enqueued ${SALES_ORDER_CREATED_EVENT} for sale order ${order.sale_order_id} ` +
          `(opd ${opdId}, correlation ${correlationId})`,
      );
      enqueued += 1;
    }
    return enqueued;
  }
}
