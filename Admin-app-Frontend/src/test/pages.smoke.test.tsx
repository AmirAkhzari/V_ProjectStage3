import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes/router";
import { api } from "@/services/client";
import { useSessionStore } from "@/store/useSessionStore";
import { SEED_ORDERS, SEED_RETAILERS } from "@/services/seed/orders";
import { SEED_DISTRIBUTORS, SEED_PRODUCTS } from "@/services/seed/catalog";

/** Every admin route, with a representative id where needed. */
const ROUTES = [
  "/",
  "/orders",
  `/orders/${SEED_ORDERS[0].id}`,
  "/products",
  "/products/new",
  `/products/${SEED_PRODUCTS[0].id}`,
  "/stock",
  "/distributors",
  `/distributors/${SEED_DISTRIBUTORS[0].id}`,
  "/retailers",
  `/retailers/${SEED_RETAILERS[0].id}`,
  "/marketing/coupons",
  "/marketing/banners",
  "/marketing/messages",
  "/finance/payments",
  "/finance/wallets",
  "/finance/subscriptions",
  "/delivery/slots",
  "/delivery/cities",
  "/settings/general",
  "/settings/staff",
  "/settings/audit-log",
  "/drivers",
  "/drivers/drv_1",
  "/deliveries",
  "/deliveries?tab=all",
];

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("admin routes render without runtime errors", () => {
  beforeAll(async () => {
    const res = await api.loginDemo("super_admin");
    useSessionStore.getState().setSession(res.data);
    useSessionStore.setState({ hydrated: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  for (const path of ROUTES) {
    it(`renders ${path}`, async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderAt(path);
      // A React Router error boundary would print this heading.
      await waitFor(() => expect(screen.queryByText(/Unexpected Application Error/i)).toBeNull());
      // Lazy pages resolve their data; wait until there's a heading on screen.
      await waitFor(() => expect(document.querySelector("h1")).not.toBeNull(), {
        timeout: 4000,
      });
      const fatal = errorSpy.mock.calls.filter((c) =>
        /Slot failed|Cannot read|is not a function|Minified React error/i.test(String(c[0])),
      );
      expect(fatal).toEqual([]);
    });
  }

  it("renders the 404 page for unknown routes", async () => {
    renderAt("/does-not-exist");
    await waitFor(() => expect(screen.getByText("صفحه پیدا نشد")).toBeInTheDocument());
  });

  it("redirects unauthenticated users to /login", async () => {
    useSessionStore.setState({ session: null });
    renderAt("/orders");
    await waitFor(() => expect(screen.getByText("ورود به پنل مدیریت")).toBeInTheDocument());
  });

  it("hides SuperAdmin-only routes from a DistributorAdmin", async () => {
    const res = await api.loginDemo("distributor_admin");
    useSessionStore.getState().setSession(res.data);
    renderAt("/settings/staff");
    await waitFor(() => expect(screen.getByText("دسترسی غیرمجاز")).toBeInTheDocument());
  });

  it("hides subscription management from a DistributorAdmin", async () => {
    const res = await api.loginDemo("distributor_admin");
    useSessionStore.getState().setSession(res.data);
    renderAt("/finance/subscriptions");
    await waitFor(() => expect(screen.getByText("دسترسی غیرمجاز")).toBeInTheDocument());
  });
});
