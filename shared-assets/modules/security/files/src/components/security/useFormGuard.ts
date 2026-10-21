"use client";

import { useState, type CSSProperties, type ChangeEvent } from "react";

// Visually hidden (not display:none, which some bots skip) and unreachable
// by keyboard, so real/assistive-tech users never encounter or fill it in.
const HONEYPOT_STYLE: CSSProperties = {
  position: "absolute",
  left: "-9999px",
  width: "1px",
  height: "1px",
  opacity: 0,
  pointerEvents: "none",
};

/**
 * Wires up the honeypot field + submit-timing check shared by every public
 * form. `renderedAt` is captured once, at first render, and sent back to
 * the server action so it can reject sub-2-second "submissions" that never
 * actually rendered/were read by a human.
 */
export function useFormGuard() {
  const [honeypotValue, setHoneypotValue] = useState("");
  const [renderedAt] = useState(() => Date.now());

  const honeypotFieldProps = {
    type: "text",
    name: "website",
    value: honeypotValue,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setHoneypotValue(e.target.value),
    autoComplete: "off",
    tabIndex: -1,
    "aria-hidden": true as const,
    style: HONEYPOT_STYLE,
  };

  return { honeypotValue, renderedAt, honeypotFieldProps };
}
