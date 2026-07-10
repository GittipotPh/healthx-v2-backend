import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { QUEUE_STEP_COLUMNS } from "../queue.mapper";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * Roles selectable in the queue permissions matrix. Superset of `role_enum`
 * plus the prototype's "CASHIER", which has no `role_enum` counterpart yet —
 * reconcile when the permissions matrix becomes enforced (see refactor-plan).
 */
export const QUEUE_PERMISSION_ROLES = [
  "ADMIN",
  "CLINIC_OWNER",
  "MANAGER",
  "DOCTOR",
  "THERAPIST",
  "NURSE",
  "SALE",
  "ACCOUNTANT",
  "MAINTAINER",
  "MARKETING",
  "HR",
  "PURCHASER",
  "INVENTORY",
  "CASHIER",
] as const;

export class QueueColumnSettingDto {
  @ApiProperty({ enum: QUEUE_STEP_COLUMNS, description: "Kanban column id (seeded step catalog)" })
  @IsString()
  @IsIn(QUEUE_STEP_COLUMNS)
  id!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  label!: string;

  @ApiProperty({ description: "Hex color, e.g. #DBEAFE", pattern: HEX_COLOR.source })
  @IsString()
  @Matches(HEX_COLOR, { message: "color must be a #RRGGBB hex value" })
  color!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  order!: number;

  @ApiProperty()
  @IsBoolean()
  isRequired!: boolean;

  @ApiProperty()
  @IsBoolean()
  canSkip!: boolean;

  @ApiProperty()
  @IsBoolean()
  isEndStep!: boolean;
}

export class QueueSlaSettingDto {
  @ApiProperty({ enum: QUEUE_STEP_COLUMNS })
  @IsString()
  @IsIn(QUEUE_STEP_COLUMNS)
  columnId!: string;

  @ApiProperty({ minimum: 0, maximum: 1440, description: "0 = off" })
  @IsInt()
  @Min(0)
  @Max(1440)
  warningMinutes!: number;

  @ApiProperty({ minimum: 0, maximum: 1440, description: "0 = off" })
  @IsInt()
  @Min(0)
  @Max(1440)
  criticalMinutes!: number;

  @ApiProperty()
  @IsBoolean()
  colorChange!: boolean;

  @ApiProperty()
  @IsBoolean()
  notify!: boolean;
}

export class QueueCompletedTransitionRuleDto {
  @ApiProperty()
  @IsBoolean()
  requiresPayment!: boolean;

  @ApiProperty()
  @IsBoolean()
  requiresOPD!: boolean;

  @ApiProperty()
  @IsBoolean()
  requiresCourse!: boolean;

  @ApiProperty()
  @IsBoolean()
  requiresMedicine!: boolean;
}

export class QueueInServiceTransitionRuleDto {
  @ApiProperty()
  @IsBoolean()
  requiresPayment!: boolean;

  @ApiProperty()
  @IsBoolean()
  requiresAnesthetic!: boolean;

  @ApiProperty()
  @IsBoolean()
  requiresDoctor!: boolean;
}

export class QueueTransitionsSettingDto {
  @ApiProperty({ type: QueueCompletedTransitionRuleDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueCompletedTransitionRuleDto)
  completed!: QueueCompletedTransitionRuleDto;

  @ApiProperty({ type: QueueInServiceTransitionRuleDto, name: "in-service" })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueInServiceTransitionRuleDto)
  "in-service"!: QueueInServiceTransitionRuleDto;
}

export class QueueAnestheticAutomationDto {
  @ApiProperty()
  @IsBoolean()
  notifyStaff!: boolean;

  @ApiProperty()
  @IsBoolean()
  changeStatusReady!: boolean;

  @ApiProperty()
  @IsBoolean()
  autoMoveToInService!: boolean;
}

export class QueueAutomationSettingDto {
  @ApiProperty({ enum: QUEUE_STEP_COLUMNS, description: "Column a new queue card starts in" })
  @IsString()
  @IsIn(QUEUE_STEP_COLUMNS)
  defaultColumn!: string;

  @ApiProperty()
  @IsBoolean()
  autoOpenServicePopup!: boolean;

  @ApiProperty()
  @IsBoolean()
  autoAssignDoctor!: boolean;

  @ApiProperty()
  @IsBoolean()
  autoAssignRoom!: boolean;

