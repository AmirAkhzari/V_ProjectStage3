import type { CartItem, Product } from "@/types";
import { toFaNum } from "@/lib/format";
import ProductImage from "@/components/ui/ProductImage";
import QtyControl from "@/components/ui/QtyControl";
import Price from "@/components/ui/Price";

export default function ProductCard({
  product,
  count,
  onAdd,
  onSub,
  onOpen,
}: {
  product: Product;
  count: number;
  onAdd: () => void;
  onSub: () => void;
  onOpen?: () => void;
}) {
  return (
    <div className="h-full bg-card rounded-[10px] overflow-hidden flex flex-col">
      <button type="button" onClick={onOpen} className="w-full text-right flex-1 flex flex-col min-h-0">
        <div className="relative h-[124px] shrink-0 bg-fill">
          {product.disc ? (
            <span className="absolute top-2 right-2 z-10 bg-deal-red text-inverse text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
              {toFaNum(product.disc)}٪
            </span>
          ) : null}
          <ProductImage src={product.img} alt={product.name} className="w-full h-full" />
        </div>
        <div className="p-2.5 flex-1 flex flex-col">
          <div className="text-[11px] text-text-secondary">{product.brand}</div>
          <div className="text-[13px] font-semibold line-clamp-2 min-h-8 leading-5 mt-0.5">{product.name}</div>
          <div className="text-[11px] text-text-secondary mt-0.5">× {toFaNum(product.unitsPerCarton)} عدد / کارتن</div>
          <div className="mt-auto pt-2">
            <Price value={product.price} original={product.original} size="sm" />
          </div>
        </div>
      </button>
      <div className="px-2.5 pb-2.5">
        <QtyControl count={count} onAdd={onAdd} onSub={onSub} compact />
      </div>
    </div>
  );
}

export function toCartItem(product: Product, qty = 1): CartItem {
  return { id: product.id, name: product.name, price: product.price, img: product.img, unitsPerCarton: product.unitsPerCarton, qty };
}
