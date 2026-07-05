import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiParam, ApiTags } from "@nestjs/swagger";
import { CustomersService, CustomerListResult } from "./customers.service";
import { CustomerView } from "./customers.mapper";
import { QueryCustomersDto } from "./dto/query-customers.dto";
import {
  BaseOpenApiErrorResponses,
  BaseOpenApiResponse,
} from "../../common/openapi/api-envelope";
import { Scope } from "../../auth/scope.decorator";
import type { RequestScope } from "../../auth/auth.types";

@ApiTags("Customers")
@BaseOpenApiErrorResponses()
@Controller("clinic/customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @BaseOpenApiResponse(CustomerListResult)
  list(
    @Query() query: QueryCustomersDto,
    @Scope() scope: RequestScope,
  ): Promise<CustomerListResult> {
    return this.customersService.list(query, scope);
  }

  @Get(":customerId")
  @ApiParam({ name: "customerId" })
  @BaseOpenApiResponse(CustomerView)
  detail(
    @Param("customerId") customerId: string,
    @Scope() scope: RequestScope,
  ): Promise<CustomerView> {
    return this.customersService.detail(customerId, scope.clinicId);
  }
}
