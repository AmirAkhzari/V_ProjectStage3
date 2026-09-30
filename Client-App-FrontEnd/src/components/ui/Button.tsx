import type { ButtonHTMLAttributes } from "react";
import Spinner from "./Spinner";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
};

export default function Button({ variant = "primary", className = "", disabled, loading, children, ...props }: Props) {
  const styles = {
    primary: "bg-accent text-inverse disabled:bg-fill disabled:text-label-tertiary",
    secondary: "bg-fill text-accent disabled:text-label-tertiary",
    ghost: "bg-transparent text-accent disabled:text-label-tertiary",
    danger: "bg-fill text-error",
  }[variant];
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`w-full h-[50px] min-h-[50px] rounded-[14px] font-semibold text-[17px] flex items-center justify-center gap-2 ${styles} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
