import React, { useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "../lib/utils";

export type TooltipProps = Readonly<{
  /** Content to display in the tooltip */
  content: string;
  /** Children elements (the trigger) */
  children: React.ReactNode;
}>;

/**
 * Tooltip component that shows helpful information on hover.
 * Redesigned with modern popover styling.
 */
export function Tooltip(props: TooltipProps): React.ReactElement {
  const [isVisible, setIsVisible] = useState<boolean>(false);

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {props.children}
      <HelpCircle className="ml-2 h-4 w-4 text-muted-foreground cursor-help hover:text-primary transition-colors" />
      {isVisible && (
        <div className={cn(
          "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50",
          "px-3 py-2 rounded-sm bg-popover border border-border shadow-lg",
          "text-small text-popover-foreground whitespace-nowrap max-w-xs",
          "pointer-events-none animate-in fade-in-0 zoom-in-95"
        )}>
          {props.content}
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="border-4 border-transparent border-t-border" />
          </div>
        </div>
      )}
    </div>
  );
}



