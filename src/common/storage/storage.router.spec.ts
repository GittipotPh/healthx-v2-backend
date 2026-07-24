import { validateEnv } from "../../env";
import { MinioStorageAdapter } from "./minio-storage.adapter";
import { StorageRouter } from "./storage.router";

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/healthx_test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters",
  STORAGE_PROVIDER: "minio",
  STORAGE_BUCKET: "healthx-test",
  STORAGE_READ_URL_TTL_SECONDS: "600",
};

describe("StorageRouter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("caps object read URLs at the configured TTL", async () => {
    const getReadUrl = jest
      .spyOn(MinioStorageAdapter.prototype, "getReadUrl")
      .mockResolvedValue("http://localhost/read");
    const router = new StorageRouter(validateEnv(BASE_ENV));

    await expect(
      router.getReadUrl({
        provider: "minio",
        bucketName: "healthx-test",
        objectKey: "clinics/CL-1/charts/test.png",
        expiresInSeconds: 3_600,
      }),
    ).resolves.toBe("http://localhost/read");
    expect(getReadUrl).toHaveBeenCalledWith({
      provider: "minio",
      bucketName: "healthx-test",
      objectKey: "clinics/CL-1/charts/test.png",
      expiresInSeconds: 600,
    });
  });

  it("refuses to route a stored object through another provider", () => {
    const readObject = jest.spyOn(MinioStorageAdapter.prototype, "readObject");
    const router = new StorageRouter(validateEnv(BASE_ENV));

    expect(() =>
      router.readObject({
        provider: "azure",
        bucketName: "healthx-dev",
        objectKey: "clinics/CL-1/charts/test.png",
      }),
    ).toThrow(
      "Stored object provider azure does not match configured provider minio",
    );
    expect(readObject).not.toHaveBeenCalled();
  });
});
