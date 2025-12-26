import React, { useCallback, useMemo } from "react";
import { Label } from "./ui/label";
import { Input } from "./ui/input";

export type NumberFieldProps = Readonly<{
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  error?: string | null;
}>;

/**
 * Numeric input stored as a string to avoid invalid transient states.
 */
export function NumberField(props: NumberFieldProps): React.ReactElement {
  const inputProps = useMemo(() => {
    const p: Record<string, string | number | undefined> = {
      min: props.min,
      max: props.max,
      step: props.step
    };

    return p;
  }, [props.max, props.min, props.step]);

  const onChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      props.onChange(ev.target.value);
    },
    [props]
  );

  return (
    <div className="space-y-2">
      <Label>{props.label}</Label>
      <Input
        value={props.value}
        onChange={onChange}
        type="number"
        placeholder={props.placeholder ?? ""}
        min={inputProps.min}
        max={inputProps.max}
        step={inputProps.step}
      />
      {props.help && <p className="text-caption text-muted-foreground">{props.help}</p>}
      {props.error && <p className="text-caption text-destructive">{props.error}</p>}
    </div>
  );
}



