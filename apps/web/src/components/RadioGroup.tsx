import React from "react";
import { cn } from "../lib/utils";

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
 * Redesigned with modern styling and better accessibility.
 */
export function RadioGroup<T extends string>(props: RadioGroupProps<T>): React.ReactElement {
  return (
    <div className="space-y-3">
      {props.label && <label className="text-small font-medium">{props.label}</label>}
      <div className="flex flex-col sm:flex-row gap-3">
        {props.options.map((opt) => {
          const id = `${props.label}-${opt.value}`;
          const isSelected = opt.value === props.value;

          return (
            <label
              key={opt.value}
              htmlFor={id}
              className={cn(
                "flex items-center gap-3 p-4 rounded-sm border-2 cursor-pointer transition-all duration-150",
                "hover:bg-secondary/50",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-background"
              )}
            >
              <input
                id={id}
                type="radio"
                checked={isSelected}
                onChange={() => props.onChange(opt.value)}
                className="h-4 w-4 border-border text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2"
              />
              <div className="flex-1 space-y-1">
                <span className="text-small font-medium block">{opt.label}</span>
                {opt.description && (
                  <span className="text-caption text-muted-foreground block">
                    {opt.description}
                  </span>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}



