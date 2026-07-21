import { BadRequestException } from "@nestjs/common";
import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host";
import { VersionConflictException } from "../version-conflict.exception";
import { AllExceptionsFilter } from "./all-exceptions.filter";

describe("AllExceptionsFilter", () => {
  it("preserves the stable optimistic-concurrency metadata", () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = new ExecutionContextHost([{}, { status }]);

    new AllExceptionsFilter().catch(
      new VersionConflictException({
        resourceType: "opd_vital_observation",
        resourceId: "d0be6460-630b-4d50-b9bc-7fdb58c46cdc",
        currentVersion: 3,
        currentStatus: "DRAFT",
        updatedAt: "2026-07-20T12:00:00.000Z",
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      status: "8999",
      message:
        "This clinical section changed in another session. Reload before saving again.",
      code: "CLINICAL_VERSION_CONFLICT",
      resourceType: "opd_vital_observation",
      resourceId: "d0be6460-630b-4d50-b9bc-7fdb58c46cdc",
      currentVersion: 3,
      currentStatus: "DRAFT",
      updatedAt: "2026-07-20T12:00:00.000Z",
    });
  });

  it("preserves structured business-error details", () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = new ExecutionContextHost([{}, { status }]);

    new AllExceptionsFilter().catch(
      new BadRequestException({
        message: "Medication release is blocked",
        code: "OPD_RELEASE_BLOCKED",
        details: {
          blockers: [{ code: "LOT_SELECTION_REQUIRED" }],
          totals: { netTotalAmount: 100 },
        },
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      status: "8999",
      message: "Medication release is blocked",
      code: "OPD_RELEASE_BLOCKED",
      details: {
        blockers: [{ code: "LOT_SELECTION_REQUIRED" }],
        totals: { netTotalAmount: 100 },
      },
    });
  });
});
