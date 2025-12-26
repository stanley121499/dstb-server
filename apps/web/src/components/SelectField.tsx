import React, { useCallback } from "react";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

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
 * Typed select field with modern dropdown (no overflow issues).
 */
export function SelectField<T extends string>(props: SelectFieldProps<T>): React.ReactElement {
  const onChange = useCallback(
    (value: string) => {
      // Avoid unsafe casts: map the raw string back to a known option value.
      const match = props.options.find((o) => o.value === value);

      if (match) {
        props.onChange(match.value);
      }
    },
    [props]
  );

  return (
    <div className="space-y-2">
      <Label>{props.label}</Label>
      <Select value={props.value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {props.help && <p className="text-caption text-muted-foreground">{props.help}</p>}
    </div>
  );
}



