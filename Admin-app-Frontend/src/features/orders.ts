import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/services/client";
import type { OrderFilters } from "@/services/api";
import type { OrderStatus } from "@/types";
import { keys, useScopeKey } from "./keys";

export function useDashboard() {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.dashboard(scope),
    queryFn: () => api.getDashboard(),
  });
}

export function useOrders(filters?: OrderFilters) {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.orders(scope, filters),
    queryFn: () => api.getOrders(filters),
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: keys.order(id ?? ""),
    queryFn: () => api.getOrder(id!),
    enabled: Boolean(id),
  });
}

export function useUpdateOrderStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ status, note }: { status: OrderStatus; note?: string }) => api.updateOrderStatus(id, status, note),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      qc.setQueryData(keys.order(id), res.data);
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: keys.audit() });
      toast.success("وضعیت سفارش به‌روزرسانی شد");
    },
  });
}
