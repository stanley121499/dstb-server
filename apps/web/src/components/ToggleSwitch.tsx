import React from "react";

export type ToggleSwitchProps = Readonly<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}>;

/**
 * Boolean toggle for independent features.
 */
export function ToggleSwitch(props: ToggleSwitchProps): React.ReactElement {
  return (
    <label
      className="card"
      style={{
        padding: 12,
        borderRadius: 12,
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        alignItems: "center",
        cursor: "pointer"
      }}
    >
      <div className="col" style={{ gap: 2 }}>
        <span style={{ fontWeight: 700 }}>{props.label}</span>
        {props.description ? <span className="muted" style={{ fontSize: 12 }}>{props.description}</span> : null}
      </div>

      <input
        type="checkbox"
        checked={props.checked}
        onChange={(ev) => props.onChange(ev.target.checked)}
        aria-label={props.label}
      />
    </label>
  );
}
