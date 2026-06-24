import { Injectable } from "@nestjs/common";
import { record_status, type type_branch } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { RequestScope } from "../../auth/auth.types";

export interface BranchView {
  branchId: string;
  branchName: string;
  typeBranch: type_branch;
}

@Injectable()
export class ClinicService {
  constructor(private readonly prisma: PrismaService) {}

  /** Branches the authenticated user can enter within the validated clinic scope. */
  async branches(scope: RequestScope): Promise<BranchView[]> {
    if (scope.isClinicRootUser) {
      const branches = await this.prisma.branch.findMany({
        where: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
        select: { branch_id: true, branch_name: true, type_branch: true },
        orderBy: { type_branch: "asc" },
      });
      return branches.map((branch) => ({
        branchId: branch.branch_id,
        branchName: branch.branch_name,
        typeBranch: branch.type_branch,
      }));
    }

    const userBranches = await this.prisma.user_branch.findMany({
      where: {
        user_id: scope.userId,
        status: record_status.ACTIVE,
        branch: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
      },
      select: {
        branch: { select: { branch_id: true, branch_name: true, type_branch: true } },
      },
    });
    return userBranches.map((userBranch) => ({
      branchId: userBranch.branch.branch_id,
      branchName: userBranch.branch.branch_name,
      typeBranch: userBranch.branch.type_branch,
    }));
  }
}
