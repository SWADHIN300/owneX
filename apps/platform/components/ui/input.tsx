"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  /** Helper text under the field. Hidden while an error is showing. */
  hint?: string;
  error?: string;
  /** Monospace and no ligatures, for addresses and hashes. */
  mono?: boolean;
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
}

export function Input({
  label,
  hint,
  error,
  mono = false,
  leadingIcon,
  trailingSlot,
  className,
  id,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const invalid = Boolean(error);

  return (
    <div className="flex flex-col gap-1.5" data-slot="input-field">
      {label ? (
        <label
          htmlFor={inputId}
          className="label-xs text-ink-muted"
        >
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-surface px-3",
          "transition-colors duration-200",
          invalid
            ? "border-danger"
            : "border-border focus-within:border-brand-line",
          props.disabled && "opacity-55",
        )}
      >
        {leadingIcon ? (
          <span className="shrink-0 text-ink-faint" aria-hidden>
            {leadingIcon}
          </span>
        ) : null}

        <input
          id={inputId}
          data-slot="input"
          aria-invalid={invalid || undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={cn(
            "h-11 w-full min-w-0 bg-transparent text-sm text-ink outline-none",
            "placeholder:text-ink-faint",
            mono && "font-mono text-[0.8125rem] tracking-tight",
            className,
          )}
          {...props}
        />

        {trailingSlot ? (
          <span className="shrink-0">{trailingSlot}</span>
        ) : null}
      </div>

      {error ? (
        <p id={messageId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
