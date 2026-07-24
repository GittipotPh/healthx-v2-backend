import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { deflateSync } from "node:zlib";
import { role_enum } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { StorageService } from "../../common/storage/storage.service";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import type { SaveOpdChartDocumentDto } from "./dto/opd-chart.dto";
import {
  normalizeOpdChartPng,
} from "./opd-chart-artifact";
import { normalizeOpdChartContent } from "./opd-chart-content";
import { OpdChartRepository } from "./opd-chart.repository";
import { OpdChartService } from "./opd-chart.service";
import {
  OPD_CHART_CANVAS_HEIGHT,
  OPD_CHART_CANVAS_WIDTH,
  OPD_CHART_TEMPLATE_VERSION,
  OpdChartTemplateCode,
  findOpdChartTemplate,
} from "./opd-chart-template.registry";
import { OpdClinicalRepository } from "./opd-clinical.repository";

const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const MUTATION_ID = "33333333-3333-4333-8333-333333333333";
const NEXT_MUTATION_ID = "77777777-7777-4777-8777-777777777777";
const FINALIZATION_ID = "44444444-4444-4444-8444-444444444444";
const SCOPE: RequestScope = {
  userId: "doctor-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  roles: [role_enum.DOCTOR],
  isClinicRootUser: false,
};
const PRINCIPAL: Principal = {
  email: "doctor@example.com",
  name: "Doctor One",
};

