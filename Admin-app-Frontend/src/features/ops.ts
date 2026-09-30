import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/services/client";
import type { City, DeliverySlotConfig, PlatformSettings } from "@/types";
import { keys, useScopeKey } from "./keys";

export function usePayments() {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.payments(scope),
    queryFn: () => api.getPayments(),
  });
}

export function useWallets() {
  return useQuery({ queryKey: keys.wallets(), queryFn: () => api.getWallets() });
}

export function useAdjustWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ retailerId, amount, note }: { retailerId: string; amount: number; note: string }) =>
      api.adjustWallet(retailerId, amount, note),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      void qc.invalidateQueries({ queryKey: keys.wallets() });
      void qc.invalidateQueries({ queryKey: ["retailers"] });
      void qc.invalidateQueries({ queryKey: keys.audit() });
      toast.success("کیف پول تعدیل شد");
    },
  });
}

export function useSlots(distributorId: string | undefined) {
  return useQuery({
    queryKey: keys.slots(distributorId ?? ""),
    queryFn: () => api.getSlots(distributorId!),
    enabled: Boolean(distributorId),
  });
}

export function useSaveSlots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DeliverySlotConfig) => api.saveSlots(config),
    onSuccess: (_d, config) => {
      void qc.invalidateQueries({ queryKey: keys.slots(config.distributorId) });
      toast.success("بازه‌های تحویل ذخیره شد");
    },
  });
}

export function useCities() {
  return useQuery({ queryKey: keys.cities(), queryFn: () => api.getCities() });
}

export function useSaveCity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (city: City) => api.saveCity(city),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.cities() });
      toast.success("شهر ذخیره شد");
    },
  });
}

export function useDeleteCity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteCity(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.cities() });
      toast.success("شهر حذف شد");
    },
  });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings(),
    queryFn: () => api.getSettings(),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: PlatformSettings) => api.saveSettings(settings),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.settings() });
      toast.success("تنظیمات ذخیره شد");
    },
  });
}
