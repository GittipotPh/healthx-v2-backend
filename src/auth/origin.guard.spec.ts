import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { OriginGuard } from "./origin.guard";

const ALLOWED = "https://app.healthx-pro.com";

function contextOf(req: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("OriginGuard", () => {
  const ORIGINAL_ENV = { ...process.env };
  let guard: OriginGuard;

  beforeEach(() => {
    process.env.CORS_ORIGINS = ALLOWED;
    guard = new OriginGuard();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows safe GET requests regardless of origin", () => {
    expect(guard.canActivate(contextOf({ method: "GET", headers: {} }))).toBe(true);
  });

  it("allows mutating requests from a trusted origin", () => {
    const ctx = contextOf({ method: "POST", headers: { origin: ALLOWED } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("rejects mutating requests from an untrusted origin", () => {
    const ctx = contextOf({ method: "POST", headers: { origin: "https://evil.example" } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("allows mutating requests with no Origin/Referer (non-browser clients)", () => {
    expect(guard.canActivate(contextOf({ method: "POST", headers: {} }))).toBe(true);
  });

  it("derives the origin from the Referer header", () => {
    const ok = contextOf({ method: "DELETE", headers: { referer: `${ALLOWED}/queue` } });
    expect(guard.canActivate(ok)).toBe(true);

    const bad = contextOf({ method: "DELETE", headers: { referer: "https://evil.example/x" } });
    expect(() => guard.canActivate(bad)).toThrow(ForbiddenException);
  });
});
