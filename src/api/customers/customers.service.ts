import { Injectable, NotFoundException } from "@nestjs/common";
import { CustomersRepository } from "./customers.repository";
import { type CustomerView, toCustomerView } from "./customers.mapper";
import type { QueryCustomersDto } from "./dto/query-customers.dto";
import type { RequestScope } from "../../auth/auth.types";

export interface CustomerListResult {
  items: CustomerView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  async list(query: QueryCustomersDto, scope: RequestScope): Promise<CustomerListResult> {
    const result = await this.repository.findMany(query, scope);
    return {
      items: result.items.map(toCustomerView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async detail(customerId: string, clinicId: string): Promise<CustomerView> {
    const found = await this.repository.findOne(customerId, clinicId);
    if (!found) {
      throw new NotFoundException("Customer not found");
    }
    return toCustomerView(found);
  }
}
