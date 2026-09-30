import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/services/client";
import type { Distributor, Product, StockEntry } from "@/types";
import { keys, useScopeKey } from "./keys";

export function useProducts() {
  return useQuery({
    queryKey: keys.products(),
    queryFn: () => api.getProducts(),
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: keys.product(id ?? ""),
    queryFn: () => api.getProduct(id!),
    enabled: Boolean(id),
  });
}

export function useSaveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Product, "id" | "createdAt"> & { id?: string }) => api.saveProduct(input),
    onSuccess: (product) => {
      void qc.invalidateQueries({ queryKey: keys.products() });
      void qc.invalidateQueries({ queryKey: ["stock"] });
      qc.setQueryData(keys.product(product.id), product);
      toast.success("محصول ذخیره شد");
    },
  });
}

export function useSetProductActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setProductActive(id, active),
    onMutate: async ({ id, active }) => {
      await qc.cancelQueries({ queryKey: keys.products() });
      const prev = qc.getQueryData<Product[]>(keys.products());
      qc.setQueryData<Product[]>(keys.products(), (old) => old?.map((p) => (p.id === id ? { ...p, active } : p)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.products(), ctx.prev);
      toast.error("خطا در به‌روزرسانی");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.products() }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProduct(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.products() });
      void qc.invalidateQueries({ queryKey: ["stock"] });
      toast.success("محصول حذف شد");
    },
  });
}

export function useStock() {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.stock(scope),
    queryFn: () => api.getStock(),
  });
}

export function useUpdateStock() {
  const qc = useQueryClient();
  const scope = useScopeKey();
  return useMutation({
    mutationFn: (entries: Array<Pick<StockEntry, "distributorId" | "productId"> & Partial<StockEntry>>) =>
      api.updateStock(entries),
    onMutate: async (entries) => {
      await qc.cancelQueries({ queryKey: keys.stock(scope) });
      const prev = qc.getQueryData<StockEntry[]>(keys.stock(scope));
      qc.setQueryData<StockEntry[]>(keys.stock(scope), (old) =>
        old?.map((s) => {
          const patch = entries.find((e) => e.distributorId === s.distributorId && e.productId === s.productId);
          return patch ? { ...s, ...patch } : s;
        }),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.stock(scope), ctx.prev);
      toast.error("خطا در ذخیره موجودی");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useSetPriceMultiplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ distributorId, multiplier }: { distributorId: string; multiplier: number }) =>
      api.setPriceMultiplier(distributorId, multiplier),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["distributors"] });
      toast.success("ضریب قیمت ذخیره شد");
    },
  });
}

export function useDistributors() {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.distributors(scope),
    queryFn: () => api.getDistributors(),
  });
}

/** Unscoped list for switchers/filters (SuperAdmin). */
export function useAllDistributors() {
  return useQuery({
    queryKey: ["distributors", "__all"],
    queryFn: () => api.getDistributors({ all: true }),
  });
}

export function useDistributor(id: string | undefined) {
  return useQuery({
    queryKey: keys.distributor(id ?? ""),
    queryFn: () => api.getDistributor(id!),
    enabled: Boolean(id),
  });
}

export function useSaveDistributor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Distributor, "id" | "createdAt"> & { id?: string }) => api.saveDistributor(input),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["distributors"] });
      void qc.invalidateQueries({ queryKey: ["stock"] });
      qc.setQueryData(keys.distributor(d.id), d);
      toast.success("شرکت پخش ذخیره شد");
    },
  });
}
