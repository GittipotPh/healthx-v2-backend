import {
  type ExecutionContext,
  ServiceUnavailableException,
} from "@nestjs/common";
import { OpdChartRasterEnabledGuard } from "./opd-chart-raster-enabled.guard";

const backendEnvMock = jest.fn();

jest.mock("../../env", () => ({
  backendEnv: () => backendEnvMock(),
}));

describe("OpdChartRasterEnabledGuard", () => {
  const guard = new OpdChartRasterEnabledGuard();
  const context = {} as ExecutionContext;

  beforeEach(() => backendEnvMock.mockReset());

  it("allows raster writes when the environment has been approved", () => {
    backendEnvMock.mockReturnValue({
      OPD_CHART_RASTER_AUTOSAVE_ENABLED: true,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("keeps raster writes disabled by default without fake persistence", () => {
    backendEnvMock.mockReturnValue({
      OPD_CHART_RASTER_AUTOSAVE_ENABLED: false,
    });
    expect(() => guard.canActivate(context)).toThrow(
      ServiceUnavailableException,
    );
  });
});
