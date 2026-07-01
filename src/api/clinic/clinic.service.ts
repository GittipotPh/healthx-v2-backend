import { Injectable } from "@nestjs/common";
import { BranchAccessService, type AccessibleBranch } from "../../common/branch-access/branch-access.service";
import type { RequestScope } from "../../auth/auth.types";

export type BranchView = AccessibleBranch;

@Injectable()
export class ClinicService {
  constructor(private readonly branchAccessService: BranchAccessService) {}

  /** Branches the authenticated user can enter within the validated clinic scope. */
  branches(scope: RequestScope): Promise<BranchView[]> {
    return this.branchAccessService.findAccessibleBranches(scope);
  }
}
