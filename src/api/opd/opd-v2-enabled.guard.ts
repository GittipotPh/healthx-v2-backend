import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { backendEnv } from "../../env";

/** Deployment kill switch for only the new OPD V2 operational surface. */
@Injectable()
export class OpdV2EnabledGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (!backendEnv().OPD_V2_ENABLED) {
      throw new ServiceUnavailableException(
        "OPD V2 is temporarily disabled by deployment configuration",
      );
    }
    return true;
  }
}
