import { forwardRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn, formatNumberUSForInput } from "@/lib/utils";

export type UsCurrencyInputProps = Omit<
  ComponentProps<typeof Input>,
  "onChange" | "value" | "type"
> & {
  value: string;
  onChange: (next: string) => void;
};

/** US-formatted currency field: `$` prefix, comma thousands, optional decimals while typing. */
export const UsCurrencyInput = forwardRef<HTMLInputElement, UsCurrencyInputProps>(
  function UsCurrencyInput(
    { value, onChange, className, placeholder = "e.g. 250,000.00", ...rest },
    ref,
  ) {
    return (
      <div className="relative min-w-0">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
          aria-hidden
        >
          $
        </span>
        <Input
          {...rest}
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(formatNumberUSForInput(e.target.value))}
          placeholder={placeholder}
          className={cn("pl-7", className)}
        />
      </div>
    );
  },
);
