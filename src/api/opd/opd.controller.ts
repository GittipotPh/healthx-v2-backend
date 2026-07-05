import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiParam, ApiTags } from "@nestjs/swagger";
import { OpdService, OpdListResult } from "./opd.service";
import { OpdView } from "./opd.mapper";
import { QueryOpdDto } from "./dto/query-opd.dto";
import {
  BaseOpenApiArrayResponse,
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@ApiTags("OPD")
@BaseOpenApiErrorResponses()
@Controller("clinic/opd")
export class OpdController {
  constructor(private readonly opdService: OpdService) {}

  @Get()
  @BaseOpenApiResponse(OpdListResult)
  list(@Query() query: QueryOpdDto, @Scope() scope: RequestScope): Promise<OpdListResult> {
    return this.opdService.list(query, scope);
  }

  @Get("history/:customerId")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiArrayResponse(OpdView)
  history(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdView[]> {
    return this.opdService.historyByCustomer(customerId, scope);
  }
}
