import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from "@azure/storage-blob";
import type { BackendEnv } from "../../env";
import {
  normalizeETag,
  type DeleteObjectInput,
  type InspectObjectInput,
  type ReadObjectInput,
  type ReadUrlInput,
  type StorageObjectProperties,
  type StoragePort,
  type StoredObject,
  type TagObjectInput,
  type UploadObjectInput,
} from "./storage.port";

interface CachedDelegationKey {
  key: UserDelegationKey;
  expiresAt: Date;
}

export class AzureBlobStorageAdapter implements StoragePort {
  readonly provider = "azure" as const;
  readonly bucketName: string;

  private readonly accountName: string;
  private readonly service: BlobServiceClient;
  private readonly publicBaseUrl?: string;
  private cachedDelegationKey?: CachedDelegationKey;

  constructor(env: BackendEnv) {
    const accountUrl = env.AZURE_STORAGE_ACCOUNT_URL;
    if (!accountUrl || !env.AZURE_BLOB_CONTAINER || !env.AZURE_CLIENT_ID) {
      throw new Error(
        "Azure Blob storage requires account URL, container, and managed identity client ID",
      );
    }
    const endpoint = new URL(accountUrl);
    const accountName = endpoint.hostname.split(".")[0];
    if (!accountName) {
      throw new Error("Azure Blob storage account URL is invalid");
    }
    this.accountName = accountName;
    this.bucketName = env.AZURE_BLOB_CONTAINER;
    this.publicBaseUrl = env.STORAGE_PUBLIC_BASE_URL;
    this.service = new BlobServiceClient(
      endpoint.toString().replace(/\/$/u, ""),
      new DefaultAzureCredential({
        managedIdentityClientId: env.AZURE_CLIENT_ID,
      }),
    );
  }

  async uploadObject(input: UploadObjectInput): Promise<StoredObject> {
    await this.readiness();
    const blob = this.service
      .getContainerClient(this.bucketName)
      .getBlockBlobClient(input.objectKey);
    const response = await blob.uploadData(input.body, {
      blobHTTPHeaders: { blobContentType: input.mimeType },
      conditions: input.createOnly ? { ifNoneMatch: "*" } : undefined,
      tags: input.tags ? { ...input.tags } : undefined,
    });
    return {
      provider: this.provider,
      bucketName: this.bucketName,
      objectKey: input.objectKey,
      publicUrl: this.publicUrlFor(input.objectKey),
      eTag: normalizeETag(response.etag),
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    await this.service
      .getContainerClient(input.bucketName ?? this.bucketName)
      .getBlobClient(input.objectKey)
      .deleteIfExists({ deleteSnapshots: "include" });
  }

  async getReadUrl(input: ReadUrlInput): Promise<string> {
    const publicUrl = this.publicUrlFor(input.objectKey);
    if (publicUrl) return publicUrl;

    const bucketName = input.bucketName ?? this.bucketName;
    const blob = this.service
      .getContainerClient(bucketName)
      .getBlobClient(input.objectKey);
    const now = Date.now();
    const startsOn = new Date(now - 60_000);
    const expiresOn = new Date(
      now + (input.expiresInSeconds ?? 600) * 1000,
    );
    const delegationKey = await this.getDelegationKey(expiresOn);
    const query = generateBlobSASQueryParameters(
      {
        containerName: bucketName,
        blobName: input.objectKey,
        permissions: BlobSASPermissions.parse("r"),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn,
      },
      delegationKey,
      this.accountName,
    ).toString();
    return `${blob.url}?${query}`;
  }

  async readObject(input: ReadObjectInput): Promise<Buffer> {
    return this.service
      .getContainerClient(input.bucketName ?? this.bucketName)
      .getBlobClient(input.objectKey)
      .downloadToBuffer();
  }

  async inspectObject(
    input: InspectObjectInput,
  ): Promise<StorageObjectProperties> {
    const bucketName = input.bucketName ?? this.bucketName;
    const blob = this.service
      .getContainerClient(bucketName)
      .getBlobClient(input.objectKey);
    const [properties, tags] = await Promise.all([
      blob.getProperties(),
      blob.getTags(),
    ]);
    return {
      provider: this.provider,
      bucketName,
      objectKey: input.objectKey,
      eTag: normalizeETag(properties.etag),
      fileSize: properties.contentLength ?? 0,
      mimeType: properties.contentType ?? null,
      tags: tags.tags,
    };
  }

  async tagObject(input: TagObjectInput): Promise<void> {
    await this.service
      .getContainerClient(input.bucketName ?? this.bucketName)
      .getBlobClient(input.objectKey)
      .setTags({ ...input.tags });
  }

  async readiness(): Promise<void> {
    const exists = await this.service
      .getContainerClient(this.bucketName)
      .exists();
    if (!exists) {
      throw new Error(
        "Configured Azure Blob container does not exist or is inaccessible",
      );
    }
  }

  private async getDelegationKey(
    requiredExpiry: Date,
  ): Promise<UserDelegationKey> {
    const cached = this.cachedDelegationKey;
    if (
      cached &&
      cached.expiresAt.getTime() - Date.now() > 5 * 60_000 &&
      cached.expiresAt >= requiredExpiry
    ) {
      return cached.key;
    }
    const startsOn = new Date(Date.now() - 5 * 60_000);
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const key = await this.service.getUserDelegationKey(
      startsOn,
      expiresAt,
    );
    this.cachedDelegationKey = { key, expiresAt };
    return key;
  }

  private publicUrlFor(objectKey: string): string | null {
    if (!this.publicBaseUrl) return null;
    const base = this.publicBaseUrl.replace(/\/$/u, "");
    const encodedKey = objectKey
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return `${base}/${encodedKey}`;
  }
}
