import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routes } from "@/routes";
import { mockApi, resetMockDb } from "@/services/mockApi";
import { DEMO_PASSWORD } from "@/services/seed";
import { useSessionStore } from "@/store/useSessionStore";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("driver screens", () => {
  beforeAll(async () => {
    localStorage.clear();
    resetMockDb();
    const res = await mockApi.login("ali.rezaei", DEMO_PASSWORD);
    if (!res.ok) throw new Error("login failed");
    useSessionStore.setState({ session: res.data, hydrated: true });
  });

  afterEach(cleanup);

  it("home answers what to deliver today", async () => {
    renderAt("/");
    expect(await screen.findByText("توزیع امروز")).toBeInTheDocument();
    expect(await screen.findAllByText("فروشگاه نوین")).not.toHaveLength(0);
    expect(screen.getByText("باز کردن تحویل")).toBeInTheDocument();
  });

  for (const path of ["/route", "/history", "/profile", "/notifications", "/tasks/dl_3", "/tasks/dl_8", "/nope"]) {
    it(`renders ${path}`, async () => {
      renderAt(path);
      await waitFor(() => expect(document.querySelector(".animate-pulse")).toBeNull());
      expect(screen.queryByText(/Unexpected Application Error/i)).toBeNull();
      expect(document.body.textContent?.trim().length).toBeGreaterThan(10);
    });
  }

  it("shows the waiting state for a verified delivery", async () => {
    renderAt("/tasks/dl_3");
    expect(await screen.findByText("در انتظار تایید مدیر", { selector: "div" })).toBeInTheDocument();
    expect(screen.queryByText("ثبت کد تحویل")).toBeNull();
  });

  it("rejects a wrong code without revealing the right one, then accepts the right one", async () => {
    const user = userEvent.setup();
    renderAt("/tasks/dl_5/code");
    const first = await screen.findByLabelText("رقم 1");
    await user.click(first);
    await user.paste("123456");
    await user.click(screen.getByRole("button", { name: "ثبت کد تحویل" }));
    expect(await screen.findByText("کد تحویل صحیح نیست.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("915372");

    await user.click(screen.getByLabelText("رقم 1"));
    await user.paste("915372");
    await user.click(screen.getByRole("button", { name: "ثبت کد تحویل" }));
    expect(await screen.findByText("کد تحویل صحیح است.")).toBeInTheDocument();
    expect(screen.getByText("تحویل برای تأیید مدیر ثبت شد.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("تحویل شد!");
  });
});
