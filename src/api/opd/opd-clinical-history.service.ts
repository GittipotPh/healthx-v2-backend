import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { RequestScope } from "../../auth/auth.types";
import { isIsoBusinessDate } from "../../common/business-date";
import {
  OpdVitalTrendMetric,
  type QueryCustomerExaminationHistoryDto,
  type QueryCustomerVitalTrendDto,
} from "./dto/opd-clinical-history.dto";
import {
  OpdExaminationHistoryItemView,
  OpdExaminationHistoryListResult,
  OpdVitalTrendResult,
  toOpdExaminationHistoryItemView,
  toOpdVitalTrendPointView,
  vitalTrendMetadata,
  type OpdClinicalHistoryDisplayContext,
} from "./opd-clinical-history.mapper";
import {
  OpdClinicalHistoryRepository,
  type OpdHistoryUserRecord,
} from "./opd-clinical-history.repository";

@Injectable()
export class OpdClinicalHistoryService {
  constructor(private readonly repository: OpdClinicalHistoryRepository) {}

  async listExaminations(
    customerId: string,
    query: QueryCustomerExaminationHistoryDto,
    scope: RequestScope,
  ): Promise<OpdExaminationHistoryListResult> {
    this.validateQuery(query);
    await this.assertCustomer(customerId, scope);
    const result = await this.repository.listCustomerExaminations(
      customerId,
      query,
      scope,
    );
    const userIds = new Set(result.recorderUserIds);
    for (const item of result.items) {
      userIds.add(item.recorder_user_id);
      if (item.examiner_user_id) userIds.add(item.examiner_user_id);
    }
    const display = await this.displayContext([...userIds], scope);
    return {
      items: result.items.map((item) =>
        toOpdExaminationHistoryItemView(item, display),
      ),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      facets: {
        recorders: result.recorderUserIds
          .map((userId) => ({
            userId,
            displayName: display.userDisplayNames.get(userId) ?? null,
          }))
          .sort((left, right) =>
            (left.displayName ?? "").localeCompare(
              right.displayName ?? "",
              "th",
            ),
          ),
      },
    };
  }

  async examination(
    customerId: string,
    examinationId: string,
    scope: RequestScope,
  ): Promise<OpdExaminationHistoryItemView> {
    await this.assertCustomer(customerId, scope);
    const row = await this.repository.findCustomerExamination(
      customerId,
      examinationId,
      scope,
    );
    if (!row) {
      throw new NotFoundException(
        "OPD examination not found for this customer and branch",
      );
    }
    const userIds = [row.recorder_user_id];
    if (row.examiner_user_id) userIds.push(row.examiner_user_id);
    const display = await this.displayContext(userIds, scope);
    return toOpdExaminationHistoryItemView(row, display);
  }

  async vitalTrend(
    customerId: string,
    query: QueryCustomerVitalTrendDto,
    scope: RequestScope,
  ): Promise<OpdVitalTrendResult> {
    this.validateQuery(query);
    await this.assertCustomer(customerId, scope);
    const metric = query.metric ?? OpdVitalTrendMetric.WEIGHT_KG;
    const result = await this.repository.listVitalTrend(
      customerId,
      query,
      scope,
    );
    const display = await this.displayContext(
      [...new Set(result.items.map((item) => item.recorder_user_id))],
      scope,
    );
    const metadata = vitalTrendMetadata(metric);
    return {
      metric,
      ...metadata,
      points: [...result.items]
        .reverse()
        .map((item) => toOpdVitalTrendPointView(item, metric, display)),
      // Reference rules are intentionally empty until the approved, versioned
      // catalog exists. The UI must not infer clinical ranges client-side.
      referenceRanges: [],
      total: result.total,
      limit: result.limit,
      truncated: result.total > result.limit,
    };
  }

  private validateQuery(
    query: QueryCustomerExaminationHistoryDto | QueryCustomerVitalTrendDto,
  ): void {
    if (query.dateFrom && !isIsoBusinessDate(query.dateFrom)) {
      throw new BadRequestException("dateFrom must be a valid YYYY-MM-DD date");
    }
    if (query.dateTo && !isIsoBusinessDate(query.dateTo)) {
      throw new BadRequestException("dateTo must be a valid YYYY-MM-DD date");
    }
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw new BadRequestException("dateFrom must not be after dateTo");
    }
    if (query.recorderUserId !== undefined && !query.recorderUserId.trim()) {
      throw new BadRequestException("recorderUserId must not be empty");
    }
  }

  private async assertCustomer(
    customerId: string,
    scope: RequestScope,
  ): Promise<void> {
    if (!(await this.repository.customerExists(customerId, scope))) {
      throw new NotFoundException("Customer not found for this clinic");
    }
  }

  private async displayContext(
    userIds: string[],
    scope: RequestScope,
  ): Promise<OpdClinicalHistoryDisplayContext> {
    const [branchName, users] = await Promise.all([
      this.repository.branchName(scope),
      this.repository.usersByIds([...new Set(userIds)], scope),
    ]);
    return {
      branchName,
      userDisplayNames: new Map(
        users.map((user) => [user.user_id, this.userDisplayName(user)]),
      ),
    };
  }

  private userDisplayName(user: OpdHistoryUserRecord): string {
    return (
      [user.name, user.lastname].filter(Boolean).join(" ").trim() ||
      user.nickname ||
      user.email
    );
  }
}
