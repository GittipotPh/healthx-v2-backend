import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, auditReferenceType, type opd_encounter } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
  type CreateOpdOrderItemDto,
  OpdClinicalCatalogCategory,
  OpdOrderSourceType,
  type PatchOpdOrderItemDto,
  type QueryOpdClinicalCatalogDto,
  type VoidOpdOrderItemDto,
} from "./dto/opd-order.dto";
import { OpdClinicalRepository } from "./opd-clinical.repository";
import {
  type CreateOpdDraftOrderResult,
  type OpdClinicalCatalogListResult,
  type OpdDraftOrderResult,
  type OpdDraftOrderView,
  type OpdOrderRecord,
  toOpdCatalogItemView,
  toOpdDraftOrderView,
} from "./opd-order.mapper";
import { OpdOrderRepository } from "./opd-order.repository";

const MAX_MONEY = new Prisma.Decimal("999999999999.99");

@Injectable()
export class OpdOrderService {
  constructor(
    private readonly repository: OpdOrderRepository,
    private readonly clinicalRepository: OpdClinicalRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async catalog(
    query: QueryOpdClinicalCatalogDto,
    scope: RequestScope,
  ): Promise<OpdClinicalCatalogListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const result = await this.repository.listCatalog(query, scope);
    return {
      items: result.items.map(toOpdCatalogItemView),
      total: result.total,
      page,
      pageSize,
      pricingPolicy: "catalog-snapshot-v1",
      releaseAvailable: true,
    };
  }

  async draftOrder(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdDraftOrderResult> {
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
    );
    if (!encounter) this.throwEncounterNotFound();
    const order = await this.repository.findDraftOrder(encounterId, scope);
    return { order: order ? toOpdDraftOrderView(order) : null };
  }

  async createDraftOrder(
    encounterId: string,
    scope: RequestScope,
    principal: Principal,
  ): Promise<CreateOpdDraftOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      const encounter = await this.lockEditableEncounter(
        encounterId,
        scope,
        tx,
      );
      const current = await this.repository.findDraftOrder(
        encounterId,
        scope,
        tx,
      );
      if (current) {
        return { order: toOpdDraftOrderView(current), resumed: true };
      }

