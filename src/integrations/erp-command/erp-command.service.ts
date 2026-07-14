import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import { backendEnv } from "../../env";
import type { ErpCommandDto } from "./dto/erp-command.dto";

export interface ErpCommandResult {
  commandId: string;
  operation: string;
  result: "RECORDED" | "DUPLICATE";
}

/**
 * Applies BC->HealthX commands inside the HealthX boundary (plan-latest §4).
 * Phase 4 scope: enforce the branch allowlist and record the command exactly
 * once in the app-owned erp_inbound_command table — the erp_document/branch
 * mapping into operational inventory tables arrives with the V2 inventory
 * domain (Phase 8); recording here is what makes the inbound flow durable and
 * replay-safe end to end.
 */
@Injectable()
export class ErpCommandService {
  private readonly logger = new Logger(ErpCommandService.name);
  /** Parsed once: ERP branch codes this service key is allowed to touch. */
  private readonly allowedBranchIds = new Set(
    (backendEnv().ERP_ALLOWED_BRANCH_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );

  constructor(private readonly prisma: PrismaService) {}

  async apply(dto: ErpCommandDto): Promise<ErpCommandResult> {
    // The API key upstream identifies the system; the payload must still name
    // a branch that system is allowed to touch (rabbitmq plan §6).
    if (!this.allowedBranchIds.has(dto.branchId)) {
      this.logger.warn({
        event: "erp_command.branch_rejected",
        operation: dto.operation,
        branchId: dto.branchId,
        correlationId: dto.correlationId,
      });
      throw new ForbiddenException(`Branch ${dto.branchId} is not allowed for ERP commands`);
    }

    try {
      await this.prisma.erp_inbound_command.create({
        data: {
          operation: dto.operation,
          command_id: dto.commandId,
          branch_id: dto.branchId,
          payload: dto.payload as Prisma.InputJsonValue,
          correlation_id: dto.correlationId ?? null,
        },
        select: { erp_inbound_command_id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Unique (operation, command_id) violation: the command was already
        // applied — idempotent replay, not an error. The erp-integration
        // service guarantees a reused key carries an identical payload (it
        // 409s otherwise before ever forwarding).
        this.logger.log({
          event: "erp_command.duplicate_replayed",
          operation: dto.operation,
          correlationId: dto.correlationId,
        });
        return { commandId: dto.commandId, operation: dto.operation, result: "DUPLICATE" };
      }
      throw error;
    }

    this.logger.log({
      event: "erp_command.recorded",
      operation: dto.operation,
      branchId: dto.branchId,
      correlationId: dto.correlationId,
    });
    return { commandId: dto.commandId, operation: dto.operation, result: "RECORDED" };
  }
}
