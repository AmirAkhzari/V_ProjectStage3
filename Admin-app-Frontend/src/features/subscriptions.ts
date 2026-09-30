import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/client";
import type { SubscriptionFilters } from "@/services/api";
import { keys } from "./keys";

export function useSubscriptions(filters?: SubscriptionFilters) {
  return useQuery({
    queryKey: keys.subscriptions(filters),
    queryFn: () => api.getSubscriptions(filters),
  });
}
