import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiParam, ApiTags } from "@nestjs/swagger";
import type { RequestScope } from "../../auth/auth.types";
import { RequirePermissions } from "../../auth/permissions.decorator";
import { Scope } from "../../auth/scope.decorator";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import {
  QueryCustomerExaminationHistoryDto,
  QueryCustomerVitalTrendDto,
} from "./dto/opd-clinical-history.dto";
import {
  OpdExaminationHistoryItemView,
  OpdExaminationHistoryListResult,
  OpdVitalTrendResult,
} from "./opd-clinical-history.mapper";
import { OpdClinicalHistoryService } from "./opd-clinical-history.service";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@ApiTags("OPD Clinical History")
@BaseOpenApiErrorResponses()
@UseGuards(OpdV2EnabledGuard)
@Controller("clinic/customers")
export class OpdClinicalHistoryController {
  constructor(
    private readonly clinicalHistoryService: OpdClinicalHistoryService,
  ) {}

  @Get(":customerId/examinations")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiResponse(OpdExaminationHistoryListResult)
  listExaminations(
    @Param("customerId") customerId: string,
    @Query() query: QueryCustomerExaminationHistoryDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdExaminationHistoryListResult> {
    return this.clinicalHistoryService.listExaminations(
      customerId,
      query,
      scope,
    );
  }

  @Get(":customerId/examinations/trends")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiResponse(OpdVitalTrendResult)
  vitalTrend(
    @Param("customerId") customerId: string,
    @Query() query: QueryCustomerVitalTrendDto,
    @Scope() scope: RequestScope,
  ): Promise<OpdVitalTrendResult> {
    return this.clinicalHistoryService.vitalTrend(customerId, query, scope);
  }

  @Get(":customerId/examinations/:examinationId")
  @RequirePermissions("OPD_READ")
  @ApiParam({ name: "customerId" })
  @ApiParam({ name: "examinationId", format: "uuid" })
  @BaseOpenApiResponse(OpdExaminationHistoryItemView)
  examination(
    @Param("customerId") customerId: string,
    @Param("examinationId", new ParseUUIDPipe()) examinationId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdExaminationHistoryItemView> {
    return this.clinicalHistoryService.examination(
      customerId,
      examinationId,
      scope,
    );
  }
}
