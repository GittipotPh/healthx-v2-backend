import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { QueueController } from "./queue.controller";

function requiredPermissions(
  method: keyof QueueController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    QueueController.prototype[method],
  ) as PermissionRequirement | undefined;
}

describe("QueueController permission metadata", () => {
  it.each<keyof QueueController>([
    "today",
    "transition",
    "saveConsultation",
    "saveAnesthetic",
    "getConfig",
    "updateConfig",
  ])(
    "preserves the existing shared authorization behavior for %s",
    (method) => {
      expect(requiredPermissions(method)).toBeUndefined();
    },
  );
});
