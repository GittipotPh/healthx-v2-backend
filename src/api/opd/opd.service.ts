import { Injectable } from "@nestjs/common";
import { OpdRepository } from "./opd.repository";
import { type OpdView, toOpdView } from "./opd.mapper";
import type { QueryOpdDto } from "./dto/query-opd.dto";

export interface OpdListResult {
  items: OpdView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OpdService {
  constructor(private readonly repository: OpdRepository) {}

  async list(query: QueryOpdDto): Promise<OpdListResult> {
    const result = await this.repository.findMany(query);
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
