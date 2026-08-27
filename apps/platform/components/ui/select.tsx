"use client";

import { useId, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label?: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

/**
 * Built on a native `<select>`. It gives correct keyboard behaviour, screen
 * reader support and the platform picker on mobile for free; only the chrome is
 * restyled.
 */
export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  id,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const messageId = `${selectId}-message`;
  const invalid = Boolean(error);

  return (
    <div className="flex flex-col gap-1.5" data-slot="select-field">
      {label ? (
        <label htmlFor={selectId} className="label-xs text-ink-muted">
          {label}
        </label>
      ) : null}

      <div className="relative">
        <select
          id={selectId}
          data-slot="select"
          aria-invalid={invalid || undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={cn(
            "h-11 w-full appearance-none rounded-md border bg-surface ps-3 pe-9 text-sm text-ink",
            "transition-colors duration-200 outline-none",
            "disabled:cursor-not-allowed disabled:opacity-55",
            invalid ? "border-danger" : "border-border focus:border-brand-line",
            className,
          )}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>

        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        >
          <path d="M6 8l4 4 4-4" strokeLinecap="round" />
        </svg>
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
