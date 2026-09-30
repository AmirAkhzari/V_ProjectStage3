import { ExternalLink } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import Button from "@/components/ui/Button";
import { mapTargets } from "@/lib/maps";
import type { ShopInfo } from "@/types";

export default function NavigateSheet({ shop, open, onClose }: { shop: ShopInfo; open: boolean; onClose: () => void }) {
  const targets = mapTargets(shop);
  return (
    <BottomSheet open={open} onClose={onClose} title="مسیریابی تا فروشگاه">
      <p className="mb-3 text-center text-[13px] leading-6 text-label-secondary">
        {shop.name} — {shop.address}
      </p>
      <div className="flex flex-col gap-2">
        {targets.map((t) => (
          <a
            key={t.id}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
            className="flex h-[54px] items-center justify-between rounded-[14px] bg-fill px-4 text-[16px] font-semibold"
          >
            {t.label}
            <ExternalLink className="size-5 text-label-secondary" aria-hidden />
          </a>
        ))}
        <Button variant="ghost" onClick={onClose}>
          انصراف
        </Button>
      </div>
    </BottomSheet>
  );
}
