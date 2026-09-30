import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/services/client";
import type { RetailerFilters } from "@/services/api";
import type { Retailer, Staff, SubscriptionAction } from "@/types";
import { keys, useScopeKey } from "./keys";

export function useRetailers(filters?: RetailerFilters) {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.retailers(scope, filters),
    queryFn: () => api.getRetailers(filters),
  });
}

export function useRetailer(id: string | undefined) {
  return useQuery({
    queryKey: keys.retailer(id ?? ""),
    queryFn: () => api.getRetailer(id!),
    enabled: Boolean(id),
  });
}

export function useRetailerAddresses(id: string | undefined) {
  return useQuery({
    queryKey: keys.retailerAddresses(id ?? ""),
    queryFn: () => api.getRetailerAddresses(id!),
    enabled: Boolean(id),
  });
}

export function useSetRetailerStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Retailer["status"] }) => api.setRetailerStatus(id, status),
    onSuccess: (_d, { id, status }) => {
      void qc.invalidateQueries({ queryKey: ["retailers"] });
      void qc.invalidateQueries({ queryKey: keys.retailer(id) });
      toast.success(status === "blocked" ? "فروشگاه مسدود شد" : "فروشگاه فعال شد");
    },
  });
}

export function useSetRetailerPrimaryDistributor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, distributorId }: { id: string; distributorId: string }) =>
      api.setRetailerPrimaryDistributor(id, distributorId),
    onSuccess: (res, { id }) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      void qc.invalidateQueries({ queryKey: ["retailers"] });
      void qc.invalidateQueries({ queryKey: keys.retailer(id) });
      toast.success("شرکت پخش اصلی به‌روز شد");
    },
  });
}

export function useSetRetailerSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, days }: { id: string; action: SubscriptionAction; days?: number }) =>
      api.setRetailerSubscription(id, action, days),
    onSuccess: (res, { id, action }) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      void qc.invalidateQueries({ queryKey: ["retailers"] });
      void qc.invalidateQueries({ queryKey: keys.retailer(id) });
      void qc.invalidateQueries({ queryKey: ["subscriptions"] });
      toast.success(
        action === "revoke" ? "اشتراک پرو لغو شد" : action === "extend" ? "اشتراک پرو تمدید شد" : "اشتراک پرو اعطا شد",
      );
    },
  });
}

export function useStaff() {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.staff(scope),
    queryFn: () => api.getStaff(),
  });
}

export function useSaveStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Staff, "id" | "roleLabel"> & { id?: string }) => api.saveStaff(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("کاربر ذخیره شد");
    },
  });
}

export function useAuditLog() {
  return useQuery({ queryKey: keys.audit(), queryFn: () => api.getAuditLog() });
}
