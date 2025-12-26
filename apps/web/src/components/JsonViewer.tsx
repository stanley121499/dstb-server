import React from "react";

/**
 * Small JSON viewer with safe stringify.
 */
export function JsonViewer(props: Readonly<{ value: unknown }>): React.ReactElement {
  const text = (() => {
    try {
      return JSON.stringify(props.value, null, 2);
    } catch {
      return "<unserializable>";
    }
  })();

  return <pre className="code">{text}</pre>;
}




