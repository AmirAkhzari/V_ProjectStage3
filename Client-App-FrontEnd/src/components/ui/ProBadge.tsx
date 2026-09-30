export default function ProBadge({ detail = false }: { detail?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <span className="text-[10px] font-semibold bg-fill px-1.5 py-0.5 rounded-md">Pro</span>
      {detail ? (
        <span className="text-[11px] text-text-secondary">ارسال سریع‌تر و اولویت ظرفیت</span>
      ) : null}
    </span>
  );
}
