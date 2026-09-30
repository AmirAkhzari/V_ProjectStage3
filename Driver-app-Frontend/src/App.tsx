import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "@/routes";
import { UnauthorizedError } from "@/services/api";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import { applyTheme } from "@/lib/theme";

function onAuthError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    void useSessionStore.getState().logout(error.reason);
    queryClient.clear();
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      retry: (count, error) => !(error instanceof UnauthorizedError) && count < 2,
    },
    mutations: { retry: false },
  },
});

export default function App() {
  const hydrate = useSessionStore((s) => s.hydrate);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
