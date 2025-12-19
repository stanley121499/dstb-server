import React, { useCallback, useMemo } from "react";

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
    <label className="col" style={{ gap: 6 }}>
      <span className="label">{props.label}</span>
      <input
        className="input"
        value={props.value}
        onChange={onChange}
        type="number"
        placeholder={props.placeholder ?? ""}
        min={inputProps.min}
        max={inputProps.max}
        step={inputProps.step}
      />
      {props.help ? <span className="muted" style={{ fontSize: 12 }}>{props.help}</span> : null}
      {props.error ? <span style={{ color: "var(--danger)", fontSize: 12 }}>{props.error}</span> : null}
    </label>
  );
}
