import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { OpdService, type OpdListResult } from "./opd.service";
import type { OpdView } from "./opd.mapper";
import { QueryOpdDto } from "./dto/query-opd.dto";

@Controller("clinic/opd")
export class OpdController {
  constructor(private readonly opdService: OpdService) {}

  @Get()
  list(@Query() query: QueryOpdDto): Promise<OpdListResult> {
    return this.opdService.list(query);
  }

  @Get("history/:customerId")
  history(
    @Param("customerId") customerId: string,
    @Query("clinicId") clinicId?: string,
  ): Promise<OpdView[]> {
    if (!clinicId) {
      throw new BadRequestException("clinicId query parameter is required");
    }
    return this.opdService.historyByCustomer(customerId, clinicId);
  }
}