  // Required, not optional: saves are full-replace, so omitting this section
  // would silently wipe it (the old shapeless DTO allowed exactly that bug).
  @ApiProperty({ type: QueueAnestheticAutomationDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueAnestheticAutomationDto)
  anesthetic!: QueueAnestheticAutomationDto;
}

export class QueueTrackingSettingDto {
  @ApiProperty()
  @IsBoolean()
  trackTimeIn!: boolean;

  @ApiProperty()
  @IsBoolean()
  trackTimeOut!: boolean;

  @ApiProperty()
  @IsBoolean()
  autoCalculateDuration!: boolean;

  @ApiProperty()
  @IsBoolean()
  trackActionBy!: boolean;

  @ApiProperty()
  @IsBoolean()
  showTimeline!: boolean;

  @ApiProperty()
  @IsBoolean()
  useForReports!: boolean;

  @ApiProperty()
  @IsBoolean()
  allowManualOverride!: boolean;

  @ApiProperty()
  @IsBoolean()
  requireReason!: boolean;

  @ApiProperty()
  @IsBoolean()
  showActionOwnerOnCard!: boolean;

  @ApiProperty()
  @IsBoolean()
  showRoleOnCard!: boolean;

  @ApiProperty()
  @IsBoolean()
  showTimeOnCard!: boolean;

  @ApiProperty()
  @IsBoolean()
  auditLog!: boolean;

  @ApiProperty()
  @IsBoolean()
  preventEdit!: boolean;
}

export class QueueNotificationDetailDto {
  @ApiProperty()
  @IsBoolean()
  notifyStaff!: boolean;

  @ApiProperty()
  @IsBoolean()
  notifyDoctor!: boolean;

  @ApiProperty()
  @IsBoolean()
  notifyManager!: boolean;

  @ApiProperty()
  @IsBoolean()
  notifyLine!: boolean;

  @ApiProperty()
  @IsBoolean()
  sound!: boolean;

  @ApiProperty()
  @IsBoolean()
  popup!: boolean;
}

export class QueueNotificationsSettingDto {
  @ApiProperty({ type: QueueNotificationDetailDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueNotificationDetailDto)
  late!: QueueNotificationDetailDto;

  @ApiProperty({ type: QueueNotificationDetailDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueNotificationDetailDto)
  arrived!: QueueNotificationDetailDto;

  @ApiProperty({ type: QueueNotificationDetailDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueNotificationDetailDto)
  turn!: QueueNotificationDetailDto;

  @ApiProperty({ type: QueueNotificationDetailDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueNotificationDetailDto)
  anesthetic!: QueueNotificationDetailDto;

  @ApiProperty({ type: QueueNotificationDetailDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueNotificationDetailDto)
  payment!: QueueNotificationDetailDto;
}

/**
 * Full-replace save of a branch's queue configuration. Scope (clinic/branch)
 * and the actor come from the request, never from this body. Cross-field rules
 * class-validator can't express (unique column ids, sla/defaultColumn referencing
 * existing columns, permission keys/roles) are enforced in QueueService.
 */
export class SaveQueueConfigDto {
  @ApiProperty({ type: [QueueColumnSettingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QueueColumnSettingDto)
  columns!: QueueColumnSettingDto[];

  @ApiProperty({ type: [QueueSlaSettingDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QueueSlaSettingDto)
  sla!: QueueSlaSettingDto[];

  @ApiProperty({ type: QueueTransitionsSettingDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueTransitionsSettingDto)
  transitions!: QueueTransitionsSettingDto;

  @ApiProperty({ type: QueueAutomationSettingDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueAutomationSettingDto)
  automation!: QueueAutomationSettingDto;

  @ApiProperty({ type: QueueTrackingSettingDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueTrackingSettingDto)
  tracking!: QueueTrackingSettingDto;

  @ApiProperty({ type: QueueNotificationsSettingDto })
  @IsObject()
  @ValidateNested()
  @Type(() => QueueNotificationsSettingDto)
  notifications!: QueueNotificationsSettingDto;

  // Record keyed by column id; keys and role values are validated in the
  // service against QUEUE_STEP_COLUMNS / QUEUE_PERMISSION_ROLES.
  @ApiProperty({
    type: "object",
    additionalProperties: { type: "array", items: { type: "string", enum: [...QUEUE_PERMISSION_ROLES] } },
    description: "Column id -> roles allowed to act on that column",
  })
  @IsObject()
  permissions!: Record<string, string[]>;
}
