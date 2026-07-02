import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { AUTH_COOKIE_NAME } from "../auth.cookie";
import { IS_PUBLIC_KEY } from "../scope.decorator";
import type { JwtPrincipalPayload, Principal } from "../auth.types";

/**
 * Verifies the access token and attaches the authenticated `principal`
 * (email/name) to the request. The token is taken from `Authorization: Bearer`
 * (for curl/Postman/testing) or, failing that, the HttpOnly `hx_token` cookie
 * (the browser flow). Public routes are skipped via `@Public()`. Runs before
 * ScopeGuard.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: Principal; cookies?: Record<string, string> }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException("Missing access token");

    try {
      const payload = await this.jwtService.verifyAsync<JwtPrincipalPayload>(token);
      request.principal = { email: payload.email, name: payload.name };
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
    return true;
  }

  private extractToken(
    request: Request & { cookies?: Record<string, string> },
  ): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    if (type === "Bearer" && token) return token;
    return request.cookies?.[AUTH_COOKIE_NAME];
  }
}
