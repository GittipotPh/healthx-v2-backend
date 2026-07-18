import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import {
  auditReferenceType,
  Prisma,
  statusAppointment,
  type opd_queue_ticket,
} from "@prisma/client";
import { OpdRepository } from "./opd.repository";
import { OpdView, toOpdView } from "./opd.mapper";
import type { QueryOpdDto } from "./dto/query-opd.dto";
import type { StartOpdDto } from "./dto/start-opd.dto";
import { OpdWorkspaceView, StartOpdResult } from "./opd-v2.mapper";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { bangkokBusinessDate } from "../../common/business-date";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
  INITIAL_QUEUE_STEP,
  TERMINAL_QUEUE_STEPS,
} from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";

const START_OPERATION = "OPD_START";
const IDEMPOTENCY_LOCK_MS = 30_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

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
  constructor(
    private readonly repository: OpdRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly queueService: QueueService,
  ) {}

  async list(query: QueryOpdDto, scope: RequestScope): Promise<OpdListResult> {
    const result = await this.repository.findMany(query, scope);
    return {
      items: result.items.map(toOpdView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async historyByCustomer(
    customerId: string,
    scope: RequestScope,
  ): Promise<OpdView[]> {
    const rows = await this.repository.findHistoryByCustomer(customerId, scope);
    return rows.map(toOpdView);
  }

  async start(
    dto: StartOpdDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<StartOpdResult> {
    const source = this.normalizeStartSource(dto);
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(source))
      .digest("hex");

    return this.startWithRetry(
      source,
      idempotencyKey,
      requestHash,
      scope,
      principal,
      true,
    );
  }

  async workspace(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdWorkspaceView> {
    const row = await this.repository.findWorkspace(encounterId, scope);
    if (!row) {
      throw new NotFoundException(
        "OPD encounter not found for this clinic/branch",
      );
    }
    const legacyOpdId = row.encounter.legacy_opd_id;
    if (!legacyOpdId) {
      throw new ConflictException(
        "Operational encounter is missing its legacy OPD link",
      );
    }
    this.assertTicketIdentity(row.ticket, {
      queueTicketId: row.encounter.queue_ticket_id,
      customerId: row.encounter.customer_id,
      appointmentId: row.encounter.appointment_id,
      encounterType: row.encounter.encounter_type,
      businessDate: row.encounter.business_date,
    });
    if (
      row.customer.customer_id !== row.encounter.customer_id ||
      (row.encounter.appointment_id !== null && row.appointment === null)
    ) {
      throw new ConflictException(
        "Workspace compatibility data does not match the OPD encounter",
      );
    }

    const patientName =
      `${row.customer.name} ${row.customer.lastname}`.trim() || null;
    const legacyIdentifier = row.customer.personal_id || null;
    const legacyNumber = (
      value: { toString(): string } | null,
    ): number | null => {
      if (value === null) return null;
      const parsed = Number(value.toString());
      return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
    };
    const legacyVitals = {
      temperature: legacyNumber(row.legacyOpd.bt),
      bloodPressureLegacy: legacyNumber(row.legacyOpd.bp),
      pulse: legacyNumber(row.legacyOpd.pr),
      respiratoryRate: legacyNumber(row.legacyOpd.rr),
      bmi: legacyNumber(row.legacyOpd.bmi),
      weight: legacyNumber(row.legacyOpd.weight),
      height: legacyNumber(row.legacyOpd.height),
      source: "LEGACY_OPD_COMPATIBILITY" as const,
    };
    const hasLegacyVital = Object.entries(legacyVitals).some(
      ([key, value]) => key !== "source" && value !== null,
    );

    return {
      context: {
        encounterId: row.encounter.encounter_id,
        queueTicketId: row.encounter.queue_ticket_id,
        legacyOpdId,
        appointmentId: row.encounter.appointment_id,
        customerId: row.encounter.customer_id,
        clinicId: row.encounter.clinic_id,
        branchId: row.encounter.branch_id,
        attendingUserId: row.encounter.attending_user_id,
        workflowStatus: row.encounter.workflow_status,
        clinicalRecordStatus: row.encounter.clinical_record_status,
        businessDate: this.dateOnly(row.encounter.business_date),
        version: row.encounter.version,
      },
      patient: {
        customerId: row.customer.customer_id,
        name: patientName,
        nickname: row.customer.nickname,
        phone: row.customer.phone_number,
        gender: row.customer.gender || null,
        birthDate: row.customer.birth_date,
        imageUrl: row.customer.customer_image,
        hn: legacyIdentifier,
        identifierSource: legacyIdentifier
          ? "LEGACY_PERSONAL_ID_UNVERIFIED"
          : null,
      },
      safety: {
        legacyAllergy: row.customer.customer_info?.allergy ?? null,
        legacyCondition: row.customer.customer_info?.congenital_disease ?? null,
        source: "LEGACY_CUSTOMER_INFO_UNVERIFIED",
      },
      queue: {
        queueTicketId: row.ticket.queue_ticket_id,
        legacyQueueStatusId: row.ticket.legacy_queue_status_id,
        displayNumber: row.ticket.display_number,
        currentStep: row.ticket.current_step,
        enteredAt: row.ticket.entered_at.toISOString(),
        appointmentStatus: row.appointment?.status_appointment ?? null,
        appointmentDate: row.appointment?.date_appointment ?? null,
        appointmentStartTime: row.appointment?.start_time ?? null,
        room: row.appointment?.room ?? null,
        version: row.ticket.version,
      },
      latestVitals: hasLegacyVital ? legacyVitals : null,
    };
  }

  private async startWithRetry(
    source: { appointmentId: string | null; customerId: string | null },
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    principal: Principal,
    canRetryUniqueConflict: boolean,
  ): Promise<StartOpdResult> {
    const existingClaim = await this.repository.findIdempotency(
      scope,
      START_OPERATION,
      idempotencyKey,
    );
    if (existingClaim) {
      return this.replayStart(existingClaim, requestHash);
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const claim = await this.repository.createIdempotency(
            scope,
            {
              operation: START_OPERATION,
              idempotencyKey,
              requestHash,
              now,
              lockExpiresAt: new Date(now.getTime() + IDEMPOTENCY_LOCK_MS),
              expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
            },
            tx,
          );

          const result = source.appointmentId
            ? await this.startAppointment(source.appointmentId, scope, now, tx)
            : await this.startWalkIn(
                this.requireWalkInCustomerId(source.customerId),
                scope,
                now,
                tx,
              );

          if (!result.resumed) {
            await this.queueService.startEncounter(
              {
                queueTicketId: result.queueTicketId,
                encounterId: result.encounterId,
                appointmentId: result.appointmentId,
                legacyOpdId: result.legacyOpdId,
              },
              scope,
              principal,
              tx,
            );
            await this.auditLogService.create(
              {
                clinicId: scope.clinicId,
                branchId: scope.branchId,
                referenceType: auditReferenceType.OPD,
                referenceId: result.encounterId,
                action: "start",
                actionLabel: "Start OPD encounter",
                toStatus: result.workflowStatus,
                actorUserId: scope.userId,
                actorName: principal.name,
                actorRole:
                  scope.roles[0] ??
                  (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined),
                metadata: {
                  queueTicketId: result.queueTicketId,
                  legacyOpdId: result.legacyOpdId,
                  appointmentId: result.appointmentId,
                  encounterType: source.appointmentId
                    ? "APPOINTMENT"
                    : "WALK_IN",
                  version: result.version,
                },
              },
              tx,
            );
          }

          const resultSnapshot: Prisma.InputJsonObject = {
            encounterId: result.encounterId,
            queueTicketId: result.queueTicketId,
            legacyOpdId: result.legacyOpdId,
            appointmentId: result.appointmentId,
            customerId: result.customerId,
            workflowStatus: result.workflowStatus,
            clinicalRecordStatus: result.clinicalRecordStatus,
            businessDate: result.businessDate,
            version: result.version,
            resumed: result.resumed,
          };
          await this.repository.completeIdempotency(
            claim.api_idempotency_id,
            scope,
            result.encounterId,
            resultSnapshot,
            now,
            tx,
          );
          return result;
        },
        { maxWait: 5_000, timeout: 10_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.repository.findIdempotency(
          scope,
          START_OPERATION,
          idempotencyKey,
        );
        if (replay) return this.replayStart(replay, requestHash);
        if (canRetryUniqueConflict) {
          return this.startWithRetry(
            source,
            idempotencyKey,
            requestHash,
            scope,
            principal,
            false,
          );
        }
        throw new ConflictException(
          "The encounter was started concurrently; reload the worklist",
        );
      }
      throw error;
    }
  }

  private async startAppointment(
    appointmentId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<StartOpdResult> {
    const appointment = await this.repository.findAppointmentForStart(
      appointmentId,
      scope,
      tx,
    );
    if (!appointment) {
      throw new NotFoundException(
        "Appointment not found for this clinic/branch",
      );
    }
    const existingEncounter = await this.repository.findEncounterByAppointment(
      appointmentId,
      scope,
      tx,
    );
    if (existingEncounter) {
      this.assertEncounterResumable(existingEncounter.workflow_status);
      const existingTicket = await this.repository.findQueueTicketByAppointment(
        appointmentId,
        scope,
        tx,
      );
      if (
        existingEncounter.customer_id !== appointment.customer_id ||
        existingEncounter.appointment_id !== appointmentId ||
        existingEncounter.encounter_type !== "APPOINTMENT" ||
        !existingTicket
      ) {
        throw new ConflictException(
          "Existing encounter identity does not match the appointment",
        );
      }
      this.assertTicketIdentity(existingTicket, {
        queueTicketId: existingEncounter.queue_ticket_id,
        customerId: existingEncounter.customer_id,
        appointmentId,
        encounterType: existingEncounter.encounter_type,
        businessDate: existingEncounter.business_date,
      });
      this.assertTicketResumable(existingTicket);
      this.assertAppointmentResumable(appointment.status_appointment);
      if (
        !existingEncounter.legacy_opd_id ||
        appointment.opd_id !== existingEncounter.legacy_opd_id
      ) {
        throw new ConflictException(
          "Appointment and encounter legacy OPD links do not match",
        );
      }
      await this.assertLegacyOpdResumable(
        existingEncounter.legacy_opd_id,
        existingEncounter.customer_id,
        scope,
        tx,
      );
      return this.toStartResult(existingEncounter, true);
    }

    if (
      appointment.status_appointment === statusAppointment.CANCEL ||
      appointment.status_appointment === statusAppointment.SUCCESS
    ) {
      throw new BadRequestException(
        `A terminal appointment (${appointment.status_appointment}) cannot start an OPD encounter`,
      );
    }

    const businessDateText = bangkokBusinessDate(now);
    if (appointment.date_appointment !== businessDateText) {
      throw new BadRequestException(
        `Only appointments on today's Bangkok business date (${businessDateText}) can start`,
      );
    }

    let legacyQueueStatus = await this.repository.findLegacyQueueStatus(
      appointmentId,
      scope,
      tx,
    );
    if (!legacyQueueStatus) {
      legacyQueueStatus = await this.repository.createLegacyQueueStatus(
        appointmentId,
        INITIAL_QUEUE_STEP,
        scope,
        now,
        tx,
      );
    }

    const businessDate = this.toDateOnly(businessDateText);
    let ticket = await this.repository.findQueueTicketByAppointment(
      appointmentId,
      scope,
      tx,
    );
    if (!ticket) {
      const queueSequence = await this.repository.allocateNumber(
        "QUEUE",
        businessDateText.replaceAll("-", ""),
        scope,
        tx,
      );
      ticket = await this.repository.createQueueTicket(
        {
          customerId: appointment.customer_id,
          appointmentId,
          legacyQueueStatusId: legacyQueueStatus.queue_status_id,
          sourceType: "APPOINTMENT",
          businessDate,
          currentStep: legacyQueueStatus.current_step,
          enteredAt: legacyQueueStatus.entered_at,
          queueSequence,
          displayNumber: this.queueDisplayNumber(queueSequence),
        },
        scope,
        tx,
      );
    }
    this.assertTicketIdentity(ticket, {
      queueTicketId: ticket.queue_ticket_id,
      customerId: appointment.customer_id,
      appointmentId,
      encounterType: "APPOINTMENT",
      businessDate,
    });
    this.assertTicketResumable(ticket);

    const ticketEncounter = await this.repository.findEncounterByTicket(
      ticket.queue_ticket_id,
      scope,
      tx,
    );
    if (ticketEncounter) {
      this.assertEncounterResumable(ticketEncounter.workflow_status);
      if (
        ticketEncounter.customer_id !== appointment.customer_id ||
        ticketEncounter.appointment_id !== appointmentId ||
        ticketEncounter.queue_ticket_id !== ticket.queue_ticket_id ||
        ticketEncounter.encounter_type !== "APPOINTMENT" ||
        this.dateOnly(ticketEncounter.business_date) !==
          this.dateOnly(ticket.business_date)
      ) {
        throw new ConflictException(
          "Queue ticket encounter does not match the appointment",
        );
      }
      this.assertAppointmentResumable(appointment.status_appointment);
      if (
        !ticketEncounter.legacy_opd_id ||
        appointment.opd_id !== ticketEncounter.legacy_opd_id
      ) {
        throw new ConflictException(
          "Appointment and encounter legacy OPD links do not match",
        );
      }
      await this.assertLegacyOpdResumable(
        ticketEncounter.legacy_opd_id,
        ticketEncounter.customer_id,
        scope,
        tx,
      );
      return this.toStartResult(ticketEncounter, true);
    }

    let legacyOpdId = appointment.opd_id;
    if (legacyOpdId) {
      const linked = await this.repository.findLegacyOpd(
        legacyOpdId,
        appointment.customer_id,
        scope,
        tx,
      );
      if (!linked) {
        throw new ConflictException(
          "Appointment links to an invalid OPD record",
        );
      }
      if (linked.status_opd !== "PENDING") {
        throw new ConflictException(
          `Legacy OPD record is already terminal (${linked.status_opd})`,
        );
      }
    } else {
      const opdSequence = await this.repository.allocateNumber(
        "LEGACY_OPD",
        businessDateText.replaceAll("-", ""),
        scope,
        tx,
      );
      legacyOpdId = this.legacyOpdNumber(businessDateText, opdSequence);
      await this.repository.createLegacyOpd(
        legacyOpdId,
        appointment.customer_id,
        scope,
        now,
        tx,
      );
      const linked = await this.repository.linkAppointmentToLegacyOpd(
        appointmentId,
        appointment.customer_id,
        legacyOpdId,
        scope,
        now,
        tx,
      );
      if (!linked) {
        throw new ConflictException(
          "Appointment changed while starting the encounter",
        );
      }
    }

    const encounter = await this.repository.createEncounter(
      {
        customerId: appointment.customer_id,
        appointmentId,
        queueTicketId: ticket.queue_ticket_id,
        legacyOpdId,
        encounterType: "APPOINTMENT",
        businessDate: ticket.business_date,
        startedAt: now,
      },
      scope,
      tx,
    );
    return this.toStartResult(encounter, false);
  }

  private async startWalkIn(
    customerId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<StartOpdResult> {
    if (
      !(await this.repository.customerExistsInClinic(
        customerId,
        scope.clinicId,
        tx,
      ))
    ) {
      throw new NotFoundException("Customer not found for this clinic");
    }

    const businessDateText = bangkokBusinessDate(now);
    const businessDate = this.toDateOnly(businessDateText);
    const activeEncounter = await this.repository.findActiveWalkInEncounter(
      customerId,
      businessDate,
      scope,
      tx,
    );
    if (activeEncounter) {
      this.assertEncounterResumable(activeEncounter.workflow_status);
      if (
        activeEncounter.customer_id !== customerId ||
        activeEncounter.appointment_id !== null ||
        activeEncounter.encounter_type !== "WALK_IN" ||
        this.dateOnly(activeEncounter.business_date) !== businessDateText
      ) {
        throw new ConflictException(
          "Existing walk-in encounter identity does not match the request",
        );
      }
      const activeTicket = await this.repository.findQueueTicketById(
        activeEncounter.queue_ticket_id,
        scope,
        tx,
      );
      if (!activeTicket) {
        throw new ConflictException(
          "Existing walk-in encounter is missing its queue ticket",
        );
      }
      this.assertTicketIdentity(activeTicket, {
        queueTicketId: activeEncounter.queue_ticket_id,
        customerId,
        appointmentId: null,
        encounterType: "WALK_IN",
        businessDate,
      });
      this.assertTicketResumable(activeTicket);
      await this.assertLegacyOpdResumable(
        activeEncounter.legacy_opd_id,
        customerId,
        scope,
        tx,
      );
      return this.toStartResult(activeEncounter, true);
    }
    const queueSequence = await this.repository.allocateNumber(
      "QUEUE",
      businessDateText.replaceAll("-", ""),
      scope,
      tx,
    );
    const ticket = await this.repository.createQueueTicket(
      {
        customerId,
        appointmentId: null,
        legacyQueueStatusId: null,
        sourceType: "WALK_IN",
        businessDate,
        currentStep: "ARRIVED",
        enteredAt: now,
        queueSequence,
        displayNumber: this.queueDisplayNumber(queueSequence),
      },
      scope,
      tx,
    );
    this.assertTicketIdentity(ticket, {
      queueTicketId: ticket.queue_ticket_id,
      customerId,
      appointmentId: null,
      encounterType: "WALK_IN",
      businessDate,
    });
    this.assertTicketResumable(ticket);
    const opdSequence = await this.repository.allocateNumber(
      "LEGACY_OPD",
      businessDateText.replaceAll("-", ""),
      scope,
      tx,
    );
    const legacyOpdId = this.legacyOpdNumber(businessDateText, opdSequence);
    await this.repository.createLegacyOpd(
      legacyOpdId,
      customerId,
      scope,
      now,
      tx,
    );
    const encounter = await this.repository.createEncounter(
      {
        customerId,
        appointmentId: null,
        queueTicketId: ticket.queue_ticket_id,
        legacyOpdId,
        encounterType: "WALK_IN",
        businessDate,
        startedAt: now,
      },
      scope,
      tx,
    );
    return this.toStartResult(encounter, false);
  }

  private replayStart(
    claim: {
      request_hash: string;
      state: string;
      result_snapshot: Prisma.JsonValue | null;
    },
    requestHash: string,
  ): StartOpdResult {
    if (claim.request_hash !== requestHash) {
      throw new ConflictException(
        "Idempotency-Key was already used for another OPD start request",
      );
    }
    if (claim.state !== "COMPLETED") {
      throw new ConflictException(
        "The OPD start request is already in progress",
      );
    }
    const value = claim.result_snapshot;
    if (!value || Array.isArray(value) || typeof value !== "object") {
      throw new ConflictException(
        "The saved OPD start result cannot be replayed",
      );
    }
    const readString = (key: string): string => {
      const field = value[key];
      if (typeof field !== "string") {
        throw new ConflictException("The saved OPD start result is invalid");
      }
      return field;
    };
    const appointmentIdValue = value.appointmentId;
    if (appointmentIdValue !== null && typeof appointmentIdValue !== "string") {
      throw new ConflictException("The saved OPD start result is invalid");
    }
    if (
      typeof value.version !== "number" ||
      typeof value.resumed !== "boolean"
    ) {
      throw new ConflictException("The saved OPD start result is invalid");
    }
    return {
      encounterId: readString("encounterId"),
      queueTicketId: readString("queueTicketId"),
      legacyOpdId: readString("legacyOpdId"),
      appointmentId: appointmentIdValue,
      customerId: readString("customerId"),
      workflowStatus: readString("workflowStatus"),
      clinicalRecordStatus: readString("clinicalRecordStatus"),
      businessDate: readString("businessDate"),
      version: value.version,
      resumed: value.resumed,
    };
  }

  private toStartResult(
    encounter: {
      encounter_id: string;
      queue_ticket_id: string;
      legacy_opd_id: string | null;
      appointment_id: string | null;
      customer_id: string;
      workflow_status: string;
      clinical_record_status: string;
      business_date: Date;
      version: number;
    },
    resumed: boolean,
  ): StartOpdResult {
    if (!encounter.legacy_opd_id) {
      throw new ConflictException(
        "Operational encounter is missing its legacy OPD link",
      );
    }
    return {
      encounterId: encounter.encounter_id,
      queueTicketId: encounter.queue_ticket_id,
      legacyOpdId: encounter.legacy_opd_id,
      appointmentId: encounter.appointment_id,
      customerId: encounter.customer_id,
      workflowStatus: encounter.workflow_status,
      clinicalRecordStatus: encounter.clinical_record_status,
      businessDate: this.dateOnly(encounter.business_date),
      version: encounter.version,
      resumed,
    };
  }

  private normalizeStartSource(dto: StartOpdDto): {
    appointmentId: string | null;
    customerId: string | null;
  } {
    const appointmentId = dto.appointmentId?.trim() || null;
    const customerId = dto.customerId?.trim() || null;
    if ((appointmentId ? 1 : 0) + (customerId ? 1 : 0) !== 1) {
      throw new BadRequestException(
        "Provide exactly one of appointmentId or customerId",
      );
    }
    return { appointmentId, customerId };
  }

  private normalizeIdempotencyKey(value: string | undefined): string {
    const key = value?.trim() ?? "";
    if (key.length < 8 || key.length > 200) {
      throw new BadRequestException(
        "Idempotency-Key must contain 8 to 200 characters",
      );
    }
    return key;
  }

  private requireWalkInCustomerId(value: string | null): string {
    if (!value) {
      throw new BadRequestException(
        "customerId is required for a walk-in OPD start",
      );
    }
    return value;
  }

  private assertTicketIdentity(
    ticket: Pick<
      opd_queue_ticket,
      | "queue_ticket_id"
      | "customer_id"
      | "appointment_id"
      | "source_type"
      | "business_date"
    >,
    expected: {
      queueTicketId: string;
      customerId: string;
      appointmentId: string | null;
      encounterType: string;
      businessDate: Date;
    },
  ): void {
    if (
      ticket.queue_ticket_id !== expected.queueTicketId ||
      ticket.customer_id !== expected.customerId ||
      ticket.appointment_id !== expected.appointmentId ||
      ticket.source_type !== expected.encounterType ||
      this.dateOnly(ticket.business_date) !==
        this.dateOnly(expected.businessDate)
    ) {
      throw new ConflictException(
        "Queue ticket identity does not match the OPD encounter",
      );
    }
  }

  private assertTicketResumable(
    ticket: Pick<opd_queue_ticket, "cancelled_at" | "current_step">,
  ): void {
    if (
      ticket.cancelled_at !== null ||
      TERMINAL_QUEUE_STEPS.has(ticket.current_step)
    ) {
      throw new ConflictException(
        `Queue ticket is terminal (${ticket.current_step}) and cannot resume an encounter`,
      );
    }
  }

  private assertEncounterResumable(workflowStatus: string): void {
    if (workflowStatus !== "OPEN" && workflowStatus !== "POST_VISIT") {
      throw new ConflictException(
        `Encounter is terminal (${workflowStatus}); use the amendment workflow instead`,
      );
    }
  }

  private assertAppointmentResumable(status: statusAppointment): void {
    if (
      status === statusAppointment.CANCEL ||
      status === statusAppointment.SUCCESS
    ) {
      throw new ConflictException(
        `Appointment is terminal (${status}) and cannot resume an active encounter`,
      );
    }
  }

  private async assertLegacyOpdResumable(
    legacyOpdId: string | null,
    customerId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (!legacyOpdId) {
      throw new ConflictException(
        "Operational encounter is missing its legacy OPD link",
      );
    }
    const legacyOpd = await this.repository.findLegacyOpd(
      legacyOpdId,
      customerId,
      scope,
      tx,
    );
    if (!legacyOpd || legacyOpd.status_opd !== "PENDING") {
      throw new ConflictException(
        "Active encounter does not have a compatible pending legacy OPD record",
      );
    }
  }

  private toDateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private queueDisplayNumber(sequence: number): string {
    return `Q${String(sequence).padStart(3, "0")}`;
  }

  private legacyOpdNumber(businessDate: string, sequence: number): string {
    return `OPDV2-${businessDate.replaceAll("-", "")}-${String(sequence).padStart(6, "0")}`;
  }
}
