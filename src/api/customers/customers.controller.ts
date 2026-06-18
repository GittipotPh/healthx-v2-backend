import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { CustomersService, type CustomerListResult } from "./customers.service";
import type { CustomerView } from "./customers.mapper";
import { QueryCustomersDto } from "./dto/query-customers.dto";

@Controller("clinic/customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(@Query() query: QueryCustomersDto): Promise<CustomerListResult> {
    return this.customersService.list(query);
  }

  @Get(":customerId")
  detail(
    @Param("customerId") customerId: string,
    @Query("clinicId") clinicId?: string,
  ): Promise<CustomerView> {
    if (!clinicId) {
      throw new BadRequestException("clinicId query parameter is required");
    }
    return this.customersService.detail(customerId, clinicId);
  }
}
