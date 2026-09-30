import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/client";
import type { HistoryFilter } from "@/types";

export const keys = {
  me: ["me"] as const,
  today: ["today"] as const,
  task: (id: string) => ["task", id] as const,
  history: (filter: HistoryFilter) => ["history", filter] as const,
  notifications: ["notifications"] as const,
};

/** Assignments and statuses change on the server (admin actions); poll while visible. */
const ROUTE_POLL_MS = 30_000;
const TASK_POLL_MS = 20_000;
const NOTIFICATION_POLL_MS = 45_000;

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api.getMe(), staleTime: 5 * 60_000 });
}

export function useToday() {
  return useQuery({ queryKey: keys.today, queryFn: () => api.getToday(), refetchInterval: ROUTE_POLL_MS });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: keys.task(id ?? ""),
    queryFn: () => api.getTask(id!),
    enabled: Boolean(id),
    refetchInterval: TASK_POLL_MS,
  });
}

export function useHistory(filter: HistoryFilter) {
  return useQuery({ queryKey: keys.history(filter), queryFn: () => api.getHistory(filter) });
}

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.getNotifications(),
    refetchInterval: NOTIFICATION_POLL_MS,
  });
}

export function useUnreadCount() {
  const { data } = useNotifications();
  return data?.filter((n) => !n.readAt).length ?? 0;
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api.markNotificationsRead(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useSubmitDeliveryCode(deliveryId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, idempotencyKey }: { code: string; idempotencyKey: string }) =>
      api.submitDeliveryCode(deliveryId, code, idempotencyKey),
    onSettled: (result) => {
      if (result?.ok) qc.setQueryData(keys.task(deliveryId), result.task);
      else void qc.invalidateQueries({ queryKey: keys.task(deliveryId) });
      void qc.invalidateQueries({ queryKey: keys.today });
      void qc.invalidateQueries({ queryKey: ["history"] });
    },
  });
}
