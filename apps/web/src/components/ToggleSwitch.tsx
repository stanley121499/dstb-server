import React from "react";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";

export type ToggleSwitchProps = Readonly<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}>;

/**
 * Boolean toggle for independent features.
 * Redesigned with modern styling.
 */
export function ToggleSwitch(props: ToggleSwitchProps): React.ReactElement {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-4 p-4 rounded-sm border border-border bg-background cursor-pointer",
        "hover:bg-secondary/50 transition-all duration-150"
      )}
    >
      <div className="flex-1 space-y-1">
        <span className="text-small font-medium block">{props.label}</span>
        {props.description && (
          <span className="text-caption text-muted-foreground block">
            {props.description}
          </span>
        )}
      </div>

      <input
        type="checkbox"
        checked={props.checked}
        onChange={(ev) => props.onChange(ev.target.checked)}
        aria-label={props.label}
        className="h-5 w-5 rounded border-border text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors"
      />
    </label>
  );
}



