import type { InputHTMLAttributes } from "react";

export default function TextField({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-[50px] rounded-[12px] border-0 bg-fill px-4 text-[17px] outline-none placeholder:text-label-tertiary focus:bg-fill-secondary ${className}`}
    />
  );
}
