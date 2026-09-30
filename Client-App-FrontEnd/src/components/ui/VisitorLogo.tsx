export default function VisitorLogo({ size = "lg" }: { size?: "sm" | "lg" }) {
  return (
    <div className={`inline-flex items-center ${size === "lg" ? "gap-2.5" : "gap-1.5"}`}>
      <span className={`rounded-full bg-accent ${size === "lg" ? "w-2.5 h-2.5" : "w-1.5 h-1.5"}`} />
      <span className={`font-black tracking-tight ${size === "lg" ? "text-[34px]" : "text-xl"}`}>ویزیتور</span>
    </div>
  );
}
