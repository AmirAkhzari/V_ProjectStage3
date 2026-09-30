import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/services/client";
import type { ApiResult, DeliveryFilters } from "@/services/api";
import type { DriverInput } from "@/types";
import { keys, useScopeKey } from "./keys";

/** Driver verifications arrive from the field at any time; keep the queue fresh while the panel is open. */
const OPS_POLL_MS = 30_000;

function invalidateOps(qc: QueryClient) {
  for (const key of ["orders", "order", "drivers", "driver", "deliveries", "admin-notifications", "dashboard"])
    void qc.invalidateQueries({ queryKey: [key] });
  void qc.invalidateQueries({ queryKey: keys.audit() });
}

function handle<T>(qc: QueryClient, res: ApiResult<T>, success: string) {
  if (!res.ok) {
    toast.error(res.error);
    return;
  }
  invalidateOps(qc);
  toast.success(success);
}

export function useDrivers(opts?: { activeOnly?: boolean; distributorId?: string }) {
  const scope = useScopeKey();
  return useQuery({ queryKey: keys.drivers(scope, opts), queryFn: () => api.getDrivers(opts) });
}

export function useDriver(id: string | undefined) {
  return useQuery({ queryKey: keys.driver(id ?? ""), queryFn: () => api.getDriver(id!), enabled: Boolean(id) });
}

export function useDeliveries(filters?: DeliveryFilters, opts?: { poll?: boolean }) {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.deliveries(scope, filters),
    queryFn: () => api.getDeliveries(filters),
    refetchInterval: opts?.poll ? OPS_POLL_MS : false,
  });
}

export function useAdminNotifications() {
  const scope = useScopeKey();
  return useQuery({
    queryKey: keys.adminNotifications(scope),
    queryFn: () => api.getAdminNotifications(),
    refetchInterval: OPS_POLL_MS,
  });
}

export function useMarkAdminNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api.markAdminNotificationsRead(ids),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-notifications"] }),
  });
}

export function useSaveDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DriverInput) => api.saveDriver(input),
    onSuccess: (res, input) => handle(qc, res, input.id ? "اطلاعات راننده ذخیره شد" : "راننده ساخته شد"),
  });
}

export function useSetDriverActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setDriverActive(id, active),
    onSuccess: (res, { active }) => handle(qc, res, active ? "راننده فعال شد" : "راننده غیرفعال شد"),
  });
}

export function useResetDriverPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => api.resetDriverPassword(id, password),
    onSuccess: (res) => handle(qc, res, "رمز عبور جدید ثبت شد"),
  });
}

export function useAssignDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, driverId }: { orderId: string; driverId: string | null }) =>
      api.assignDriver(orderId, driverId),
    onSuccess: (res, { driverId }) =>
      handle(qc, res, driverId ? "راننده تعیین شد و به او اطلاع داده می‌شود" : "راننده از سفارش برداشته شد"),
  });
}

export function useReorderRoute(driverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderRoute(driverId, ids),
    onSuccess: (res) => handle(qc, res, "ترتیب مسیر به‌روز شد"),
  });
}

export function useDispatchRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (driverId: string) => api.dispatchRoute(driverId),
    onSuccess: (res) => handle(qc, res, res.ok ? `ارسال ${res.data.shipped.toLocaleString("fa-IR")} سفارش ثبت شد` : ""),
  });
}

export function useConfirmDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => api.confirmDelivery(deliveryId),
    onSuccess: (res) => handle(qc, res, "تحویل تایید شد و سفارش «تحویل شده» است"),
  });
}

export function useRejectDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deliveryId, reason }: { deliveryId: string; reason: string }) =>
      api.rejectDelivery(deliveryId, reason),
    onSuccess: (res) => handle(qc, res, "تایید تحویل رد شد و به راننده اطلاع داده می‌شود"),
  });
}

export function useSimulateVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deliveryId: string) =>
      api.devSimulateVerification
        ? api.devSimulateVerification(deliveryId)
        : ({ ok: false, error: "فقط در حالت نمایشی" } as const),
    onSuccess: (res) => handle(qc, res, "ثبت کد معتبر راننده شبیه‌سازی شد"),
  });
}
