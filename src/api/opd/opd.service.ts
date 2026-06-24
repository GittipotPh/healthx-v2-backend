import { Injectable } from "@nestjs/common";
import { OpdRepository } from "./opd.repository";
import { type OpdView, toOpdView } from "./opd.mapper";
import type { QueryOpdDto } from "./dto/query-opd.dto";
import type { RequestScope } from "../../auth/auth.types";

export interface OpdListResult {
  items: OpdView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OpdService {
  constructor(private readonly repository: OpdRepository) {}

  async list(query: QueryOpdDto, scope: RequestScope): Promise<OpdListResult> {
    const result = await this.repository.findMany(query, scope);
    return {
      items: result.items.map(toOpdView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async historyByCustomer(customerId: string, clinicId: string): Promise<OpdView[]> {
    const rows = await this.repository.findHistoryByCustomer(customerId, clinicId);
    return rows.map(toOpdView);
  }
}
