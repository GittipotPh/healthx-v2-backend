import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { allowedOrigins } from "../../common/origins";

/** Methods that can mutate state and therefore need CSRF/origin protection. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Lightweight CSRF defense for cookie auth. For state-changing requests, the
 * `Origin` (or `Referer`) header must be a trusted frontend origin. Requests
 * without either header are allowed only when they are not carrying cookies
 * (for example token-based curl/Postman requests). Safe (GET/HEAD/OPTIONS)
 * requests are never blocked.
 *
 * Runs before authentication so a forged cross-site request is rejected before
 * any work happens.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed = allowedOrigins();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(request.method.toUpperCase())) return true;

    const origin = this.requestOrigin(request);
    if (!origin) {
      // Documented assumption (refactor-plan #4): a mutating request with no
      // Origin AND no Referer passes through *only if it carries no cookies*.
      // CSRF requires the browser to attach the victim's cookies, and every
      // current browser sends Origin (or at least Referer) on cross-site
      // state-changing requests — so a cookie-less header-less request can't
      // be a CSRF attempt; it's a non-browser client (curl/Postman/health
      // checks) that still has to pass authentication downstream. A request
      // that DOES carry cookies without an origin is rejected as suspect.
      if (request.headers.cookie) {
        throw new ForbiddenException("Missing request origin");
      }
      return true;
    }

    if (!this.allowed.includes(origin)) {
      throw new ForbiddenException("Request origin is not allowed");
    }
    return true;
  }

  /** The request's origin, derived from `Origin` or the `Referer` URL. */
  private requestOrigin(request: Request): string | undefined {
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin) return origin;

    const referer = request.headers.referer;
    if (typeof referer === "string" && referer) {
      try {
        return new URL(referer).origin;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
