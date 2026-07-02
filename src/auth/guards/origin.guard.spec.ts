import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { OriginGuard } from "./origin.guard";
import { resetBackendEnvForTest } from "../../env";

const ALLOWED_ORIGINS = [
  "https://app-dev.healthx-pro.com",
  "https://app.healthx-pro.com",
];

function contextOf(req: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("OriginGuard", () => {
  const ORIGINAL_ENV = { ...process.env };
  let guard: OriginGuard;

  beforeEach(() => {
    process.env.DATABASE_URL =
      "postgresql://user:pass@localhost:5432/healthx_test";
    process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters";
    process.env.CORS_ORIGINS = ALLOWED_ORIGINS.join(",");
    resetBackendEnvForTest();
    guard = new OriginGuard();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetBackendEnvForTest();
  });

  it("allows safe GET requests regardless of origin", () => {
    expect(guard.canActivate(contextOf({ method: "GET", headers: {} }))).toBe(
      true,
    );
  });

  it("allows mutating requests from a trusted origin", () => {
    for (const origin of ALLOWED_ORIGINS) {
      const ctx = contextOf({ method: "POST", headers: { origin } });
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it("rejects mutating requests from an untrusted origin", () => {
    const ctx = contextOf({
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("allows mutating requests with no Origin/Referer when no cookie is sent", () => {
    expect(guard.canActivate(contextOf({ method: "POST", headers: {} }))).toBe(
      true,
    );
  });

  it("rejects cookie-backed mutating requests with no Origin/Referer", () => {
    const ctx = contextOf({
      method: "POST",
      headers: { cookie: "hx_token=abc" },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("derives the origin from the Referer header", () => {
    const ok = contextOf({
      method: "DELETE",
      headers: { referer: `${ALLOWED_ORIGINS[0]}/queue` },
    });
    expect(guard.canActivate(ok)).toBe(true);

    const bad = contextOf({
      method: "DELETE",
      headers: { referer: "https://evil.example/x" },
    });
    expect(() => guard.canActivate(bad)).toThrow(ForbiddenException);
  });
});
