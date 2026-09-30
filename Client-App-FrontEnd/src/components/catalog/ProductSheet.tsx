import { useState } from "react";
import type { Product } from "@/types";
import { MIN_ORDER } from "@/types";
import { toFaNum } from "@/lib/format";
import ProductImage from "@/components/ui/ProductImage";
import Price from "@/components/ui/Price";
import { IconHeart, IconX } from "@/components/icons";

export default function ProductSheet({
  product,
  onClose,
  onAdd,
  cartTotal,
  isOos,
  disabled,
  seller,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (qty: number) => void;
  cartTotal: number;
  isOos?: boolean;
  disabled?: boolean;
  seller?: string;
}) {
  const [qty, setQty] = useState(product.minOrderQty);
  const remaining = Math.max(0, MIN_ORDER - cartTotal);
  const blocked = Boolean(isOos || disabled);

  return (
    <div className="absolute inset-0 z-50 bg-ink/55 flex flex-col justify-end" onClick={onClose}>
      <div className="bg-card rounded-t-[22px] max-h-[92%] overflow-y-auto sheet-up" dir="rtl" onClick={(event) => event.stopPropagation()}>
        <div className="relative bg-fill">
          <div className="w-10 h-1 rounded-full bg-separator mx-auto absolute top-3 inset-x-0 z-10" />
          <ProductImage src={product.img} alt={product.name} className="w-full h-64 p-6" />
          <button type="button" onClick={onClose} className="absolute top-3.5 left-3.5 size-11 rounded-full bg-card flex items-center justify-center shadow-floating" aria-label="بستن">
            <IconX />
          </button>
          <button type="button" className="absolute top-3.5 right-3.5 size-11 rounded-full bg-card flex items-center justify-center shadow-floating" aria-label="علاقه‌مندی">
            <IconHeart filled={false} />
          </button>
        </div>
        <div className="p-5">
          <h2 className="text-lg font-semibold mb-1">{product.name}</h2>
          <div className="text-[13px] text-text-secondary mb-1">
            {product.brand} · {product.category} · {product.size}
          </div>
          {seller ? <div className="text-[12px] text-accent mb-4">{seller}</div> : <div className="mb-3" />}
          <p className="text-[13px] text-text-secondary leading-7 mb-4">
            {product.subCategory} از برند {product.brand}، بسته‌بندی {product.size}. هر کارتن شامل {toFaNum(product.unitsPerCarton)} عدد است.
            {product.lastOrder ? ` آخرین سفارش شما ${toFaNum(product.lastOrder.cartons)} کارتن، ${toFaNum(product.lastOrder.daysAgo)} روز پیش.` : ""}
          </p>
          <div className="bg-fill text-accent rounded-[14px] px-4 py-3 flex justify-between mb-4">
            <span className="text-text-secondary text-xs">هر کارتن</span>
            <span className="text-xl font-semibold">{toFaNum(product.unitsPerCarton)} عدد</span>
          </div>
          <div className="text-[11px] text-text-secondary mb-3">SKU: {product.sku}</div>
          <div className="bg-fill rounded-[14px] p-4 mb-4">
            <div className="text-xs text-text-secondary">قیمت هر کارتن</div>
            <Price value={product.price} original={product.original} size="lg" />
          </div>
          {remaining > 0 && (
            <p className="text-[12px] text-text-secondary bg-fill rounded-[12px] p-3 mb-4">
              {toFaNum(remaining)} تومان تا حداقل سفارش باقی مانده
            </p>
          )}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQty((value) => value + 1)} className="size-11 rounded-[12px] bg-accent text-inverse font-semibold" aria-label="افزایش کارتن">+</button>
              <span className="font-semibold w-8 text-center">{toFaNum(qty)}</span>
              <button type="button" onClick={() => setQty((value) => Math.max(product.minOrderQty, value - 1))} className="size-11 rounded-[12px] bg-fill font-semibold" aria-label="کاهش کارتن">−</button>
            </div>
            <span className="text-sm text-text-secondary">تعداد کارتن</span>
          </div>
          <button
            type="button"
            disabled={blocked}
            onClick={() => onAdd(qty)}
            className="w-full min-h-[52px] rounded-[14px] bg-accent text-inverse font-semibold disabled:bg-fill disabled:text-label-tertiary"
          >
            {isOos ? "ناموجود نزد این شرکت پخش" : `افزودن ${toFaNum(qty)} کارتن`}
          </button>
        </div>
      </div>
    </div>
  );
}
