import { Injectable } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { backendEnv, type BackendEnv } from "../../env";

export type StorageProvider = "minio" | "azure";

export interface UploadObjectInput {
  objectKey: string;
  body: Buffer;
  mimeType: string;
  fileSize: number;
}

export interface StoredObject {
  provider: StorageProvider;
  bucketName: string;
  objectKey: string;
  publicUrl: string | null;
}

export interface DeleteObjectInput {
  bucketName?: string;
  objectKey: string;
}

export interface ReadUrlInput {
  bucketName?: string;
  objectKey: string;
  expiresInSeconds?: number;
}

interface AzureSharedKey {
  accountName: string;
  accountKey: string;
}

@Injectable()
export class StorageService {
  private readonly env: BackendEnv;
  private readonly provider: StorageProvider;
  private readonly bucketName: string;
  private readonly s3Client?: S3Client;
  private readonly blobServiceClient?: BlobServiceClient;
  private readonly azureSharedKey?: StorageSharedKeyCredential;
  private ensurePromise?: Promise<void>;

  constructor() {
    this.env = backendEnv();
    this.provider = this.env.STORAGE_PROVIDER;
    this.bucketName =
      this.provider === "azure"
        ? this.env.AZURE_BLOB_CONTAINER ?? this.env.STORAGE_BUCKET
        : this.env.STORAGE_BUCKET;

    if (this.provider === "minio") {
      this.s3Client = new S3Client({
        endpoint: this.env.S3_ENDPOINT,
        region: this.env.S3_REGION,
        credentials: {
          accessKeyId: this.env.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: this.env.S3_SECRET_ACCESS_KEY ?? "",
        },
        forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
      });
    } else {
      const connectionString = this.env.AZURE_STORAGE_CONNECTION_STRING ?? "";
      this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
      const sharedKey = parseAzureSharedKey(connectionString);
      this.azureSharedKey = sharedKey
        ? new StorageSharedKeyCredential(sharedKey.accountName, sharedKey.accountKey)
        : undefined;
    }
  }

  async uploadObject(input: UploadObjectInput): Promise<StoredObject> {
    await this.ensureContainer();

    if (this.provider === "minio") {
      await this.requiredS3().send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: input.objectKey,
          Body: input.body,
          ContentLength: input.fileSize,
          ContentType: input.mimeType,
        }),
      );
    } else {
      const blob = this.requiredBlobService()
        .getContainerClient(this.bucketName)
        .getBlockBlobClient(input.objectKey);
      await blob.uploadData(input.body, {
        blobHTTPHeaders: { blobContentType: input.mimeType },
      });
    }

    return {
      provider: this.provider,
      bucketName: this.bucketName,
      objectKey: input.objectKey,
      publicUrl: this.publicUrlFor(input.objectKey),
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    const bucketName = input.bucketName ?? this.bucketName;

    if (this.provider === "minio") {
      await this.requiredS3().send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: input.objectKey,
        }),
      );
      return;
    }

    await this.requiredBlobService()
      .getContainerClient(bucketName)
      .deleteBlob(input.objectKey);
  }

  async getReadUrl(input: ReadUrlInput): Promise<string> {
    const bucketName = input.bucketName ?? this.bucketName;
    const publicUrl = this.publicUrlFor(input.objectKey);
    if (publicUrl) return publicUrl;

    if (this.provider === "minio") {
      return getSignedUrl(
        this.requiredS3(),
        new GetObjectCommand({
          Bucket: bucketName,
          Key: input.objectKey,
        }),
        { expiresIn: input.expiresInSeconds ?? 15 * 60 },
      );
    }

    const blob = this.requiredBlobService()
      .getContainerClient(bucketName)
      .getBlobClient(input.objectKey);

    if (!this.azureSharedKey) {
      return blob.url;
    }

    const startsOn = new Date(Date.now() - 60_000);
    const expiresOn = new Date(Date.now() + (input.expiresInSeconds ?? 15 * 60) * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: bucketName,
        blobName: input.objectKey,
        permissions: BlobSASPermissions.parse("r"),
        startsOn,
        expiresOn,
      },
      this.azureSharedKey,
    ).toString();

    return `${blob.url}?${sas}`;
  }

  private ensureContainer(): Promise<void> {
    this.ensurePromise ??=
      this.provider === "minio" ? this.ensureS3Bucket() : this.ensureAzureContainer();
    return this.ensurePromise;
  }

  private async ensureS3Bucket(): Promise<void> {
    const s3 = this.requiredS3();
    try {
      await s3.send(new HeadBucketCommand({ Bucket: this.bucketName }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: this.bucketName }));
    }
  }

  private async ensureAzureContainer(): Promise<void> {
    await this.requiredBlobService()
      .getContainerClient(this.bucketName)
      .createIfNotExists();
  }

  private publicUrlFor(objectKey: string): string | null {
    if (!this.env.STORAGE_PUBLIC_BASE_URL) return null;
    const base = this.env.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, "");
    const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
    return `${base}/${encodedKey}`;
  }

  private requiredS3(): S3Client {
    if (!this.s3Client) {
      throw new Error("S3 storage client is not configured");
    }
    return this.s3Client;
  }

  private requiredBlobService(): BlobServiceClient {
    if (!this.blobServiceClient) {
      throw new Error("Azure Blob storage client is not configured");
    }
    return this.blobServiceClient;
  }
}

function parseAzureSharedKey(connectionString: string): AzureSharedKey | null {
  const parts = new Map<string, string>();
  for (const segment of connectionString.split(";")) {
    const index = segment.indexOf("=");
    if (index <= 0) continue;
    parts.set(segment.slice(0, index), segment.slice(index + 1));
  }

  const accountName = parts.get("AccountName");
  const accountKey = parts.get("AccountKey");
  if (!accountName || !accountKey) return null;
  return { accountName, accountKey };
}
