import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/services/client";
import type { Banner, Coupon, Message } from "@/types";
import { keys, useScopeKey } from "./keys";

export function useCoupons() {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.coupons(scope),
    queryFn: () => api.getCoupons(),
  });
}

export function useSaveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Coupon, "id" | "usedCount"> & { id?: string }) => api.saveCoupon(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["coupons"] });
      toast.success("کد تخفیف ذخیره شد");
    },
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCoupon(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["coupons"] });
      toast.success("کد تخفیف حذف شد");
    },
  });
}

export function useBanners() {
  return useQuery({ queryKey: keys.banners(), queryFn: () => api.getBanners() });
}

export function useSaveBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Banner, "id" | "order"> & { id?: string }) => api.saveBanner(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.banners() });
      toast.success("بنر ذخیره شد");
    },
  });
}

export function useReorderBanners() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderBanners(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: keys.banners() });
      const prev = qc.getQueryData<Banner[]>(keys.banners());
      qc.setQueryData<Banner[]>(
        keys.banners(),
        (old) =>
          old && [...old].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)).map((b, i) => ({ ...b, order: i })),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.banners(), ctx.prev),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.banners() }),
  });
}

export function useDeleteBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteBanner(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.banners() });
      toast.success("بنر حذف شد");
    },
  });
}

export function useMessages() {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.messages(scope),
    queryFn: () => api.getMessages(),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Message, "id" | "sentAt" | "recipients">) => api.sendMessage(input),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: ["messages"] });
      toast.success(`پیام برای ${m.recipients.toLocaleString("fa-IR")} گیرنده ارسال شد`);
    },
  });
}
