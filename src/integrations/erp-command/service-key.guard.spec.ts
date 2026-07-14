import {
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { resetBackendEnvForTest } from "../../env";
import { ServiceKeyGuard } from "./service-key.guard";

const SERVICE_KEY = "phase4-test-service-key-0123456789abcdef";

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/healthx_test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
};

function contextOf(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, path: "/api/v1/internal/erp/commands" }) }),
  } as unknown as ExecutionContext;
}

describe("ServiceKeyGuard", () => {
  const originalEnv = process.env;

  function configure(overrides: Record<string, string>): ServiceKeyGuard {
    process.env = { ...originalEnv, ...BASE_ENV, ...overrides };
    resetBackendEnvForTest();
    return new ServiceKeyGuard();
  }

  afterEach(() => {
    process.env = originalEnv;
    resetBackendEnvForTest();
  });

  it("hides the surface entirely when the command API is disabled", () => {
    const guard = configure({ ERP_COMMAND_API_ENABLED: "false" });
    expect(() => guard.canActivate(contextOf({ "x-service-key": SERVICE_KEY }))).toThrow(
      NotFoundException,
    );
  });

  it("rejects a missing service key", () => {
    const guard = configure({
      ERP_COMMAND_API_ENABLED: "true",
      ERP_SERVICE_KEY: SERVICE_KEY,
      ERP_ALLOWED_BRANCH_IDS: "BR-001",
    });
    expect(() => guard.canActivate(contextOf({}))).toThrow(UnauthorizedException);
  });

  it("rejects a wrong service key", () => {
    const guard = configure({
      ERP_COMMAND_API_ENABLED: "true",
      ERP_SERVICE_KEY: SERVICE_KEY,
      ERP_ALLOWED_BRANCH_IDS: "BR-001",
    });
    expect(() =>
      guard.canActivate(contextOf({ "x-service-key": "wrong-key-wrong-key-wrong-key-000" })),
    ).toThrow(UnauthorizedException);
  });

  it("accepts the configured service key", () => {
    const guard = configure({
      ERP_COMMAND_API_ENABLED: "true",
      ERP_SERVICE_KEY: SERVICE_KEY,
      ERP_ALLOWED_BRANCH_IDS: "BR-001",
    });
    expect(guard.canActivate(contextOf({ "x-service-key": SERVICE_KEY }))).toBe(true);
  });
});
