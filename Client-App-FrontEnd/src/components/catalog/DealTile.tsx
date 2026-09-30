import ProductImage from "@/components/ui/ProductImage";
import { IconChevronLeft, IconPlus } from "@/components/icons";
import { toFaNum } from "@/lib/format";
import type { Product } from "@/types";

export default function DealTile({
  product,
  count,
  onAdd,
  onOpen,
  disabled = false,
  seller,
  browse = false,
}: {
  product: Product;
  count: number;
  onAdd: () => void;
  onOpen?: () => void;
  disabled?: boolean;
  seller?: string;
  browse?: boolean;
}) {
  return (
    <div className="text-center">
      <div className="relative bg-card rounded-[14px] aspect-square mb-2">
        {product.disc ? (
          <span className="absolute top-1.5 right-1.5 z-10 bg-deal-red text-inverse text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
            {toFaNum(product.disc)}٪
          </span>
        ) : null}
        <button type="button" onClick={onOpen} className="w-full h-full text-right" aria-label={`مشاهده ${product.name}`}>
          <ProductImage src={product.img} alt={product.name} className="w-full h-full rounded-[14px] p-2" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onAdd}
          className="absolute bottom-1.5 left-1.5 z-10 min-w-11 h-11 px-2 rounded-full bg-accent text-inverse flex items-center justify-center text-[13px] font-semibold disabled:bg-fill disabled:text-label-tertiary"
          aria-label={browse ? `مشاهده ${product.name} در ${seller ?? "شرکت پخش"}` : `افزودن یک کارتن ${product.name}`}
        >
          {browse ? <IconChevronLeft size={16} /> : count ? toFaNum(count) : <IconPlus size={16} />}
        </button>
      </div>
      <button type="button" onClick={onOpen} className="w-full text-center">
        <div className="text-[11px] leading-4 line-clamp-2 min-h-8 text-text-secondary">{product.name}</div>
        <div className="text-[11px] text-label-tertiary mt-0.5">× {toFaNum(product.unitsPerCarton)} عدد / کارتن</div>
        {seller ? <div className="text-[10px] text-accent mt-0.5 line-clamp-1">{seller}</div> : null}
        <div className="text-[13px] font-semibold mt-1">{toFaNum(product.price)} <span className="text-[10px] font-normal text-text-secondary">تومان</span></div>
        {product.original ? (
          <div className="text-[11px] text-label-tertiary line-through">{toFaNum(product.original)}</div>
        ) : null}
      </button>
    </div>
  );
}
