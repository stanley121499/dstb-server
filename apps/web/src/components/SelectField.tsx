import React, { useCallback } from "react";

export type SelectOption<T extends string> = Readonly<{
  value: T;
  label: string;
}>;

export type SelectFieldProps<T extends string> = Readonly<{
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  help?: string;
}>;

/**
 * Typed select field.
 */
export function SelectField<T extends string>(props: SelectFieldProps<T>): React.ReactElement {
  const onChange = useCallback(
    (ev: React.ChangeEvent<HTMLSelectElement>) => {
      // Avoid unsafe casts: map the raw string back to a known option value.
      const raw = ev.target.value;
      const match = props.options.find((o) => o.value === raw);

      if (match) {
        props.onChange(match.value);
      }
    },
    [props]
  );

  return (
    <label className="col" style={{ gap: 6 }}>
      <span className="label">{props.label}</span>
      <select className="select" value={props.value} onChange={onChange}>
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {props.help ? <span className="muted" style={{ fontSize: 12 }}>{props.help}</span> : null}
    </label>
  );
}
