import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { CustomersRepository } from "./customers.repository";
import {
  CustomerOptionsView,
  CustomerView,
  toCustomerView,
} from "./customers.mapper";
import {
  CustomerAppointmentSummary,
  CustomerDocumentSummary,
  CustomerFileView,
  CustomerFinancialsView,
  CustomerNoteView,
  CustomerProfileView,
  CustomerTimelineItem,
  toAppointmentSummaries,
  toCustomerFileView,
  toCustomerNoteView,
  toCustomerProfileView,
  toDocumentSummaries,
  toFinancialsView,
  toTimelineItems,
  type CustomerProfileRow,
} from "./customer-profile.mapper";
import type { QueryCustomersDto } from "./dto/query-customers.dto";
import type { CreateCustomerNoteDto } from "./dto/create-customer-note.dto";
import type { UploadCustomerFileDto } from "./dto/upload-customer-file.dto";
import type { RequestScope } from "../../auth/auth.types";
import {
  StorageService,
  type StorageProvider,
} from "../../common/storage/storage.service";
import { backendEnv } from "../../env";

function requireStorageProvider(value: string): StorageProvider {
  if (value === "minio" || value === "azure") {
    return value;
  }
  throw new Error(`Unsupported customer file storage provider: ${value}`);
}

export class CustomerListResult {
  @ApiProperty({ type: [CustomerView] })
  items!: CustomerView[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly repository: CustomersRepository,
    private readonly storageService: StorageService,
  ) {}

