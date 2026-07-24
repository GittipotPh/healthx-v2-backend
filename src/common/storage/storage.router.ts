import type { BackendEnv } from "../../env";
import { AzureBlobStorageAdapter } from "./azure-blob-storage.adapter";
import { MinioStorageAdapter } from "./minio-storage.adapter";
import type {
  DeleteObjectInput,
  InspectObjectInput,
  ReadObjectInput,
  ReadUrlInput,
  StorageObjectProperties,
  StoragePort,
  StoredObject,
  TagObjectInput,
  UploadObjectInput,
} from "./storage.port";

export class StorageRouter {
  private readonly active: StoragePort;
  private readonly readUrlTtlSeconds: number;

  constructor(env: BackendEnv) {
    this.active =
      env.STORAGE_PROVIDER === "azure"
        ? new AzureBlobStorageAdapter(env)
        : new MinioStorageAdapter(env);
    this.readUrlTtlSeconds = env.STORAGE_READ_URL_TTL_SECONDS;
  }

  uploadObject(input: UploadObjectInput): Promise<StoredObject> {
    return this.active.uploadObject(input);
  }

  deleteObject(input: DeleteObjectInput): Promise<void> {
    return this.route(input.provider).deleteObject(input);
  }

  getReadUrl(input: ReadUrlInput): Promise<string> {
    const expiresInSeconds = Math.min(
      input.expiresInSeconds ?? this.readUrlTtlSeconds,
      this.readUrlTtlSeconds,
    );
    return this.route(input.provider).getReadUrl({
      ...input,
      expiresInSeconds,
    });
  }

  readObject(input: ReadObjectInput): Promise<Buffer> {
    return this.route(input.provider).readObject(input);
  }

  inspectObject(
    input: InspectObjectInput,
  ): Promise<StorageObjectProperties> {
    return this.route(input.provider).inspectObject(input);
  }

  tagObject(input: TagObjectInput): Promise<void> {
    return this.route(input.provider).tagObject(input);
  }

  readiness(): Promise<void> {
    return this.active.readiness();
  }

  private route(provider: DeleteObjectInput["provider"]): StoragePort {
    if (provider && provider !== this.active.provider) {
      throw new Error(
        `Stored object provider ${provider} does not match configured provider ${this.active.provider}`,
      );
    }
    return this.active;
  }
}