describe("OpdChartService", () => {
  it("uploads and commits the first raster autosave", async () => {
    const fixture = await makeFixture();
    const created = chartRecord();
    fixture.repository.findDocument
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    fixture.repository.createDraft.mockResolvedValue(created);
    configureCandidateUpload(fixture.storage);

    const result = await fixture.service.saveDraft(
      ENCOUNTER_ID,
      OpdChartTemplateCode.MALE_FACE_FRONT,
      chartDto(0),
      multerPng(chartPng()),
      SCOPE,
      PRINCIPAL,
    );

    expect(result.document.version).toBe(1);
    expect(result.noOp).toBe(false);
    expect(result.cleanupPending).toBe(false);
    expect(fixture.repository.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ encounter_id: ENCOUNTER_ID }),
      expect.objectContaining({
        code: OpdChartTemplateCode.MALE_FACE_FRONT,
      }),
      expect.objectContaining({
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
      expect.objectContaining({
        provider: "minio",
        eTag: "candidate-etag",
      }),
      MUTATION_ID,
      SCOPE,
      expect.any(Date),
      fixture.tx,
    );
    expect(fixture.storage.tagObject).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: "candidate/chart.png",
        tags: { "healthx-lifecycle": "current" },
      }),
    );
    expect(fixture.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "chart.document.draft.autosave",
        metadata: expect.objectContaining({
          previousVersion: 0,
          resultVersion: 1,
        }),
      }),
      fixture.tx,
    );
  });

  it("returns identical raster content as a no-op without uploading", async () => {
    const fixture = await makeFixture();
    const image = normalizeOpdChartPng(chartPng());
    const dto = chartDto(1);
    const content = normalizeOpdChartContent(dto, image.hash);
    const existing = chartRecord({
      contentHash: content.contentHash,
      rasterSha256: image.hash,
      rasterBytes: image.bytes.length,
    });
    fixture.repository.findDocument.mockResolvedValue(existing);

    const result = await fixture.service.saveDraft(
      ENCOUNTER_ID,
      OpdChartTemplateCode.MALE_FACE_FRONT,
      dto,
      multerPng(chartPng()),
      SCOPE,
      PRINCIPAL,
    );

    expect(result.noOp).toBe(true);
    expect(result.document.version).toBe(1);
    expect(fixture.storage.uploadObject).not.toHaveBeenCalled();
    expect(fixture.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a stale changed autosave before object upload", async () => {
    const fixture = await makeFixture();
    fixture.repository.findDocument.mockResolvedValue(
      chartRecord({ version: 2, contentHash: "f".repeat(64) }),
    );

    await expect(
      fixture.service.saveDraft(
        ENCOUNTER_ID,
        OpdChartTemplateCode.MALE_FACE_FRONT,
        chartDto(1, NEXT_MUTATION_ID),
        multerPng(chartPng()),
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(VersionConflictException);
    expect(fixture.storage.uploadObject).not.toHaveBeenCalled();
  });

  it("keeps a committed autosave successful when old-object cleanup fails", async () => {
    const fixture = await makeFixture();
    const existing = chartRecord({
      contentHash: "f".repeat(64),
      objectKey: "previous/chart.png",
    });
    const updated = chartRecord({
      version: 2,
      objectKey: "candidate/chart.png",
      eTag: "candidate-etag",
    });
    fixture.repository.findDocument
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updated);
    fixture.repository.updateDraft.mockResolvedValue(true);
    configureCandidateUpload(fixture.storage);
    fixture.storage.deleteObject.mockRejectedValueOnce(
      new Error("injected delete failure"),
    );

    const result = await fixture.service.saveDraft(
      ENCOUNTER_ID,
      OpdChartTemplateCode.MALE_FACE_FRONT,
      chartDto(1, NEXT_MUTATION_ID),
      multerPng(chartPng()),
      SCOPE,
      PRINCIPAL,
    );

    expect(result.document.version).toBe(2);
    expect(result.cleanupPending).toBe(true);
    expect(fixture.storage.tagObject).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: "previous/chart.png",
        tags: { "healthx-lifecycle": "superseded" },
      }),
    );
  });

  it("replays an already committed finalization without reading or uploading", async () => {
    const fixture = await makeFixture();
    const key = "chart-finalize-key-1";
    const contentHash = "a".repeat(64);
    const requestHash = sha256(
      [
        ENCOUNTER_ID,
        OpdChartTemplateCode.MALE_FACE_FRONT,
        "1",
        contentHash,
      ].join("\n"),
    );
    fixture.repository.findDocument.mockResolvedValue(
      chartRecord({
        status: "FINAL",
        contentHash,
        keyHash: sha256(key),
        requestHash,
        withArtifacts: true,
      }),
    );

    const result = await fixture.service.finalize(
      ENCOUNTER_ID,
      OpdChartTemplateCode.MALE_FACE_FRONT,
      { expectedVersion: 1 },
      key,
      SCOPE,
      PRINCIPAL,
    );

    expect(result.replayed).toBe(true);
    expect(result.document.status).toBe("FINAL");
    expect(fixture.storage.readObject).not.toHaveBeenCalled();
    expect(fixture.storage.uploadObject).not.toHaveBeenCalled();
  });

  it("finalizes the exact stored draft without another browser PNG", async () => {
    const fixture = await makeFixture();
    const image = normalizeOpdChartPng(chartPng());
    const draft = chartRecord({
      rasterSha256: image.hash,
      rasterBytes: image.bytes.length,
    });
    const finalized = chartRecord({
      status: "FINAL",
      rasterSha256: image.hash,
      rasterBytes: image.bytes.length,
      withArtifacts: true,
    });
    fixture.repository.findDocument
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(finalized);
    fixture.repository.finalize.mockResolvedValue(true);
    fixture.storage.inspectObject.mockResolvedValue({
      provider: "minio",
      bucketName: "chart-private",
      objectKey: "draft/chart.png",
      eTag: "draft-etag",
      fileSize: image.bytes.length,
      mimeType: "image/png",
      tags: { "healthx-lifecycle": "current" },
    });
    fixture.storage.readObject.mockResolvedValue(image.bytes);
    configureFinalUploads(fixture.storage);

    const result = await fixture.service.finalize(
      ENCOUNTER_ID,
      OpdChartTemplateCode.MALE_FACE_FRONT,
      { expectedVersion: 1 },
      "chart-finalize-key-2",
      SCOPE,
      PRINCIPAL,
    );

    expect(result.replayed).toBe(false);
    expect(result.document.status).toBe("FINAL");
    expect(result.document.version).toBe(1);
    expect(fixture.storage.uploadObject).toHaveBeenCalledTimes(2);
    expect(fixture.repository.finalize).toHaveBeenCalledWith(
      draft,
      1,
      expect.any(String),
      sha256("chart-finalize-key-2"),
      expect.stringMatching(/^[a-f0-9]{64}$/u),
      expect.arrayContaining([
        expect.objectContaining({
          format: "PNG",
          sourceDraftVersion: 1,
        }),
        expect.objectContaining({
          format: "PDF",
          sourceDraftVersion: 1,
        }),
      ]),
      SCOPE,
      expect.any(Date),
      fixture.tx,
    );
    expect(fixture.storage.deleteObject).toHaveBeenCalledWith({
      provider: "minio",
      bucketName: "chart-private",
      objectKey: "draft/chart.png",
    });
  });

  it("compensates final objects when the database transaction fails", async () => {
    const fixture = await makeFixture();
    const image = normalizeOpdChartPng(chartPng());
    fixture.repository.findDocument.mockResolvedValueOnce(
      chartRecord({
        rasterSha256: image.hash,
        rasterBytes: image.bytes.length,
      }),
    );
    fixture.storage.inspectObject.mockResolvedValue({
      provider: "minio",
      bucketName: "chart-private",
      objectKey: "draft/chart.png",
      eTag: "draft-etag",
      fileSize: image.bytes.length,
      mimeType: "image/png",
      tags: { "healthx-lifecycle": "current" },
    });
    fixture.storage.readObject.mockResolvedValue(image.bytes);
    configureFinalUploads(fixture.storage);
    fixture.prisma.$transaction.mockRejectedValueOnce(
      new Error("injected database failure"),
    );

    await expect(
      fixture.service.finalize(
        ENCOUNTER_ID,
        OpdChartTemplateCode.MALE_FACE_FRONT,
        { expectedVersion: 1 },
        "chart-finalize-key-3",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow("injected database failure");

    expect(fixture.storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(fixture.storage.deleteObject).toHaveBeenCalledWith({
      provider: "minio",
      bucketName: "chart-private",
      objectKey: "final/chart.png",
    });
    expect(fixture.storage.deleteObject).toHaveBeenCalledWith({
      provider: "minio",
      bucketName: "chart-private",
      objectKey: "final/chart.pdf",
    });
  });
});

async function makeFixture() {
  const tx = {};
  const repository = {
    listDocuments: jest.fn(),
    findDocument: jest.fn(),
    lockDocument: jest.fn().mockResolvedValue(true),
    createDraft: jest.fn(),
    updateDraft: jest.fn(),
    finalize: jest.fn(),
  };
  const clinicalRepository = {
    lockEncounter: jest.fn().mockResolvedValue(true),
    findEncounter: jest.fn().mockResolvedValue(encounter()),
  };
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation(
        (operation: (client: object) => Promise<unknown>) => operation(tx),
      ),
  };
  const auditLog = { create: jest.fn().mockResolvedValue({}) };
  const storage = {
    uploadObject: jest.fn(),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    getReadUrl: jest
      .fn()
      .mockResolvedValue("http://localhost:9000/chart.png"),
    readObject: jest.fn(),
    inspectObject: jest.fn(),
    tagObject: jest.fn().mockResolvedValue(undefined),
    readiness: jest.fn(),
  };
  const module = await Test.createTestingModule({
    providers: [
      OpdChartService,
      { provide: OpdChartRepository, useValue: repository },
      { provide: OpdClinicalRepository, useValue: clinicalRepository },
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: auditLog },
      { provide: StorageService, useValue: storage },
    ],
  }).compile();
  return {
    service: module.get(OpdChartService),
    repository,
    clinicalRepository,
    prisma,
    auditLog,
    storage,
    tx,
  };
}

