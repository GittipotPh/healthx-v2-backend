import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { CustomersRepository } from "./customers.repository";
import { CustomerOptionsView, CustomerView, toCustomerView } from "./customers.mapper";
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
import { StorageService } from "../../common/storage/storage.service";
import { backendEnv } from "../../env";

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
  constructor(
    private readonly repository: CustomersRepository,
    private readonly storageService: StorageService,
  ) {}

  async list(query: QueryCustomersDto, scope: RequestScope): Promise<CustomerListResult> {
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

  async profile(customerId: string, scope: RequestScope): Promise<CustomerProfileView> {
    return toCustomerProfileView(await this.requireProfile(customerId, scope));
  }

  async timeline(customerId: string, scope: RequestScope): Promise<CustomerTimelineItem[]> {
    return toTimelineItems(await this.requireProfile(customerId, scope));
  }

  async appointments(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerAppointmentSummary[]> {
    return toAppointmentSummaries(await this.requireProfile(customerId, scope));
  }

  async financials(customerId: string, scope: RequestScope): Promise<CustomerFinancialsView> {
    return toFinancialsView(await this.requireProfile(customerId, scope));
  }

  async documents(
    customerId: string,
    scope: RequestScope,
  ): Promise<CustomerDocumentSummary[]> {
    const row = await this.requireProfile(customerId, scope);
    const documents = toDocumentSummaries(row);
    const readUrls = new Map<string, string | null>();

    await Promise.all(
      (row.customer_file ?? []).map(async (file) => {
        readUrls.set(
          file.file_id,
          await this.storageService.getReadUrl({
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

  async notes(customerId: string, scope: RequestScope): Promise<CustomerNoteView[]> {
    await this.ensureCustomer(customerId, scope);
    const rows = await this.repository.findNotes(customerId, scope).catch(() => []);
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

    const created = await this.repository.createFile({
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

    const readUrl = await this.storageService.getReadUrl({
      bucketName: created.bucket_name,
      objectKey: created.object_key,
    });
    return toCustomerFileView(created, readUrl);
  }

  async deleteFile(customerId: string, fileId: string, scope: RequestScope): Promise<CustomerFileView> {
    await this.ensureCustomer(customerId, scope);
    const file = await this.repository.findFile(customerId, fileId, scope);
    if (!file) {
      throw new NotFoundException("Customer file not found");
    }

    await this.storageService.deleteObject({
      bucketName: file.bucket_name,
      objectKey: file.object_key,
    });
    await this.repository.markFileDeleted(fileId, scope);
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
      this.repository.findNotes(customerId, scope).catch(() => []),
      this.repository.findFiles(customerId, scope).catch(() => []),
    ]);

    return {
      ...found,
      customer_note: notes,
      customer_file: files,
    };
  }

  private async ensureCustomer(customerId: string, scope: RequestScope): Promise<void> {
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
