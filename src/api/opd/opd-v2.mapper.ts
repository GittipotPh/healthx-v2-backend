import { ApiProperty } from "@nestjs/swagger";
import { QueueItemView } from "../queue/queue.mapper";

export class StartOpdResult {
  @ApiProperty()
  encounterId!: string;

  @ApiProperty()
  queueTicketId!: string;

  @ApiProperty()
  legacyOpdId!: string;

  @ApiProperty({ type: String, nullable: true })
  appointmentId!: string | null;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  workflowStatus!: string;

  @ApiProperty()
  clinicalRecordStatus!: string;

  @ApiProperty({ description: "Bangkok business date (YYYY-MM-DD)" })
  businessDate!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({
    description: "true when the command returned an already-created encounter",
  })
  resumed!: boolean;
}

export class OpdWorklistItemView extends QueueItemView {
  @ApiProperty({
    type: String,
    nullable: false,
    description: "Stable app-owned queue ticket identity required by OPD V2",
  })
  declare queueTicketId: string;
}

export class OpdWorklistFacetsView {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  appointments!: number;

  @ApiProperty()
  walkIns!: number;

  @ApiProperty({ type: "object", additionalProperties: { type: "number" } })
  byStep!: Record<string, number>;
}

export class OpdWorklistResult {
  @ApiProperty({ description: "Bangkok business date (YYYY-MM-DD)" })
  date!: string;

  @ApiProperty({ type: [OpdWorklistItemView] })
  items!: OpdWorklistItemView[];

  @ApiProperty({ type: OpdWorklistFacetsView })
  facets!: OpdWorklistFacetsView;
}

export class OpdWorkspaceContextView {
  @ApiProperty()
  encounterId!: string;

  @ApiProperty()
  queueTicketId!: string;

  @ApiProperty()
  legacyOpdId!: string;

  @ApiProperty({ type: String, nullable: true })
  appointmentId!: string | null;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  clinicId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ type: String, nullable: true })
  attendingUserId!: string | null;

  @ApiProperty()
  workflowStatus!: string;

  @ApiProperty()
  clinicalRecordStatus!: string;

  @ApiProperty({ description: "Bangkok business date (YYYY-MM-DD)" })
  businessDate!: string;

  @ApiProperty()
  version!: number;
}

export class OpdWorkspacePatientView {
  @ApiProperty()
  customerId!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  gender!: string | null;

  @ApiProperty({ type: String, nullable: true })
  birthDate!: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Unverified legacy customer.personal_id compatibility display value",
  })
  hn!: string | null;

  @ApiProperty({ enum: ["LEGACY_PERSONAL_ID_UNVERIFIED"], nullable: true })
  identifierSource!: "LEGACY_PERSONAL_ID_UNVERIFIED" | null;
}

export class OpdWorkspaceSafetyView {
  @ApiProperty({ type: String, nullable: true })
  legacyAllergy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  legacyCondition!: string | null;

  @ApiProperty({ enum: ["LEGACY_CUSTOMER_INFO_UNVERIFIED"] })
  source!: "LEGACY_CUSTOMER_INFO_UNVERIFIED";
}

export class OpdWorkspaceQueueView {
  @ApiProperty()
  queueTicketId!: string;

  @ApiProperty({ type: String, nullable: true })
  legacyQueueStatusId!: string | null;

  @ApiProperty()
  displayNumber!: string;

  @ApiProperty()
  currentStep!: string;

  @ApiProperty({ description: "ISO timestamp" })
  enteredAt!: string;

  @ApiProperty({ type: String, nullable: true })
  appointmentStatus!: string | null;

  @ApiProperty({ type: String, nullable: true })
  appointmentDate!: string | null;

  @ApiProperty({ type: String, nullable: true })
  appointmentStartTime!: string | null;

  @ApiProperty({ type: String, nullable: true })
  room!: string | null;

  @ApiProperty()
  version!: number;
}

export class OpdWorkspaceLegacyVitalsView {
  @ApiProperty({ type: Number, nullable: true })
  temperature!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  bloodPressureLegacy!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  pulse!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  respiratoryRate!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  bmi!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  weight!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;

  @ApiProperty({ enum: ["LEGACY_OPD_COMPATIBILITY"] })
  source!: "LEGACY_OPD_COMPATIBILITY";
}

export class OpdWorkspaceView {
  @ApiProperty({ type: OpdWorkspaceContextView })
  context!: OpdWorkspaceContextView;

  @ApiProperty({ type: OpdWorkspacePatientView })
  patient!: OpdWorkspacePatientView;

  @ApiProperty({ type: OpdWorkspaceSafetyView })
  safety!: OpdWorkspaceSafetyView;

  @ApiProperty({ type: OpdWorkspaceQueueView })
  queue!: OpdWorkspaceQueueView;

  @ApiProperty({ type: OpdWorkspaceLegacyVitalsView, nullable: true })
  latestVitals!: OpdWorkspaceLegacyVitalsView | null;
}
