import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiParam, ApiTags } from "@nestjs/swagger";
import { OpdService, OpdListResult } from "./opd.service";
import { OpdView } from "./opd.mapper";
import { QueryOpdDto } from "./dto/query-opd.dto";
import { StartOpdDto } from "./dto/start-opd.dto";
import { OpdWorkspaceView, StartOpdResult } from "./opd-v2.mapper";
import { QueryQueueDto } from "../queue/dto/query-queue.dto";
import { QueueService, QueueTodayResult } from "../queue/queue.service";
import {
  BaseOpenApiArrayResponse,
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import { CurrentPrincipal, Scope } from "../../auth/scope.decorator";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { RequirePermissions } from "../../auth/permissions.decorator";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD")
@BaseOpenApiErrorResponses()
@Controller("clinic/opd")
export class OpdController {
  constructor(
    private readonly opdService: OpdService,
    private readonly queueService: QueueService,
  ) {}

  @Get()
  @RequirePermissions("OPD_READ")
  @BaseOpenApiResponse(OpdListResult)
  list(
    @Query() query: QueryOpdDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdListResult> {
    return this.opdService.list(query, scope);
  }

  @Get("history/:customerId")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiArrayResponse(OpdView)
  history(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdView[]> {
    return this.opdService.historyByCustomer(customerId, scope);
  }

  @Post("start")
  @UseGuards(OpdV2EnabledGuard)
  @RequirePermissions("OPD_CREATE")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "8-200 character command key; reuse the same key when retrying the same start",
  })
  @BaseOpenApiResponse(StartOpdResult, { status: 201 })
  start(
    @Body() dto: StartOpdDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Scope() scope: RequestScope,
    @CurrentPrincipal() principal: Principal,
  ): Promise<StartOpdResult> {
    return this.opdService.start(dto, idempotencyKey, scope, principal);
  }

  @Get("worklist")
  @UseGuards(OpdV2EnabledGuard)
  @RequirePermissions("OPD_READ")
  @BaseOpenApiResponse(QueueTodayResult)
  worklist(
    @Query() query: QueryQueueDto,
    @Scope() scope: RequestScope,
  ): Promise<QueueTodayResult> {
    return this.queueService.today(query, scope);
  }

  @Get(":encounterId/workspace")
  @UseGuards(OpdV2EnabledGuard)
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "encounterId" })
  @BaseOpenApiResponse(OpdWorkspaceView)
  workspace(
    @Param("encounterId") encounterId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdWorkspaceView> {
    return this.opdService.workspace(encounterId, scope);
  }
}
