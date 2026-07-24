import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { OpdChartController } from "./opd-chart.controller";

function requiredPermissions(
  method: keyof OpdChartController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    OpdChartController.prototype[method],
  );
}

describe("OpdChartController", () => {
  it("separates scoped Chart reads from clinical writes", () => {
    expect(requiredPermissions("templates")).toEqual({
      allOf: ["OPD_READ"],
      anyOf: [],
    });
    expect(requiredPermissions("documents")).toEqual({
      allOf: ["OPD_READ"],
      anyOf: [],
    });
    expect(requiredPermissions("artifact")).toEqual({
      allOf: ["OPD_READ"],
      anyOf: [],
    });
    expect(requiredPermissions("saveDraft")).toEqual({
      allOf: ["OPD_EDIT"],
      anyOf: [],
    });
    expect(requiredPermissions("finalize")).toEqual({
      allOf: ["OPD_EDIT"],
      anyOf: [],
    });
  });
});
