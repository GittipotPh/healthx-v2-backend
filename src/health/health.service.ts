import { Injectable } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis/redis.service";

type DependencyStatus = "ok" | "down";

export class DependencyHealth {
  @ApiProperty({ enum: ["ok", "down"], enumName: "DependencyStatus" })
  status!: DependencyStatus;

  @ApiProperty()
  latencyMs!: number;

  @ApiProperty({ required: false })
  message?: string;
}

export class HealthDependencies {
  @ApiProperty({ type: DependencyHealth })
  api!: DependencyHealth;

  @ApiProperty({ type: DependencyHealth })
  database!: DependencyHealth;

  @ApiProperty({ type: DependencyHealth })
  redis!: DependencyHealth;
}

export class HealthResult {
  @ApiProperty({ enum: ["ok", "degraded"], enumName: "HealthStatus" })
  status!: "ok" | "degraded";

  @ApiProperty({ description: "ISO timestamp" })
  checkedAt!: string;

  @ApiProperty({ type: HealthDependencies })
  dependencies!: HealthDependencies;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthResult> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const api: DependencyHealth = { status: "ok", latencyMs: 0 };
    const status =
      database.status === "ok" && redis.status === "ok" ? "ok" : "degraded";

    return {
      status,
      checkedAt: new Date().toISOString(),
      dependencies: { api, database, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyHealth> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", latencyMs: Date.now() - started };
    } catch (error) {
      return {
        status: "down",
        latencyMs: Date.now() - started,
        message: this.message(error),
      };
    }
  }

  private async checkRedis(): Promise<DependencyHealth> {
    const started = Date.now();
    try {
      await this.redis.client.ping();
      return { status: "ok", latencyMs: Date.now() - started };
    } catch (error) {
      return {
        status: "down",
        latencyMs: Date.now() - started,
        message: this.message(error),
      };
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
