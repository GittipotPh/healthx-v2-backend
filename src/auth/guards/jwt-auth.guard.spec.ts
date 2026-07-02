import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { JwtService } from "@nestjs/jwt";
import { JwtAuthGuard } from "./jwt-auth.guard";

interface MockRequest {
  headers: Record<string, string>;
  cookies?: Record<string, string>;
  principal?: { email: string; name: string };
}

function contextOf(req: MockRequest): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard", () => {
  let reflector: Reflector;
  let jwt: JwtService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
    jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ email: "a@b.com", name: "Ann" }),
    } as unknown as JwtService;
    guard = new JwtAuthGuard(reflector, jwt);
  });

  it("skips auth for @Public routes", async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValueOnce(true);
    await expect(guard.canActivate(contextOf({ headers: {} }))).resolves.toBe(true);
  });

  it("authenticates a Bearer token and attaches the principal", async () => {
    const req: MockRequest = { headers: { authorization: "Bearer good" } };
    await expect(guard.canActivate(contextOf(req))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith("good");
    expect(req.principal).toEqual({ email: "a@b.com", name: "Ann" });
  });

  it("falls back to the hx_token cookie when no Bearer header is present", async () => {
    const req: MockRequest = { headers: {}, cookies: { hx_token: "cookie-tok" } };
    await expect(guard.canActivate(contextOf(req))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith("cookie-tok");
  });

  it("rejects when no token is present", async () => {
    await expect(guard.canActivate(contextOf({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects an invalid/expired token", async () => {
    (jwt.verifyAsync as jest.Mock).mockRejectedValueOnce(new Error("bad"));
    const req: MockRequest = { headers: {}, cookies: { hx_token: "expired" } };
    await expect(guard.canActivate(contextOf(req))).rejects.toThrow(UnauthorizedException);
  });
});