function encounter() {
  return {
    encounter_id: ENCOUNTER_ID,
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    customer_id: "customer-1",
    workflow_status: "OPEN",
    clinical_record_status: "DRAFT",
  };
}

function chartDto(
  expectedVersion: number,
  clientMutationId = MUTATION_ID,
): SaveOpdChartDocumentDto {
  return {
    expectedVersion,
    templateVersion: OPD_CHART_TEMPLATE_VERSION,
    clientMutationId,
    location: "left cheek",
    character: "",
    size: "",
    side: "left",
    doctorNote: "",
  };
}

function chartRecord(input: {
  version?: number;
  status?: "DRAFT" | "FINAL";
  contentHash?: string;
  rasterSha256?: string;
  rasterBytes?: number;
  objectKey?: string;
  eTag?: string;
  keyHash?: string;
  requestHash?: string;
  withArtifacts?: boolean;
} = {}) {
  const status = input.status ?? "DRAFT";
  const raster = normalizeOpdChartPng(chartPng());
  return {
    chart_document_id: DOCUMENT_ID,
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    encounter_id: ENCOUNTER_ID,
    customer_id: "customer-1",
    template_code: OpdChartTemplateCode.MALE_FACE_FRONT,
    template_version: OPD_CHART_TEMPLATE_VERSION,
    template_name_snapshot: chartTemplateName(),
    status,
    version: input.version ?? 1,
    current_revision_number: null,
    content_schema: "opd-chart-raster-v1",
    clinical_metadata: {
      location: "left cheek",
      character: "",
      size: "",
      side: "left",
      doctorNote: "",
    },
    content_sha256: input.contentHash ?? "b".repeat(64),
    raster_sha256: input.rasterSha256 ?? raster.hash,
    raster_file_size_bytes: input.rasterBytes ?? raster.bytes.length,
    last_client_mutation_id: MUTATION_ID,
    draft_storage_provider: status === "DRAFT" ? "minio" : null,
    draft_storage_bucket: status === "DRAFT" ? "chart-private" : null,
    draft_storage_object_key:
      status === "DRAFT" ? (input.objectKey ?? "draft/chart.png") : null,
    draft_storage_etag:
      status === "DRAFT" ? (input.eTag ?? "draft-etag") : null,
    finalization_id: status === "FINAL" ? FINALIZATION_ID : null,
    finalization_idempotency_key_hash: input.keyHash ?? null,
    finalization_request_hash: input.requestHash ?? null,
    finalized_by: status === "FINAL" ? SCOPE.userId : null,
    finalized_at:
      status === "FINAL" ? new Date("2026-07-23T12:00:00Z") : null,
    created_by: SCOPE.userId,
    updated_by: SCOPE.userId,
    created_at: new Date("2026-07-23T11:00:00Z"),
    updated_at: new Date("2026-07-23T12:00:00Z"),
    artifacts: input.withArtifacts
      ? [
          {
            chart_artifact_id:
              "55555555-5555-4555-8555-555555555555",
            chart_revision_id: null,
            chart_document_id: DOCUMENT_ID,
            clinic_id: SCOPE.clinicId,
            branch_id: SCOPE.branchId,
            encounter_id: ENCOUNTER_ID,
            finalization_id: FINALIZATION_ID,
            source_draft_version: input.version ?? 1,
            artifact_format: "PNG",
            storage_provider: "minio",
            storage_bucket: "chart-private",
            storage_object_key: "committed/chart.png",
            storage_etag: "final-png-etag",
            mime_type: "image/png",
            file_size_bytes: raster.bytes.length,
            sha256: raster.hash,
            created_at: new Date("2026-07-23T12:00:00Z"),
          },
          {
            chart_artifact_id:
              "66666666-6666-4666-8666-666666666666",
            chart_revision_id: null,
            chart_document_id: DOCUMENT_ID,
            clinic_id: SCOPE.clinicId,
            branch_id: SCOPE.branchId,
            encounter_id: ENCOUNTER_ID,
            finalization_id: FINALIZATION_ID,
            source_draft_version: input.version ?? 1,
            artifact_format: "PDF",
            storage_provider: "minio",
            storage_bucket: "chart-private",
            storage_object_key: "committed/chart.pdf",
            storage_etag: "final-pdf-etag",
            mime_type: "application/pdf",
            file_size_bytes: 2345,
            sha256: "e".repeat(64),
            created_at: new Date("2026-07-23T12:00:00Z"),
          },
        ]
      : [],
  };
}

