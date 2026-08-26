import { Fieldset } from "@opnay/city-ds-react/fieldset";
import type { RuntimeInstanceResources } from "../shared/contracts.ts";
import { DockerEngineNumberSetting } from "./docker-engine-number-setting.tsx";

export function RuntimeInstanceResourceFields({
  configuration,
  minimumDiskGiB = 10,
  onChange,
}: {
  configuration: RuntimeInstanceResources;
  minimumDiskGiB?: number;
  onChange(configuration: RuntimeInstanceResources): void;
}) {
  return (
    <Fieldset.Root appearance="plain">
      <Fieldset.Legend>VM 리소스</Fieldset.Legend>
      <Fieldset.Content className="overseer-settings-resource-grid">
        <DockerEngineNumberSetting
          description="가상 CPU 수"
          label="CPU"
          min={1}
          onChange={(cpus) => cpus != null && onChange({ ...configuration, cpus })}
          value={configuration.cpus}
        />
        <DockerEngineNumberSetting
          description="GiB 단위"
          label="메모리"
          min={1}
          onChange={(memoryGiB) => memoryGiB != null && onChange({ ...configuration, memoryGiB })}
          value={configuration.memoryGiB}
        />
        <DockerEngineNumberSetting
          description={`GiB 단위, 최소 ${minimumDiskGiB}GiB`}
          label="디스크"
          min={minimumDiskGiB}
          onChange={(diskGiB) => diskGiB != null && onChange({ ...configuration, diskGiB })}
          value={configuration.diskGiB}
        />
      </Fieldset.Content>
    </Fieldset.Root>
  );
}
