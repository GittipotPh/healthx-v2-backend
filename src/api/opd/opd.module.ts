import { Module } from "@nestjs/common";
import { OpdController } from "./opd.controller";
import { OpdService } from "./opd.service";
import { OpdRepository } from "./opd.repository";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { QueueModule } from "../queue/queue.module";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";
import { OpdClinicalController } from "./opd-clinical.controller";
import { OpdClinicalService } from "./opd-clinical.service";
import { OpdClinicalRepository } from "./opd-clinical.repository";
import { OpdClinicalSectionController } from "./opd-clinical-section.controller";
import { OpdClinicalSectionRepository } from "./opd-clinical-section.repository";
import { OpdClinicalSectionService } from "./opd-clinical-section.service";
import { OpdClinicalHistoryController } from "./opd-clinical-history.controller";
import { OpdClinicalHistoryRepository } from "./opd-clinical-history.repository";
import { OpdClinicalHistoryService } from "./opd-clinical-history.service";
import { OpdClinicalIntakeRepository } from "./opd-clinical-intake.repository";
import { OpdClinicalIntakeService } from "./opd-clinical-intake.service";
import { OpdClinicalNoteController } from "./opd-clinical-note.controller";
import { OpdClinicalNoteRepository } from "./opd-clinical-note.repository";
import { OpdClinicalNoteService } from "./opd-clinical-note.service";
import { OpdOrderController } from "./opd-order.controller";
import { OpdOrderRepository } from "./opd-order.repository";
import { OpdOrderService } from "./opd-order.service";
import { OpdOrderReleaseController } from "./opd-order-release.controller";
import { OpdOrderReleaseRepository } from "./opd-order-release.repository";
import { OpdOrderReleaseService } from "./opd-order-release.service";

@Module({
  imports: [AuditLogModule, QueueModule],
  controllers: [
    OpdController,
    OpdClinicalController,
    OpdClinicalSectionController,
    OpdClinicalHistoryController,
    OpdClinicalNoteController,
    OpdOrderController,
    OpdOrderReleaseController,
  ],
  providers: [
    OpdService,
    OpdRepository,
    OpdClinicalService,
    OpdClinicalRepository,
    OpdClinicalSectionService,
    OpdClinicalSectionRepository,
    OpdClinicalHistoryService,
    OpdClinicalHistoryRepository,
    OpdClinicalIntakeService,
    OpdClinicalIntakeRepository,
    OpdClinicalNoteService,
    OpdClinicalNoteRepository,
    OpdOrderService,
    OpdOrderRepository,
    OpdOrderReleaseService,
    OpdOrderReleaseRepository,
    OpdV2EnabledGuard,
  ],
  exports: [OpdService],
})
export class OpdModule {}
