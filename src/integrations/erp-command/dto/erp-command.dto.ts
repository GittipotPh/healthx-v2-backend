import { IsIn, IsObject, IsOptional, IsString, Length, MaxLength } from "class-validator";

/** The V2.7 inbound operations (contracts/erp-v2.7) the boundary can carry. */
export const ERP_COMMAND_OPERATIONS = [
  "create-item",
  "update-item",
  "create-global-item",
  "update-global-item",
  "create-receive-order",
  "create-transfer-order",
  "inventory-adjustment",
] as const;

export type ErpCommandOperation = (typeof ERP_COMMAND_OPERATIONS)[number];

/**
 * One BC->HealthX command, forwarded by the erp-integration service after it
 * validated the payload against the V2.7 contract. `commandId` is that
 * service's inbound idempotency key — (operation, commandId) is unique here
 * too, so a replay can never apply twice.
 */
export class ErpCommandDto {
  @IsIn(ERP_COMMAND_OPERATIONS)
  operation!: ErpCommandOperation;

  @IsString()
  @Length(1, 200)
  commandId!: string;

  @IsString()
  @Length(1, 50)
  branchId!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  correlationId?: string;
}
