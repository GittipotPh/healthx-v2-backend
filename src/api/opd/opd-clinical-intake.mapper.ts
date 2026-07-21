import { ApiProperty } from "@nestjs/swagger";
import type { opd_intake } from "@prisma/client";
import { OpdBowelStatus, OpdUrinaryStatus } from "./dto/opd-intake.dto";

export class OpdIntakeView {
  @ApiProperty({ type: String, nullable: true })
  intakeId!: string | null;

  @ApiProperty()
  examinationId!: string;

  @ApiProperty({ enum: OpdUrinaryStatus, nullable: true })
  urinaryStatus!: OpdUrinaryStatus | null;

  @ApiProperty({ type: String, nullable: true })
  urinaryOtherText!: string | null;

  @ApiProperty({ enum: OpdBowelStatus, nullable: true })
  bowelStatus!: OpdBowelStatus | null;

  @ApiProperty({ type: String, nullable: true })
  bowelOtherText!: string | null;

  @ApiProperty({ minimum: 0 })
  version!: number;

  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  updatedBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  createdAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  updatedAt!: string | null;
}

export function toOpdIntakeView(
  row: opd_intake | null,
  examinationId: string,
): OpdIntakeView {
  if (!row) {
    return {
      intakeId: null,
      examinationId,
      urinaryStatus: null,
      urinaryOtherText: null,
      bowelStatus: null,
      bowelOtherText: null,
      version: 0,
      createdBy: null,
      updatedBy: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    intakeId: row.intake_id,
    examinationId: row.examination_id,
    urinaryStatus: urinaryStatus(row.urinary_status),
    urinaryOtherText: row.urinary_other_text,
    bowelStatus: bowelStatus(row.bowel_status),
    bowelOtherText: row.bowel_other_text,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function urinaryStatus(value: string): OpdUrinaryStatus {
  switch (value) {
    case OpdUrinaryStatus.NORMAL:
    case OpdUrinaryStatus.DYSURIA:
    case OpdUrinaryStatus.FREQUENCY:
    case OpdUrinaryStatus.RETENTION:
    case OpdUrinaryStatus.OTHER:
      return value;
    default:
      throw new Error(`Unknown OPD urinary status: ${value}`);
  }
}

function bowelStatus(value: string): OpdBowelStatus {
  switch (value) {
    case OpdBowelStatus.NORMAL:
    case OpdBowelStatus.CONSTIPATION:
    case OpdBowelStatus.DIARRHEA:
    case OpdBowelStatus.NO_BOWEL_MOVEMENT:
    case OpdBowelStatus.OTHER:
      return value;
    default:
      throw new Error(`Unknown OPD bowel status: ${value}`);
  }
}
