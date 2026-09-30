import { useState, type MutableRefObject } from "react";
import { toFaDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

type OtpSlotsProps = {
  digits: string[];
  refs: MutableRefObject<(HTMLInputElement | null)[]>;
  onDigit: (index: number, value: string) => void;
  onBackspace: (index: number) => void;
  error?: boolean;
  loading?: boolean;
};

export default function OtpSlots({ digits, refs, onDigit, onBackspace, error, loading }: OtpSlotsProps) {
  const [focused, setFocused] = useState(0);

  return (
    <div
      className={cn("flex justify-between gap-2.5 mb-6", error && "otp-slots-error")}
      dir="ltr"
      role="group"
      aria-label="کد تایید"
      aria-busy={loading || undefined}
    >
      {digits.map((digit, index) => {
        const filled = Boolean(digit) && !loading;
        const active = focused === index && !filled && !loading;
        return (
          <label
            key={index}
            className="relative block h-[70px] min-w-0 flex-1 cursor-text"
            onPointerDown={() => {
              if (!loading) refs.current[index]?.focus();
            }}
          >
            <input
              ref={(el) => { refs.current[index] = el; }}
              value={digit}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={digits.length}
              autoComplete={index === 0 ? "one-time-code" : "off"}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label={`رقم ${index + 1}`}
              disabled={loading}
              onChange={(event) => onDigit(index, event.target.value)}
              onFocus={() => setFocused(index)}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && !digits[index] && index > 0) {
                  event.preventDefault();
                  onBackspace(index);
                }
              }}
              className="absolute inset-0 z-10 size-full cursor-text bg-transparent text-center text-[26px] font-extrabold text-transparent caret-transparent outline-none disabled:cursor-wait"
            />
            {filled ? (
              <span className="otp-digit pointer-events-none absolute inset-0 flex items-center justify-center text-[26px] font-extrabold text-accent">
                {toFaDigits(digit)}
              </span>
            ) : (
              <span
                className="otp-skel pointer-events-none absolute inset-0 rounded-[18px] bg-gray-5"
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
