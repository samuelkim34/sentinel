"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Input } from "./ui";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "autoComplete" | "readOnly">;

export function PasswordConfirmation({ onFocus, onBlur, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  // Password managers may ignore autocomplete=off. An unfocused confirmation
  // stays read-only so saved login credentials are not filled on page load.
  return <Input {...props} type="password" autoComplete="off" readOnly={!focused}
    data-lpignore="true" data-1p-ignore="true" data-bwignore="true"
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); onBlur?.(event); }} />;
}
