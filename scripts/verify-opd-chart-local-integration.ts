import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { Principal, RequestScope } from "../src/auth/auth.types";
import {
  StorageService,
  type StorageProvider,
} from "../src/common/storage/storage.service";
import { backendEnv } from "../src/env";
import { PrismaService } from "../src/prisma.service";
import { AuditLogRepository } from "../src/api/audit-log/audit-log.repository";
import { AuditLogService } from "../src/api/audit-log/audit-log.service";
import {
  OPD_CHART_CANVAS_HEIGHT,
  OPD_CHART_CANVAS_WIDTH,
  OPD_CHART_TEMPLATE_VERSION,
  OpdChartTemplateCode,
} from "../src/api/opd/opd-chart-template.registry";
import { OpdChartRepository } from "../src/api/opd/opd-chart.repository";
import { OpdChartService } from "../src/api/opd/opd-chart.service";
import { OpdClinicalRepository } from "../src/api/opd/opd-clinical.repository";

const TEST_ACTOR = "chart-local-verify";
const TEMPLATE = OpdChartTemplateCode.SURGERY_MARKING;

interface ObjectCoordinate {
  provider: string;
  bucketName: string;
  objectKey: string;
}

async function main(): Promise<void> {
  assertLocalEnvironment();
  const prisma = new PrismaService();
  const storage = new StorageService();
  await prisma.$connect();
  let documentId: string | null = null;

  try {
    await storage.readiness();
    const encounter = await prisma.opd_encounter.findFirst({
      where: {
        workflow_status: "OPEN",
        clinical_record_status: "DRAFT",
        chart_documents: {
          none: { template_code: TEMPLATE },
        },
      },
      orderBy: { started_at: "desc" },
    });
    if (!encounter) {
      throw new Error(
        "No OPEN/DRAFT local encounter without the synthetic Chart template is available",
      );
    }

    const scope: RequestScope = {
      userId: TEST_ACTOR,
      clinicId: encounter.clinic_id,
      branchId: encounter.branch_id,
      isClinicRootUser: true,
      roles: [],
    };
    const principal: Principal = {
      email: "chart-local-verify@example.invalid",
      name: "Chart local verification",
    };
    const service = new OpdChartService(
      new OpdChartRepository(prisma),
      new OpdClinicalRepository(prisma),
      prisma,
      new AuditLogService(new AuditLogRepository(prisma)),
      storage,
    );

    const firstPng = syntheticChartPng(44);
    const first = await service.saveDraft(
      encounter.encounter_id,
      TEMPLATE,
      saveDto(0, "first local raster"),
      pngFile(firstPng),
      scope,
      principal,
    );
    documentId = first.document.documentId;
    assert(first.document.version === 1, "first autosave version");
    assert(!first.noOp, "first autosave must create content");
    assert(!first.cleanupPending, "first autosave cleanup");
    const firstCoordinate = await draftCoordinate(prisma, documentId);
    await assertObject(
      storage,
      firstCoordinate,
      first.document.rasterFileSizeBytes,
      "image/png",
    );

    const secondPng = syntheticChartPng(91);
    const second = await service.saveDraft(
      encounter.encounter_id,
      TEMPLATE,
      saveDto(1, "second local raster"),
      pngFile(secondPng),
      scope,
      principal,
    );
    assert(second.document.version === 2, "second autosave version");
    assert(!second.noOp, "second autosave must change content");
    assert(!second.cleanupPending, "superseded draft cleanup");
    await assertMissing(storage, firstCoordinate);

    const currentCoordinate = await draftCoordinate(prisma, documentId);
    await assertObject(
      storage,
      currentCoordinate,
      second.document.rasterFileSizeBytes,
      "image/png",
    );

    const noOp = await service.saveDraft(
      encounter.encounter_id,
      TEMPLATE,
      saveDto(2, "second local raster"),
      pngFile(secondPng),
      scope,
      principal,
    );
    assert(noOp.noOp, "exact-content retry must be a no-op");
    assert(noOp.document.version === 2, "no-op version");

    let conflictObserved = false;
    try {
      await service.saveDraft(
        encounter.encounter_id,
        TEMPLATE,
        saveDto(1, "stale local raster"),
        pngFile(firstPng),
        scope,
        principal,
      );
    } catch {
      conflictObserved = true;
    }
    assert(conflictObserved, "stale autosave conflict");

    const finalizationKey = `chart-local-${randomUUID()}`;
    const finalized = await service.finalize(
      encounter.encounter_id,
      TEMPLATE,
      { expectedVersion: 2 },
      finalizationKey,
      scope,
      principal,
    );
    assert(finalized.document.status === "FINAL", "final status");
    assert(finalized.document.version === 2, "final source version");
    assert(finalized.document.artifacts.length === 2, "final artifacts");
    assert(!finalized.cleanupPending, "final draft cleanup");
    await assertMissing(storage, currentCoordinate);

    const replay = await service.finalize(
      encounter.encounter_id,
      TEMPLATE,
      { expectedVersion: 2 },
      finalizationKey,
      scope,
      principal,
    );
    assert(replay.replayed, "idempotent finalization replay");

    const artifacts = await artifactCoordinates(prisma, documentId);
    assert(artifacts.length === 2, "artifact coordinate count");
    for (const artifact of artifacts) {
      await assertObject(
        storage,
        artifact,
        artifact.fileSize,
        artifact.mimeType,
      );
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          storageProvider: backendEnv().STORAGE_PROVIDER,
          autosaveVersions: [first.document.version, second.document.version],
          noOp: noOp.noOp,
          staleConflict: conflictObserved,
          finalStatus: finalized.document.status,
          finalVersion: finalized.document.version,
          finalizationReplay: replay.replayed,
          artifacts: artifacts.length,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (documentId) {
      await cleanupFixture(prisma, storage, documentId);
    }
    await prisma.$disconnect();
  }
}

function assertLocalEnvironment(): void {
  const env = backendEnv();
  const database = new URL(env.DATABASE_URL);
  if (
    env.NODE_ENV === "production" ||
    env.STORAGE_PROVIDER !== "minio" ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.pathname !== "/healthx_optionb_test"
  ) {
    throw new Error(
      "Local Chart integration is restricted to MinIO and localhost/healthx_optionb_test",
    );
  }
}

function saveDto(expectedVersion: number, doctorNote: string) {
  return {
    expectedVersion,
    templateVersion: OPD_CHART_TEMPLATE_VERSION,
    clientMutationId: randomUUID(),
    location: "",
    character: "",
    size: "",
    side: "",
    doctorNote,
  };
}

function pngFile(buffer: Buffer): Express.Multer.File {
  return {
    fieldname: "renderedPng",
    originalname: "chart.png",
    encoding: "7bit",
    mimetype: "image/png",
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

async function draftCoordinate(
  prisma: PrismaService,
  documentId: string,
): Promise<ObjectCoordinate> {
  const row = await prisma.opd_chart_document.findUniqueOrThrow({
    where: { chart_document_id: documentId },
    select: {
      draft_storage_provider: true,
      draft_storage_bucket: true,
      draft_storage_object_key: true,
    },
  });
  if (
    !row.draft_storage_provider ||
    !row.draft_storage_bucket ||
    !row.draft_storage_object_key
  ) {
    throw new Error("Draft object coordinate is incomplete");
  }
  return {
    provider: row.draft_storage_provider,
    bucketName: row.draft_storage_bucket,
    objectKey: row.draft_storage_object_key,
  };
}

async function artifactCoordinates(prisma: PrismaService, documentId: string) {
  const rows = await prisma.opd_chart_artifact.findMany({
    where: { chart_document_id: documentId },
    orderBy: { artifact_format: "asc" },
  });
  return rows.map((row) => ({
    provider: row.storage_provider,
    bucketName: row.storage_bucket,
    objectKey: row.storage_object_key,
    fileSize: row.file_size_bytes,
    mimeType: row.mime_type,
  }));
}

async function assertObject(
  storage: StorageService,
  coordinate: ObjectCoordinate,
  expectedBytes: number,
  expectedMimeType: string,
): Promise<void> {
  const provider = requireProvider(coordinate.provider);
  const [body, properties, readUrl] = await Promise.all([
    storage.readObject({ ...coordinate, provider }),
    storage.inspectObject({ ...coordinate, provider }),
    storage.getReadUrl({
      ...coordinate,
      provider,
      expiresInSeconds: 60,
    }),
  ]);
  assert(body.length === expectedBytes, "stored byte count");
  assert(properties.fileSize === expectedBytes, "inspected byte count");
  assert(properties.mimeType === expectedMimeType, "stored MIME type");
  assert(Boolean(properties.eTag), "stored ETag");
  assert(readUrl.startsWith("http"), "short-lived read URL");
}

async function assertMissing(
  storage: StorageService,
  coordinate: ObjectCoordinate,
): Promise<void> {
  let missing = false;
  try {
    await storage.readObject({
      ...coordinate,
      provider: requireProvider(coordinate.provider),
    });
  } catch {
    missing = true;
  }
  assert(missing, "retired object must be unavailable");
}

async function cleanupFixture(
  prisma: PrismaService,
  storage: StorageService,
  documentId: string,
): Promise<void> {
  const document = await prisma.opd_chart_document.findUnique({
    where: { chart_document_id: documentId },
    include: { artifacts: true },
  });
  if (!document) return;

  const coordinates: ObjectCoordinate[] = document.artifacts.map(
    (artifact) => ({
      provider: artifact.storage_provider,
      bucketName: artifact.storage_bucket,
      objectKey: artifact.storage_object_key,
    }),
  );
  if (
    document.draft_storage_provider &&
    document.draft_storage_bucket &&
    document.draft_storage_object_key
  ) {
    coordinates.push({
      provider: document.draft_storage_provider,
      bucketName: document.draft_storage_bucket,
      objectKey: document.draft_storage_object_key,
    });
  }
  for (const coordinate of coordinates) {
    await storage.deleteObject({
      ...coordinate,
      provider: requireProvider(coordinate.provider),
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.opd_chart_artifact.deleteMany({
      where: { chart_document_id: documentId },
    });
    await tx.opd_chart_revision.deleteMany({
      where: { chart_document_id: documentId },
    });
    await tx.opd_chart_document.delete({
      where: { chart_document_id: documentId },
    });
    await tx.audit_log.deleteMany({
      where: {
        actor_user_id: TEST_ACTOR,
        reference_id: document.encounter_id,
        action: {
          in: ["chart.document.draft.autosave", "chart.document.finalize"],
        },
      },
    });
  });
}

function requireProvider(value: string): StorageProvider {
  if (value === "minio" || value === "azure") return value;
  throw new Error(`Unsupported stored provider: ${value}`);
}

function assert(condition: boolean, label: string): asserts condition {
  if (!condition) {
    throw new Error(`Local Chart integration assertion failed: ${label}`);
  }
}

function syntheticChartPng(accent: number): Buffer {
  const width = OPD_CHART_CANVAS_WIDTH;
  const height = OPD_CHART_CANVAS_HEIGHT;
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let row = 0; row < height; row += 1) {
    rows[row * (width * 3 + 1)] = 0;
    const column = Math.min(width - 1, Math.floor((row * width) / height));
    const pixel = row * (width * 3 + 1) + 1 + column * 3;
    rows[pixel] = accent;
    rows[pixel + 1] = 80;
    rows[pixel + 2] = 180;
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

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