      const now = new Date();
      const created = await this.repository.createDraftOrder(
        encounterId,
        scope,
        now,
        tx,
      );
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "order.draft.create",
          actionLabel: "Create OPD draft order",
          fromStatus: encounter.clinical_record_status,
          toStatus: encounter.clinical_record_status,
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            orderId: created.order_id,
            orderVersion: created.version,
            releaseAvailable: false,
          },
        },
        tx,
      );
      return { order: toOpdDraftOrderView(created), resumed: false };
    });
  }

  async addItem(
    encounterId: string,
    orderId: string,
    dto: CreateOpdOrderItemDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdDraftOrderView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEditableEncounter(encounterId, scope, tx);
      const order = await this.lockAndLoadOrder(
        encounterId,
        orderId,
        scope,
        tx,
      );
      this.assertOrderVersion(order, dto.expectedOrderVersion);

      const source = await this.repository.findCatalogItem(
        dto.sourceType,
        dto.sourceId,
        scope,
        tx,
      );
      if (!source) this.throwCatalogItemNotFound();
      this.validateMedicationInstruction(
        source.category,
        dto.medicationInstruction,
      );
      const { unitPrice, grossAmount } = this.pricing(
        source.effectivePrice,
        dto.quantity,
      );
      const now = new Date();
      const displayOrder = await this.repository.nextItemDisplayOrder(
        orderId,
        scope,
        tx,
      );
      const itemId = await this.repository.createItem(
        orderId,
        encounterId,
        displayOrder,
        source,
        unitPrice,
        dto,
        grossAmount,
        scope,
        now,
        tx,
      );
      const bumped = await this.repository.recalculateAndBumpOrder(
        orderId,
        encounterId,
        dto.expectedOrderVersion,
        scope,
        now,
        tx,
      );
      if (!bumped) {
        await this.throwLatestOrderConflict(encounterId, scope, tx);
      }
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "order.item.create",
          actionLabel: "Add item to OPD draft order",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            orderId,
            orderItemId: itemId,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            category: source.category,
            quantity: dto.quantity,
            unitPrice: unitPrice.toFixed(2),
            grossAmount: grossAmount.toFixed(2),
            previousOrderVersion: dto.expectedOrderVersion,
            resultOrderVersion: dto.expectedOrderVersion + 1,
          },
        },
        tx,
      );
      return this.reloadOrder(encounterId, scope, tx);
    });
  }

  async patchItem(
    encounterId: string,
    orderId: string,
    itemId: string,
    dto: PatchOpdOrderItemDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdDraftOrderView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEditableEncounter(encounterId, scope, tx);
      const order = await this.lockAndLoadOrder(
        encounterId,
        orderId,
        scope,
        tx,
      );
      this.assertOrderVersion(order, dto.expectedOrderVersion);
      const item = this.activeItem(order, itemId);
      this.assertItemVersion(item, dto.expectedItemVersion);

      const source = await this.repository.findCatalogItem(
        this.sourceType(item.source_type),
        item.source_id,
        scope,
        tx,
      );
      if (!source) this.throwCatalogItemNotFound();
      this.validateMedicationInstruction(
        source.category,
        dto.medicationInstruction,
      );
      const { unitPrice, grossAmount } = this.pricing(
        source.effectivePrice,
        dto.quantity,
      );
      const now = new Date();
      const updated = await this.repository.updateItem(
        orderId,
        encounterId,
        itemId,
        source,
        unitPrice,
        dto,
        grossAmount,
        scope,
        now,
        tx,
      );
      if (!updated) this.throwItemConflict(item);
      const bumped = await this.repository.recalculateAndBumpOrder(
        orderId,
        encounterId,
        dto.expectedOrderVersion,
        scope,
        now,
        tx,
      );
      if (!bumped) {
        await this.throwLatestOrderConflict(encounterId, scope, tx);
      }
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "order.item.update",
          actionLabel: "Update OPD draft order item",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            orderId,
            orderItemId: itemId,
            quantity: dto.quantity,
            unitPrice: unitPrice.toFixed(2),
            grossAmount: grossAmount.toFixed(2),
            previousItemVersion: dto.expectedItemVersion,
            resultItemVersion: dto.expectedItemVersion + 1,
            previousOrderVersion: dto.expectedOrderVersion,
            resultOrderVersion: dto.expectedOrderVersion + 1,
          },
        },
        tx,
      );
      return this.reloadOrder(encounterId, scope, tx);
    });
  }

  async voidItem(
    encounterId: string,
    orderId: string,
    itemId: string,
    dto: VoidOpdOrderItemDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdDraftOrderView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEditableEncounter(encounterId, scope, tx);
      const order = await this.lockAndLoadOrder(
        encounterId,
        orderId,
        scope,
        tx,
      );
      this.assertOrderVersion(order, dto.expectedOrderVersion);
      const item = this.activeItem(order, itemId);
      this.assertItemVersion(item, dto.expectedItemVersion);

      const now = new Date();
      const reason = this.nullableText(dto.reason);
      const voided = await this.repository.voidItem(
        orderId,
        encounterId,
        itemId,
        dto.expectedItemVersion,
        reason,
        scope,
        now,
        tx,
      );
      if (!voided) this.throwItemConflict(item);
      const bumped = await this.repository.recalculateAndBumpOrder(
        orderId,
        encounterId,
        dto.expectedOrderVersion,
        scope,
        now,
        tx,
      );
      if (!bumped) {
        await this.throwLatestOrderConflict(encounterId, scope, tx);
      }
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "order.item.void",
          actionLabel: "Void OPD draft order item",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            orderId,
            orderItemId: itemId,
            reason,
            previousItemVersion: dto.expectedItemVersion,
            resultItemVersion: dto.expectedItemVersion + 1,
            previousOrderVersion: dto.expectedOrderVersion,
            resultOrderVersion: dto.expectedOrderVersion + 1,
          },
        },
        tx,
      );
      return this.reloadOrder(encounterId, scope, tx);
    });
  }

  private async lockEditableEncounter(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<opd_encounter> {
    const locked = await this.clinicalRepository.lockEncounter(
      encounterId,
      scope,
      tx,
    );
    if (!locked) this.throwEncounterNotFound();
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
      tx,
    );
    if (!encounter) this.throwEncounterNotFound();
    this.assertEncounterEditable(encounter);
    return encounter;
  }

  private async lockAndLoadOrder(
    encounterId: string,
    orderId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<OpdOrderRecord> {
    const locked = await this.repository.lockOrder(
      encounterId,
      orderId,
      scope,
      tx,
    );
    if (!locked) this.throwOrderNotFound();
    const order = await this.repository.findDraftOrder(encounterId, scope, tx);
    if (!order || order.order_id !== orderId) this.throwOrderNotFound();
    if (order.status !== "DRAFT") {
      throw new ConflictException("Only a draft OPD order can be changed");
    }
    return order;
  }

  private async reloadOrder(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<OpdDraftOrderView> {
    const updated = await this.repository.findDraftOrder(
      encounterId,
      scope,
      tx,
    );
    if (!updated)
      throw new Error("Updated OPD draft order could not be reloaded");
    return toOpdDraftOrderView(updated);
  }

  private activeItem(order: OpdOrderRecord, itemId: string) {
    const item = order.items.find(
      (candidate) => candidate.order_item_id === itemId,
    );
    if (!item) this.throwOrderItemNotFound();
    if (item.status !== "ACTIVE") {
      throw new ConflictException("A voided OPD order item is immutable");
    }
    return item;
  }

  private validateMedicationInstruction(
    category: OpdClinicalCatalogCategory,
    instruction:
      | CreateOpdOrderItemDto["medicationInstruction"]
      | PatchOpdOrderItemDto["medicationInstruction"],
  ): void {
    const isMedication =
      category === OpdClinicalCatalogCategory.MEDICINE ||
      category === OpdClinicalCatalogCategory.DRUG;
    if (isMedication && !instruction) {
      throw new BadRequestException(
        "Medication instructions are required for medicine and drug items",
      );
    }
    if (!isMedication && instruction) {
      throw new BadRequestException(
        "Medication instructions are only allowed for medicine and drug items",
      );
    }
    if (!instruction) return;
    if (!instruction.sigText.trim()) {
      throw new BadRequestException("Medication SIG text cannot be blank");
    }
    const hasDurationValue =
      instruction.durationValue !== null &&
      instruction.durationValue !== undefined;
    const hasDurationUnit = Boolean(instruction.durationUnit?.trim());
    if (hasDurationValue !== hasDurationUnit) {
      throw new BadRequestException(
        "Medication duration value and unit must be supplied together",
      );
    }
  }

  private pricing(
    effectivePrice: Prisma.Decimal | null,
    quantity: number,
  ): { unitPrice: Prisma.Decimal; grossAmount: Prisma.Decimal } {
    if (effectivePrice === null) {
      throw new BadRequestException(
        "This catalog item has no active price and cannot be ordered",
      );
    }
    const unitPrice = effectivePrice.toDecimalPlaces(2);
    if (unitPrice.isNegative() || unitPrice.greaterThan(MAX_MONEY)) {
      throw new BadRequestException(
        "This catalog item price is outside the supported OPD order range",
      );
    }
    const grossAmount = unitPrice
      .mul(new Prisma.Decimal(quantity))
      .toDecimalPlaces(2);
    if (grossAmount.greaterThan(MAX_MONEY)) {
      throw new BadRequestException(
        "The requested quantity exceeds the supported OPD order amount",
      );
    }
    return { unitPrice, grossAmount };
  }

  private sourceType(value: string): OpdOrderSourceType {
    if (value === "PRODUCT") return OpdOrderSourceType.PRODUCT;
    if (value === "COURSE_ITEM") return OpdOrderSourceType.COURSE_ITEM;
    throw new Error(`Unknown OPD order source type: ${value}`);
  }

  private assertOrderVersion(
    order: OpdOrderRecord,
    expectedVersion: number,
  ): void {
    if (order.version !== expectedVersion) this.throwOrderConflict(order);
  }

  private assertItemVersion(
    item: OpdOrderRecord["items"][number],
    expectedVersion: number,
  ): void {
    if (item.version !== expectedVersion) this.throwItemConflict(item);
  }

  private async throwLatestOrderConflict(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<never> {
    const latest = await this.repository.findDraftOrder(encounterId, scope, tx);
    if (latest) this.throwOrderConflict(latest);
    throw new ConflictException(
      "The OPD draft order changed after it was loaded",
    );
  }

  private throwOrderConflict(order: OpdOrderRecord): never {
    throw new VersionConflictException({
      resourceType: "OPD_ORDER",
      resourceId: order.order_id,
      currentVersion: order.version,
      currentStatus: order.status,
      updatedAt: order.updated_at.toISOString(),
    });
  }

  private throwItemConflict(item: OpdOrderRecord["items"][number]): never {
    throw new VersionConflictException({
      resourceType: "OPD_ORDER_ITEM",
      resourceId: item.order_item_id,
      currentVersion: item.version,
      currentStatus: item.status,
      updatedAt: item.updated_at.toISOString(),
    });
  }

  private assertEncounterEditable(encounter: opd_encounter): void {
    if (
      encounter.workflow_status !== "OPEN" ||
      encounter.clinical_record_status !== "DRAFT"
    ) {
      throw new ConflictException(
        "Draft orders can only be edited on an open draft encounter",
      );
    }
  }

  private actorRole(scope: RequestScope): string | undefined {
    return (
      scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined)
    );
  }

  private nullableText(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? "";
    return normalized.length > 0 ? normalized : null;
  }

  private throwEncounterNotFound(): never {
    throw new NotFoundException("OPD encounter not found in the active scope");
  }

  private throwOrderNotFound(): never {
    throw new NotFoundException(
      "OPD draft order not found in the active scope",
    );
  }

  private throwOrderItemNotFound(): never {
    throw new NotFoundException("OPD order item not found in the active scope");
  }

  private throwCatalogItemNotFound(): never {
    throw new NotFoundException(
      "Clinical catalog item is unavailable in the active scope",
    );
  }
}
