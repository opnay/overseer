import { Field } from "@opnay/city-ds-react/field";
import { NumberInput } from "@opnay/city-ds-react/number-input";

export function DockerEngineNumberSetting({
  description,
  error,
  label,
  min,
  onChange,
  value,
}: {
  description?: string;
  error?: string;
  label: string;
  min: number;
  onChange(value: number | null): void;
  value: number | null;
}) {
  return (
    <Field.Root invalid={Boolean(error)}>
      <Field.Label>{label}</Field.Label>
      <NumberInput.Root
        min={min}
        onValueChange={(nextValue) => onChange(nextValue ?? null)}
        step={1}
        value={value}
      >
        <NumberInput.Group>
          <NumberInput.Input aria-label={label} />
          <NumberInput.Decrement aria-label={`${label} 감소`} />
          <NumberInput.Increment aria-label={`${label} 증가`} />
        </NumberInput.Group>
      </NumberInput.Root>
      {description ? <Field.Description>{description}</Field.Description> : null}
      <Field.Error match>{error}</Field.Error>
    </Field.Root>
  );
}
