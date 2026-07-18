import type { ExecutionContext } from "@nestjs/common";
import { ServiceUnavailableException } from "@nestjs/common";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

const backendEnvMock = jest.fn();

jest.mock("../../env", () => ({
  backendEnv: () => backendEnvMock(),
}));

describe("OpdV2EnabledGuard", () => {
  const guard = new OpdV2EnabledGuard();
  const context = {} as ExecutionContext;

  beforeEach(() => backendEnvMock.mockReset());

  it("allows the V2 surface when enabled", () => {
    backendEnvMock.mockReturnValue({ OPD_V2_ENABLED: true });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("provides a deployment kill switch without falling back to mock writes", () => {
    backendEnvMock.mockReturnValue({ OPD_V2_ENABLED: false });
    expect(() => guard.canActivate(context)).toThrow(
      ServiceUnavailableException,
    );
  });
});