  async list(
    query: QueryCustomersDto,
    scope: RequestScope,
  ): Promise<CustomerListResult> {
    const result = await this.repository.findMany(query, scope);
    return {
      items: result.items.map(toCustomerView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  options(scope: RequestScope): Promise<CustomerOptionsView> {
    return this.repository.options(scope);
  }

  async detail(customerId: string, clinicId: string): Promise<CustomerView> {
    const found = await this.repository.findOne(customerId, clinicId);
    if (!found) {
      throw new NotFoundException("Customer not found");
    }
    return toCustomerView(found);
  }

  async profile(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerProfileView> {
    return toCustomerProfileView(await this.requireProfile(customerId, scope));
  }

  async timeline(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerTimelineItem[]> {
    const row = requireRow(
      await this.repository.findTimelineSlice(customerId, scope),
    );
    const [notes, files] = await Promise.all([
      this.repository.findNotes(customerId, scope),
      this.repository.findFiles(customerId, scope),
    ]);
    return toTimelineItems({
      ...row,
      customer_note: notes,
      customer_file: files,
    });
  }

  async appointments(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerAppointmentSummary[]> {
    const row = requireRow(
      await this.repository.findAppointmentSlice(customerId, scope),
    );
    return toAppointmentSummaries(row);
  }

  async financials(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerFinancialsView> {
    const row = requireRow(
      await this.repository.findFinancialSlice(customerId, scope),
    );
    return toFinancialsView(row);
  }

  async documents(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerDocumentSummary[]> {
    const slice = requireRow(
      await this.repository.findDocumentSlice(customerId, scope),
    );
    const files = await this.repository.findFiles(customerId, scope);
    const row = { ...slice, customer_file: files };
    const documents = toDocumentSummaries(row);
    const readUrls = new Map<string, string | null>();

    await Promise.all(
      (row.customer_file ?? []).map(async (file) => {
        readUrls.set(
          file.file_id,
          await this.storageService.getReadUrl({
            provider: requireStorageProvider(file.storage_provider),
            bucketName: file.bucket_name,
            objectKey: file.object_key,
          }),
        );
      }),
    );

    return documents.map((document) =>
      document.source === "customer_file"
        ? { ...document, url: readUrls.get(document.id) ?? document.url }
        : document,
    );
  }

  async notes(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerNoteView[]> {
    await this.ensureCustomer(customerId, scope);
    const rows = await this.repository.findNotes(customerId, scope);
    return rows.map(toCustomerNoteView);
  }

  async createNote(
    customerId: string,
    dto: CreateCustomerNoteDto,
    scope: RequestScope,
  ): Promise<CustomerNoteView> {
    await this.ensureCustomer(customerId, scope);
    const created = await this.repository.createNote({
      noteId: randomUUID(),
      customerId,
      content: dto.content,
      scope,
    });
    return toCustomerNoteView(created);
  }

  async uploadFile(
    customerId: string,
    dto: UploadCustomerFileDto,
    file: Express.Multer.File | undefined,
    scope: RequestScope,
  ): Promise<CustomerFileView> {
    await this.ensureCustomer(customerId, scope);
    if (!file) {
      throw new BadRequestException("File is required");
    }

    this.validateUpload(file);

    const fileId = randomUUID();
    const originalName = file.originalname || `${fileId}`;
    const safeFileName = safeObjectFileName(originalName);
    const objectKey = `clinics/${scope.clinicId}/customers/${customerId}/${fileId}/${safeFileName}`;

    const stored = await this.storageService.uploadObject({
      objectKey,
      body: file.buffer,
      mimeType: file.mimetype,
      fileSize: file.size,
    });

    let created;
    try {
      created = await this.repository.createFile({
        fileId,
        customerId,
        displayName: dto.displayName || originalName,
        originalName,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageProvider: stored.provider,
        bucketName: stored.bucketName,
        objectKey: stored.objectKey,
        publicUrl: stored.publicUrl,
        scope,
      });
    } catch (error) {
      // The DB row is the source of truth — remove the just-uploaded blob so a
      // failed insert doesn't leave an orphaned object in storage.
      await this.storageService
        .deleteObject({
          bucketName: stored.bucketName,
          objectKey: stored.objectKey,
        })
        .catch((cleanupError: unknown) =>
          this.logger.error({
            msg: "customer file upload compensation failed; orphaned blob left in storage",
            objectKey: stored.objectKey,
            err: cleanupError,
          }),
        );
      throw error;
    }

    const readUrl = await this.storageService.getReadUrl({
      provider: requireStorageProvider(created.storage_provider),
      bucketName: created.bucket_name,
      objectKey: created.object_key,
    });
    return toCustomerFileView(created, readUrl);
  }

  async deleteFile(
    customerId: string,
    fileId: string,
    scope: RequestScope,
  ): Promise<CustomerFileView> {
    await this.ensureCustomer(customerId, scope);
    const file = await this.repository.findFile(customerId, fileId, scope);
    if (!file) {
      throw new NotFoundException("Customer file not found");
    }

    // Soft-delete the row first: the DB is the source of truth, so a storage
    // failure must never leave an ACTIVE row pointing at a missing blob.
    await this.repository.markFileDeleted(fileId, scope);
    try {
      await this.storageService.deleteObject({
        provider: requireStorageProvider(file.storage_provider),
        bucketName: file.bucket_name,
        objectKey: file.object_key,
      });
    } catch (error) {
      this.logger.error({
        msg: "customer file blob delete failed after soft-delete; orphaned blob left in storage",
        fileId,
        objectKey: file.object_key,
        err: error,
      });
    }
    return toCustomerFileView(file, null);
  }

  private async requireProfile(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerProfileRow> {
    const found = await this.repository.findProfile(customerId, scope);
    if (!found) {
      throw new NotFoundException("Customer not found");
    }
    const [notes, files] = await Promise.all([
      this.repository.findNotes(customerId, scope),
      this.repository.findFiles(customerId, scope),
    ]);

    return {
      ...found,
      customer_note: notes,
      customer_file: files,
    };
  }

  private async ensureCustomer(
    customerId: string,
    scope: RequestScope,
  ): Promise<void> {
    if (!(await this.repository.existsInClinic(customerId, scope.clinicId))) {
      throw new NotFoundException("Customer not found");
    }
  }

  private validateUpload(file: Express.Multer.File): void {
    const env = backendEnv();
    if (!ALLOWED_CUSTOMER_FILE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException("Unsupported file type");
    }
    if (file.size > env.CUSTOMER_FILE_MAX_BYTES) {
      throw new BadRequestException("File is too large");
    }
  }
}

function requireRow<T>(row: T | null): T {
  if (!row) {
    throw new NotFoundException("Customer not found");
  }
  return row;
}

const ALLOWED_CUSTOMER_FILE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function safeObjectFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);

  return sanitized || "file";
}
