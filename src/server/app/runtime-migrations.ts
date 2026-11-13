import type { LimaDockerRuntime } from "../infrastructure/lima/lima-docker-runtime.ts";
import type { OperationQueue } from "../modules/operations/index.ts";

export async function scheduleMacOSHostGatewayMigrations(
  runtime: LimaDockerRuntime,
  operations: OperationQueue,
): Promise<void> {
  const names = await runtime.pendingMacOSHostGatewayMigrations();
  for (const name of names)
    operations.enqueue({
      exclusive: true,
      kind: "runtime.daemon.configure",
      locks: [],
      run: (progress) => runtime.migrateMacOSHostGateway(name, progress),
      successMessage:
        "host-gateway의 macOS 연결을 기본 활성화했습니다. 기존 컨테이너에도 적용하려면 다시 만드십시오.",
      target: { name, resource: "runtime" },
      title: "host-gateway macOS 연결 마이그레이션",
    });
}
