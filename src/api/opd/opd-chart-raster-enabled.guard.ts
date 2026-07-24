import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { backendEnv } from "../../env";

/** Deployment kill switch for only raster Chart writes/finalization. */
@Injectable()
export class OpdChartRasterEnabledGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (!backendEnv().OPD_CHART_RASTER_AUTOSAVE_ENABLED) {
      throw new ServiceUnavailableException(
        "OPD Chart raster persistence is temporarily disabled by deployment configuration",
      );
    }
    return true;
  }
}
