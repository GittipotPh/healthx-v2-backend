import { Injectable } from "@nestjs/common";
import { Prisma, type opd_intake } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import type { OpdBowelStatus, OpdUrinaryStatus } from "./dto/opd-intake.dto";

type DatabaseClient = Prisma.TransactionClient | PrismaService;
type IntakeCreateClient = {
  opd_intake: Pick<Prisma.TransactionClient["opd_intake"], "create">;
};
type IntakeUpdateClient = {
  opd_intake: Pick<Prisma.TransactionClient["opd_intake"], "updateMany">;
};

export interface OpdIntakeWriteData {
  urinaryStatus: OpdUrinaryStatus;
  urinaryOtherText: string | null;
  bowelStatus: OpdBowelStatus;
  bowelOtherText: string | null;
}

@Injectable()
export class OpdClinicalIntakeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findIntake(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd_intake | null> {
    return client.opd_intake.findFirst({
      where: {
        examination_id: examinationId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
  }

  createIntake(
    encounterId: string,
    examinationId: string,
    data: OpdIntakeWriteData,
    scope: RequestScope,
    now: Date,
    tx: IntakeCreateClient,
  ): Promise<opd_intake> {
    return tx.opd_intake.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        examination_id: examinationId,
        urinary_status: data.urinaryStatus,
        urinary_other_text: data.urinaryOtherText,
        bowel_status: data.bowelStatus,
        bowel_other_text: data.bowelOtherText,
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async updateIntake(
    intakeId: string,
    encounterId: string,
    examinationId: string,
    expectedVersion: number,
    data: OpdIntakeWriteData,
    scope: RequestScope,
    now: Date,
    tx: IntakeUpdateClient,
  ): Promise<number> {
    const updated = await tx.opd_intake.updateMany({
      where: {
        intake_id: intakeId,
        examination_id: examinationId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        version: expectedVersion,
      },
      data: {
        urinary_status: data.urinaryStatus,
        urinary_other_text: data.urinaryOtherText,
        bowel_status: data.bowelStatus,
        bowel_other_text: data.bowelOtherText,
        version: { increment: 1 },
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return updated.count;
  }
}
