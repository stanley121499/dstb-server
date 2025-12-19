import React from "react";

export type RadioOption<T extends string> = Readonly<{
  value: T;
  label: string;
  description?: string;
}>;

export type RadioGroupProps<T extends string> = Readonly<{
  label: string;
  value: T;
  options: readonly RadioOption<T>[];
  onChange: (value: T) => void;
}>;

/**
 * Single-select control for mutually exclusive choices.
 */
export function RadioGroup<T extends string>(props: RadioGroupProps<T>): React.ReactElement {
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="label">{props.label}</span>
      <div className="row" style={{ gap: 8 }}>
        {props.options.map((opt) => {
          const id = `${props.label}-${opt.value}`;

          return (
            <label
              key={opt.value}
              htmlFor={id}
              className="card"
              style={{
                padding: 10,
                borderRadius: 12,
                borderColor: opt.value === props.value ? "rgba(96, 165, 250, 0.55)" : undefined,
                cursor: "pointer",
                minWidth: 160
              }}
            >
              <div className="row" style={{ alignItems: "center", gap: 8 }}>
                <input
                  id={id}
                  type="radio"
                  checked={opt.value === props.value}
                  onChange={() => props.onChange(opt.value)}
                />
                <div className="col" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 700 }}>{opt.label}</span>
                  {opt.description ? <span className="muted" style={{ fontSize: 12 }}>{opt.description}</span> : null}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
