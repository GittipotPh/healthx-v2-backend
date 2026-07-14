import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { constantTimeEquals } from "../../common/constant-time";
import { backendEnv } from "../../env";

const SERVICE_KEY_HEADER = "x-service-key";

/**
 * Guards the internal ERP command API with the x-service-key service
 * credential (plan-latest §4). This is a machine-to-machine surface: routes
 * using it are @Public() to skip the user JWT/scope guards, and this guard is
 * the only gate — a service key identifies the calling *system*
 * (erp-integration), never a person. Never accept a user JWT here
 * (rabbitmq plan §6).
 */
@Injectable()
export class ServiceKeyGuard implements CanActivate {
  private readonly logger = new Logger(ServiceKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const env = backendEnv();
    // Disabled capability = the surface does not exist (don't advertise it).
    if (!env.ERP_COMMAND_API_ENABLED || !env.ERP_SERVICE_KEY) {
      throw new NotFoundException("Not found");
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[SERVICE_KEY_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !constantTimeEquals(provided, env.ERP_SERVICE_KEY)) {
      this.logger.warn({
        event: "erp_command.service_key_rejected",
        path: request.path,
        hasKey: Boolean(provided),
      });
      throw new UnauthorizedException("Invalid service key");
    }
    return true;
  }
}
