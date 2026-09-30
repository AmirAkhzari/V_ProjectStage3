import { useState, type RefObject } from "react";
import { toFaDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  digits: string[];
  refs: RefObject<(HTMLInputElement | null)[]>;
  onDigit: (index: number, value: string) => void;
  onBackspace: (index: number) => void;
  error?: boolean;
  disabled?: boolean;
};

/** Segmented numeric input, ported from the admin/client OTP slots. Length comes from the backend. */
export default function CodeSlots({ digits, refs, onDigit, onBackspace, error, disabled }: Props) {
  const [focused, setFocused] = useState(0);
  return (
    <div
      className={cn("flex justify-between gap-2", error && "otp-slots-error")}
      dir="ltr"
      role="group"
      aria-label="کد تحویل"
      aria-busy={disabled || undefined}
    >
      {digits.map((digit, index) => {
        const filled = Boolean(digit);
        const active = focused === index && !filled && !disabled;
        return (
          <label
            key={index}
            className={cn(
              "relative block h-[72px] min-w-0 flex-1 cursor-text rounded-[16px]",
              error && "ring-2 ring-error/60",
            )}
            onPointerDown={() => {
              if (!disabled) refs.current?.[index]?.focus();
            }}
          >
            <input
              ref={(el) => {
                if (refs.current) refs.current[index] = el;
              }}
              value={digit}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={digits.length}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={`رقم ${index + 1}`}
              disabled={disabled}
              onChange={(e) => onDigit(index, e.target.value)}
              onFocus={() => setFocused(index)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !digits[index] && index > 0) {
                  e.preventDefault();
                  onBackspace(index);
                }
              }}
              className="absolute inset-0 z-10 size-full cursor-text bg-transparent text-center text-transparent caret-transparent outline-none disabled:cursor-wait"
            />
            {filled ? (
              <span className="otp-digit pointer-events-none absolute inset-0 flex items-center justify-center rounded-[16px] bg-fill text-[28px] font-bold">
                {toFaDigits(digit)}
              </span>
            ) : (
              <span
                className="otp-skel pointer-events-none absolute inset-0 rounded-[16px] bg-gray-5"
                style={{ animationDelay: `${index * 140}ms` }}
                data-active={active ? "true" : "false"}
                aria-hidden
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
