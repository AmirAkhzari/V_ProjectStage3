import { ContainerTextFlip, VISITOR_TAGLINE_WORDS } from "@/components/ui/container-text-flip";

function IosActivityIndicator({ size = 22 }: { size?: number }) {
  return (
    <div
      className="ios-activity relative shrink-0 text-text-primary"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {Array.from({ length: 12 }, (_, index) => (
        <span
          key={index}
          className="absolute left-1/2 top-0 h-[23.6%] w-[9.5%] origin-[center_212%] rounded-full bg-current"
          style={{
            transform: `rotate(${index * 30}deg)`,
            opacity: 0.9 - index * 0.068,
          }}
        />
      ))}
    </div>
  );
}

export default function BrandedWaitScreen({ overlay = false }: { overlay?: boolean }) {
  const stage = (
    <div
      className="relative flex h-full min-h-0 w-full flex-col items-center justify-center overflow-hidden bg-page branded-wait-in"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="در حال بارگذاری"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-[18%] size-[300px] rounded-full bg-[var(--ios-gray-3)] opacity-70 blur-[80px]" />
        <div className="absolute left-[51%] top-[62%] size-[260px] rounded-full bg-[var(--ios-gray-2)] opacity-55 blur-[80px]" />
        <div className="absolute left-[24%] top-[33%] size-[200px] rounded-full bg-[var(--ios-white)] opacity-80 blur-[70px] dark:opacity-20" />
      </div>
      <div className="relative z-10 flex flex-col items-center justify-center gap-2.5 px-6">
        <div className="text-center text-[40px] font-black leading-none text-text-primary">ویزیتور</div>
        <div className="flex items-baseline justify-center gap-1.5">
          <span className="text-[22px] font-semibold text-text-secondary">سفارش عمده</span>
          <ContainerTextFlip
            className="text-[22px] font-semibold"
            words={[...VISITOR_TAGLINE_WORDS]}
          />
        </div>
        <div className="h-[18px] w-px" />
        <IosActivityIndicator />
      </div>
    </div>
  );

  if (!overlay) {
    return <div className="flex min-h-0 flex-1">{stage}</div>;
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-page">
      <div className="h-full w-full max-w-lg">{stage}</div>
    </div>
  );
}
