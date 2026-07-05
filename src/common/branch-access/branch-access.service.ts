import { Injectable } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { record_status, role_enum, type_branch } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { RequestScope } from "../../auth/auth.types";

export class AccessibleBranch {
  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty({ enum: type_branch, enumName: "TypeBranch" })
  typeBranch!: type_branch;

  /** The user's role in this branch. null for a clinic-root user (full access). */
  @ApiProperty({
    enum: role_enum,
    enumName: "RoleEnum",
    nullable: true,
    description: "The user's role in this branch; null for a clinic-root user (full access)",
  })
  role!: role_enum | null;
}

@Injectable()
export class BranchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Branches the authenticated user can access within the validated clinic scope. */
  async findAccessibleBranches(scope: RequestScope): Promise<AccessibleBranch[]> {
    if (scope.isClinicRootUser) {
      const branches = await this.prisma.branch.findMany({
        where: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
        select: { branch_id: true, branch_name: true, type_branch: true },
        orderBy: [{ type_branch: "asc" }, { branch_name: "asc" }],
      });

      return branches.map((branch) => ({
        branchId: branch.branch_id,
        branchName: branch.branch_name,
        typeBranch: branch.type_branch,
        role: null,
      }));
    }

    const userBranches = await this.prisma.user_branch.findMany({
      where: {
        user_id: scope.userId,
        status: record_status.ACTIVE,
        branch: { clinic_id: scope.clinicId, status: record_status.ACTIVE },
      },
      select: {
        role_id: true,
        branch: { select: { branch_id: true, branch_name: true, type_branch: true } },
      },
      orderBy: { branch_id: "asc" },
    });

    return userBranches.map((userBranch) => ({
      branchId: userBranch.branch.branch_id,
      branchName: userBranch.branch.branch_name,
      typeBranch: userBranch.branch.type_branch,
      role: userBranch.role_id,
    }));
  }
}
