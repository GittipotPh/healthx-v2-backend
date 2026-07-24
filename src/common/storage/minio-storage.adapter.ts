import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { BackendEnv } from "../../env";
import {
  encodeObjectTags,
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

export class MinioStorageAdapter implements StoragePort {
  readonly provider = "minio" as const;
  readonly bucketName: string;

  private readonly client: S3Client;
  private readonly autoCreateContainer: boolean;
  private readonly publicBaseUrl?: string;
  private ensurePromise?: Promise<void>;

  constructor(env: BackendEnv) {
    this.bucketName = env.STORAGE_BUCKET;
    this.autoCreateContainer = env.STORAGE_AUTO_CREATE_CONTAINER;
    this.publicBaseUrl = env.STORAGE_PUBLIC_BASE_URL;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
      },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  async uploadObject(input: UploadObjectInput): Promise<StoredObject> {
    await this.ensureContainer();
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: input.objectKey,
        Body: input.body,
        ContentLength: input.fileSize,
        ContentType: input.mimeType,
        IfNoneMatch: input.createOnly ? "*" : undefined,
        Tagging: input.tags ? encodeObjectTags(input.tags) : undefined,
      }),
    );
    return {
      provider: this.provider,
      bucketName: this.bucketName,
      objectKey: input.objectKey,
      publicUrl: this.publicUrlFor(input.objectKey),
      eTag: normalizeETag(response.ETag),
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: input.bucketName ?? this.bucketName,
        Key: input.objectKey,
      }),
    );
  }

  async getReadUrl(input: ReadUrlInput): Promise<string> {
    const publicUrl = this.publicUrlFor(input.objectKey);
    if (publicUrl) return publicUrl;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: input.bucketName ?? this.bucketName,
        Key: input.objectKey,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async readObject(input: ReadObjectInput): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: input.bucketName ?? this.bucketName,
        Key: input.objectKey,
      }),
    );
    if (!response.Body) {
      throw new Error("Stored object returned no body");
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async inspectObject(
    input: InspectObjectInput,
  ): Promise<StorageObjectProperties> {
    const bucketName = input.bucketName ?? this.bucketName;
    const [head, tags] = await Promise.all([
      this.client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: input.objectKey,
        }),
      ),
      this.client.send(
        new GetObjectTaggingCommand({
          Bucket: bucketName,
          Key: input.objectKey,
        }),
      ),
    ]);
    return {
      provider: this.provider,
      bucketName,
      objectKey: input.objectKey,
      eTag: normalizeETag(head.ETag),
      fileSize: head.ContentLength ?? 0,
      mimeType: head.ContentType ?? null,
      tags: Object.fromEntries(
        (tags.TagSet ?? []).flatMap((tag) =>
          tag.Key !== undefined && tag.Value !== undefined
            ? [[tag.Key, tag.Value]]
            : [],
        ),
      ),
    };
  }

  async tagObject(input: TagObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectTaggingCommand({
        Bucket: input.bucketName ?? this.bucketName,
        Key: input.objectKey,
        Tagging: {
          TagSet: Object.entries(input.tags).map(([Key, Value]) => ({
            Key,
            Value,
          })),
        },
      }),
    );
  }

  async readiness(): Promise<void> {
    await this.ensureContainer();
  }

  private ensureContainer(): Promise<void> {
    this.ensurePromise ??= this.ensureContainerOnce();
    return this.ensurePromise;
  }

  private async ensureContainerOnce(): Promise<void> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
    } catch (error) {
      if (!this.autoCreateContainer) throw error;
      await this.client.send(
        new CreateBucketCommand({ Bucket: this.bucketName }),
      );
    }
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