function configureCandidateUpload(
  storage: Awaited<ReturnType<typeof makeFixture>>["storage"],
): void {
  storage.uploadObject.mockResolvedValueOnce({
    provider: "minio",
    bucketName: "chart-private",
    objectKey: "candidate/chart.png",
    publicUrl: null,
    eTag: "candidate-etag",
  });
}

function configureFinalUploads(
  storage: Awaited<ReturnType<typeof makeFixture>>["storage"],
): void {
  storage.uploadObject
    .mockResolvedValueOnce({
      provider: "minio",
      bucketName: "chart-private",
      objectKey: "final/chart.png",
      publicUrl: null,
      eTag: "final-png-etag",
    })
    .mockResolvedValueOnce({
      provider: "minio",
      bucketName: "chart-private",
      objectKey: "final/chart.pdf",
      publicUrl: null,
      eTag: "final-pdf-etag",
    });
}

function chartPng(): Buffer {
  const width = OPD_CHART_CANVAS_WIDTH;
  const height = OPD_CHART_CANVAS_HEIGHT;
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let row = 0; row < height; row += 1) {
    rows[row * (width * 3 + 1)] = 0;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function multerPng(buffer: Buffer): Express.Multer.File {
  return {
    fieldname: "renderedPng",
    originalname: "chart.png",
    encoding: "7bit",
    mimetype: "image/png",
    size: buffer.length,
    destination: "",
    filename: "chart.png",
    path: "",
    buffer,
    stream: Readable.from(buffer),
  };
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    8 + data.length,
  );
  return output;
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function chartTemplateName(): string {
  const template = findOpdChartTemplate(
    OpdChartTemplateCode.MALE_FACE_FRONT,
  );
  if (!template) throw new Error("Chart test template is missing");
  return template.name;
}
