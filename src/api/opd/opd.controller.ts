import { Controller, Get, Param, Query } from "@nestjs/common";
import { OpdService, type OpdListResult } from "./opd.service";
import type { OpdView } from "./opd.mapper";
import { QueryOpdDto } from "./dto/query-opd.dto";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@Controller("clinic/opd")
export class OpdController {
  constructor(private readonly opdService: OpdService) {}

  @Get()
  list(@Query() query: QueryOpdDto, @Scope() scope: RequestScope): Promise<OpdListResult> {
    return this.opdService.list(query, scope);
  }

  @Get("history/:customerId")
  history(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<OpdView[]> {
    return this.opdService.historyByCustomer(customerId, scope);
  }
}
