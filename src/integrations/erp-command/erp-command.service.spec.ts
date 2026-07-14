import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../../prisma.service";
import { resetBackendEnvForTest } from "../../env";
import type { ErpCommandDto } from "./dto/erp-command.dto";
import { ErpCommandService } from "./erp-command.service";

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/healthx_test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  ERP_COMMAND_API_ENABLED: "true",
  ERP_SERVICE_KEY: "phase4-test-service-key-0123456789abcdef",
  ERP_ALLOWED_BRANCH_IDS: "BR-001, BR-002",
};

function dtoOf(overrides: Partial<ErpCommandDto> = {}): ErpCommandDto {
  return {
    operation: "inventory-adjustment",
    commandId: "cmd-001",
    branchId: "BR-001",
    payload: { productId: "MED-AMX-500", quantity: 3 },
    correlationId: "corr-1",
    ...overrides,
  } as ErpCommandDto;
}

describe("ErpCommandService", () => {
  const originalEnv = process.env;
  let create: jest.Mock;
  let service: ErpCommandService;

  beforeEach(() => {
    process.env = { ...originalEnv, ...BASE_ENV };
    resetBackendEnvForTest();
    create = jest.fn().mockResolvedValue({ erp_inbound_command_id: "id-1" });
    const prisma = { erp_inbound_command: { create } } as unknown as PrismaService;
    service = new ErpCommandService(prisma);
  });

  afterAll(() => {
    process.env = originalEnv;
    resetBackendEnvForTest();
  });

  it("records a new command exactly once", async () => {
    await expect(service.apply(dtoOf())).resolves.toEqual({
      commandId: "cmd-001",
      operation: "inventory-adjustment",
      result: "RECORDED",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        operation: "inventory-adjustment",
        command_id: "cmd-001",
        branch_id: "BR-001",
        payload: { productId: "MED-AMX-500", quantity: 3 },
        correlation_id: "corr-1",
      },
      select: { erp_inbound_command_id: true },
    });
  });

  it("treats a unique-constraint violation as an idempotent replay", async () => {
    create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "7.0.0",
      }),
    );
    await expect(service.apply(dtoOf())).resolves.toEqual({
      commandId: "cmd-001",
      operation: "inventory-adjustment",
      result: "DUPLICATE",
    });
  });

  it("rejects a branch outside the allowlist before any write", async () => {
    await expect(service.apply(dtoOf({ branchId: "BR-999" }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("rethrows non-unique database errors", async () => {
    create.mockRejectedValueOnce(new Error("connection reset"));
    await expect(service.apply(dtoOf())).rejects.toThrow("connection reset");
  });
});
