import { Injectable } from "@nestjs/common";
import { backendEnv } from "../../env";
import type {
  DeleteObjectInput,
  InspectObjectInput,
  ReadObjectInput,
  ReadUrlInput,
  StorageObjectProperties,
  StoredObject,
  TagObjectInput,
  UploadObjectInput,
} from "./storage.port";
import { StorageRouter } from "./storage.router";

export type {
  DeleteObjectInput,
  InspectObjectInput,
  ReadObjectInput,
  ReadUrlInput,
  StorageObjectProperties,
  StorageProvider,
  StoredObject,
  TagObjectInput,
  UploadObjectInput,
} from "./storage.port";

@Injectable()
export class StorageService {
  private readonly router = new StorageRouter(backendEnv());

  uploadObject(input: UploadObjectInput): Promise<StoredObject> {
    return this.router.uploadObject(input);
  }

  deleteObject(input: DeleteObjectInput): Promise<void> {
    return this.router.deleteObject(input);
  }

  getReadUrl(input: ReadUrlInput): Promise<string> {
    return this.router.getReadUrl(input);
  }

  readObject(input: ReadObjectInput): Promise<Buffer> {
    return this.router.readObject(input);
  }

  inspectObject(
    input: InspectObjectInput,
  ): Promise<StorageObjectProperties> {
    return this.router.inspectObject(input);
  }

  tagObject(input: TagObjectInput): Promise<void> {
    return this.router.tagObject(input);
  }

  readiness(): Promise<void> {
    return this.router.readiness();
  }
}
