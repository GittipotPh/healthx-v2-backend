export type StorageProvider = "minio" | "azure";

export type StorageObjectTags = Readonly<Record<string, string>>;

export interface UploadObjectInput {
  objectKey: string;
  body: Buffer;
  mimeType: string;
  fileSize: number;
  createOnly?: boolean;
  tags?: StorageObjectTags;
}

export interface StoredObject {
  provider: StorageProvider;
  bucketName: string;
  objectKey: string;
  publicUrl: string | null;
  eTag: string;
}

export interface StorageObjectLocator {
  provider?: StorageProvider;
  bucketName?: string;
  objectKey: string;
}

export interface DeleteObjectInput extends StorageObjectLocator {}

export interface ReadUrlInput extends StorageObjectLocator {
  expiresInSeconds?: number;
}

export interface ReadObjectInput extends StorageObjectLocator {}

export interface InspectObjectInput extends StorageObjectLocator {}

export interface TagObjectInput extends StorageObjectLocator {
  tags: StorageObjectTags;
}

export interface StorageObjectProperties {
  provider: StorageProvider;
  bucketName: string;
  objectKey: string;
  eTag: string;
  fileSize: number;
  mimeType: string | null;
  tags: StorageObjectTags;
}

export interface StoragePort {
  readonly provider: StorageProvider;
  readonly bucketName: string;

  uploadObject(input: UploadObjectInput): Promise<StoredObject>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  getReadUrl(input: ReadUrlInput): Promise<string>;
  readObject(input: ReadObjectInput): Promise<Buffer>;
  inspectObject(input: InspectObjectInput): Promise<StorageObjectProperties>;
  tagObject(input: TagObjectInput): Promise<void>;
  readiness(): Promise<void>;
}

export function normalizeETag(value: string | undefined): string {
  const normalized = value?.trim().replace(/^"|"$/gu, "") ?? "";
  if (!normalized) {
    throw new Error("Storage provider returned no object ETag");
  }
  return normalized;
}

export function encodeObjectTags(tags: StorageObjectTags): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(tags)) {
    params.set(key, value);
  }
  return params.toString();
}
