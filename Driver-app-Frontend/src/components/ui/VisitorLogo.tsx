export default function VisitorLogo({ size = "lg", suffix }: { size?: "sm" | "lg"; suffix?: string }) {
  const lg = size === "lg";
  return (
    <div className={`inline-flex items-center ${lg ? "gap-2.5" : "gap-1.5"}`}>
      <span className={`rounded-full bg-accent ${lg ? "size-2.5" : "size-1.5"}`} />
      <span className={`font-black tracking-tight ${lg ? "text-[34px]" : "text-xl"}`}>ویزیتور</span>
      {suffix ? (
        <span className={`font-semibold text-label-secondary ${lg ? "text-[20px]" : "text-[14px]"}`}>{suffix}</span>
      ) : null}
    </div>
  );
}
