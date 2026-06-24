import { Controller, Get, Param, Query } from "@nestjs/common";
import { CustomersService, type CustomerListResult } from "./customers.service";
import type { CustomerView } from "./customers.mapper";
import { QueryCustomersDto } from "./dto/query-customers.dto";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@Controller("clinic/customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(
    @Query() query: QueryCustomersDto,
    @Scope() scope: RequestScope,
  ): Promise<CustomerListResult> {
    return this.customersService.list(query, scope);
  }

  @Get(":customerId")
  detail(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerView> {
    return this.customersService.detail(customerId, scope.clinicId);
  }
}
