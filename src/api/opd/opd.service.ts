import { Injectable } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { OpdRepository } from "./opd.repository";
import { OpdView, toOpdView } from "./opd.mapper";
import type { QueryOpdDto } from "./dto/query-opd.dto";
import type { RequestScope } from "../../auth/auth.types";

export class OpdListResult {
  @ApiProperty({ type: [OpdView] })
  items!: OpdView[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
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

  async historyByCustomer(customerId: string, scope: RequestScope): Promise<OpdView[]> {
    const rows = await this.repository.findHistoryByCustomer(customerId, scope);
    return rows.map(toOpdView);
  }
}
