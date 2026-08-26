import { Field } from "@opnay/city-ds-react/field";
import { NumberField } from "@opnay/city-ds-react/number-field";

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
      <NumberField.Root
        min={min}
        onValueChange={(nextValue) => onChange(nextValue ?? null)}
        step={1}
        value={value}
      >
        <NumberField.Group>
          <NumberField.Input aria-label={label} />
          <NumberField.Decrement aria-label={`${label} 감소`} />
          <NumberField.Increment aria-label={`${label} 증가`} />
        </NumberField.Group>
      </NumberField.Root>
      {description ? <Field.Description>{description}</Field.Description> : null}
      <Field.Error match>{error}</Field.Error>
    </Field.Root>
  );
}
