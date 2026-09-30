import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import Spinner from "./Spinner";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "lg" | "md";
  loading?: boolean;
};

const VARIANTS = {
  primary: "bg-accent text-inverse disabled:bg-fill disabled:text-label-tertiary",
  secondary: "bg-fill text-accent disabled:text-label-tertiary",
  ghost: "bg-transparent text-accent disabled:text-label-tertiary",
  danger: "bg-fill text-error disabled:text-label-tertiary",
};

const SIZES = {
  lg: "h-[54px] min-h-[54px] rounded-[14px] text-[17px]",
  md: "h-11 min-h-11 rounded-xl text-[15px]",
};

export default function Button({
  variant = "primary",
  size = "lg",
  className,
  disabled,
  loading,
  children,
  type = "button",
  ...props
}: Props) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "flex w-full items-center justify-center gap-2 px-4 font-semibold [&_svg]:size-5 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
