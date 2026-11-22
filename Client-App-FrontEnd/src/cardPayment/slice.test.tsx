import { act, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { build, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { ApiClientError } from "@/lib/apiError";
import { useAppStore } from "@/store/useAppStore";
import {
  CONTRACT_ERROR_CODES,
  PAYMENT_STATUS_LABELS,
  asFullAccount,
  asMaskedAccount,
  clearCardPaymentState as clearPayments,
  describeStatus,
  handleCardPaymentError,
  messageForCode,
  normalizeTracking,
  noteCardPaymentAuthed,
  provisionalCodes,
  readPayment,
  rememberPayment,
  resetCardPaymentReauthForTests,
  resetStatusLogForTests,
  submitBlocked,
  tehranHourMinute,
  trackingHint,
  trackingToSend,
  type CardPaymentApi,
  type FullAccountNumber,
  type MaskedAccountNumber,
} from "./model";
import { cardPaymentMock, testPayment } from "./mock/cardPaymentMock";
import { SLICE_F_MOCK_MARKER, TEST_BANK, TEST_HOLDER, TEST_IBAN, TEST_PAN, TEST_PAN_MASKED } from "./mock/fixtures";
import { assertProductionMockOff } from "./mockGate";
import { CardPaymentScreen, MaskedDestination, PayerDestination, RejectLine, StatusBadge, TickingLabel } from "./ui";

function payerOnly(_account: FullAccountNumber) {
  return _account;
}
function maskedOnly(_account: MaskedAccountNumber) {
  return _account;
}

function luhnValid(num: string) {
  let sum = 0;
  num.split("").reverse().forEach((ch, index) => { let digit = Number(ch) * (index % 2 ? 2 : 1); sum += digit > 9 ? digit - 9 : digit; });
  return sum % 10 === 0;
}

function ibanValid(iban: string) {
  const expanded = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));
  let rest = 0;
  for (const char of expanded) rest = (rest * 10 + Number(char)) % 97;
  return rest === 1;
}

describe("card payment fixtures", () => {
  it("uses fictional format-valid numbers labeled as test data", () => {
    const source = fs.readFileSync(path.resolve("src/cardPayment/mock/fixtures.ts"), "utf8");
    expect(source).toContain("TEST DATA ONLY");
    expect(source).not.toMatch(/09\d{9}/);
    expect(luhnValid(TEST_PAN)).toBe(true);
    expect(TEST_PAN.startsWith("0000")).toBe(true);
    expect(ibanValid(TEST_IBAN)).toBe(true);
    expect(TEST_IBAN.slice(4, 7)).toBe("000");
    expect(TEST_HOLDER.startsWith("TEST_")).toBe(true);
    expect(TEST_BANK.startsWith("TEST_")).toBe(true);
    expect(normalizeTracking("۱۲-۳۴۵۶")).toBe("123456");
    expect(trackingToSend("۱۲-۳۴۵۶")).toBe("123456");
    expect(trackingHint("12345")).toMatch(/۶ تا ۲۰/);
    expect(tehranHourMinute("2026-11-22T12:00:00.000Z")).toBe("15:30");
  });
});

describe("payment status", () => {
  beforeEach(() => resetStatusLogForTests());

  it("maps the five contract statuses and keeps an unknown value neutral", () => {
    expect(Object.keys(PAYMENT_STATUS_LABELS)).toEqual(["pending", "pending_verification", "success", "failed", "expired"]);
    expect(PAYMENT_STATUS_LABELS).toEqual({
      pending: "در انتظار پرداخت",
      pending_verification: "در حال بررسی",
      success: "تأیید شده",
      failed: "ناموفق",
      expired: "منقضی شده",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => describeStatus("nope", "payer")).not.toThrow();
    expect(describeStatus("nope", "payer")).toMatchObject({ known: false, label: "نامشخص", icon: "question" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("card-payment-status", { screen: "payer", status: "nope" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TEST_PAN);
    warn.mockRestore();
    render(<><StatusBadge status="not-a-status" screen="payer" /><StatusBadge status="failed" screen="payer" /><RejectLine reason={"\u202Emismatch"} /></>);
    expect(screen.getByText("نامشخص")).toBeInTheDocument();
    expect(screen.getByText("ناموفق")).toBeInTheDocument();
    expect(screen.getByText(/رد شد/)).toHaveTextContent("رد شد mismatch");
    expect(document.body.textContent).not.toContain("\u202E");
    const icons = screen.getAllByRole("status").map((node) => node.getAttribute("data-icon"));
    expect(icons).toContain("question");
    expect(icons).toContain("cross");
    expect(icons).not.toContain("check");
  });
});

describe("account display", () => {
  it("renders the server string and copies it only in the payer view", async () => {
    // @ts-expect-error payer view accepts only the full account type
    payerOnly(asMaskedAccount(TEST_PAN_MASKED));
    // @ts-expect-error masked view accepts only the masked account type
    maskedOnly(asFullAccount(TEST_PAN));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(
      <>
        <PayerDestination account={asFullAccount(TEST_IBAN)} holderName={"TEST_\u202Ename"} bankName={TEST_BANK} />
        <StatusBadge status="success" screen="history" />
        <MaskedDestination account={asMaskedAccount("SERVER-SENT")} holderName={TEST_HOLDER} bankName={TEST_BANK} />
        <MaskedDestination account={asMaskedAccount(TEST_PAN_MASKED)} holderName={TEST_HOLDER} bankName={TEST_BANK} />
      </>,
    );
    expect(container).toHaveTextContent(TEST_IBAN);
    expect(container).toHaveTextContent("SERVER-SENT");
    expect(container).toHaveTextContent(TEST_PAN_MASKED);
    expect(container).not.toHaveTextContent(TEST_PAN);
    expect(container.textContent).not.toContain("\u202E");
    expect(container).toHaveTextContent("TEST_name");
    expect(screen.getAllByRole("button", { name: "کپی" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "کپی" }));
    expect(await screen.findByText("کپی شد")).toBeInTheDocument();
    expect(screen.getByText("کپی شد").textContent).toBe("کپی شد");
    expect(writeText).toHaveBeenCalledWith(TEST_IBAN);
  });
});

describe("card payment errors", () => {
  const redirect = vi.fn();
  const logout = vi.fn(async () => undefined);
  const now = Date.parse("2026-11-22T12:00:00.000Z");

  beforeEach(() => {
    redirect.mockClear();
    logout.mockClear();
    resetCardPaymentReauthForTests();
    clearPayments();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("redirects once on 401 and never shows the raw server text", async () => {
    rememberPayment(testPayment());
    const err = new ApiClientError(`leak ${TEST_PAN}`, "UNAUTHENTICATED", 401, { message: "leak" });
    const first = await handleCardPaymentError(err, { logout, redirect, now });
    const second = await handleCardPaymentError(err, { logout, redirect, now });
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(logout).toHaveBeenCalledTimes(1);
    expect(first.reauth).toBe(true);
    expect(second.message).not.toContain(TEST_PAN);
    expect(readPayment("TEST_pay")).toBeUndefined();
    noteCardPaymentAuthed();
    await handleCardPaymentError(err, { logout, redirect, now });
    expect(redirect).toHaveBeenCalledTimes(2);
    const other = await handleCardPaymentError(new ApiClientError("raw", "SESSION_REVOKED", 401), { logout, redirect, now });
    expect(other.reauth).toBe(false);
    expect(other.message).toBe(messageForCode("SESSION_REVOKED"));
    expect(other.message).not.toContain("raw");
  });

  it("honours Retry-After seconds and HTTP dates without auto retry", async () => {
    const seconds = await handleCardPaymentError(new ApiClientError("raw-seconds", "RATE_LIMITED", 429, null, "30"), { logout, redirect, now });
    const httpDate = new Date(now + 45_000).toUTCString();
    const dated = await handleCardPaymentError(new ApiClientError("raw-date", "RATE_LIMITED", 429, null, httpDate), { logout, redirect, now });
    expect(seconds.retryAt).toBe(now + 30_000);
    expect(dated.retryAt).toBe(now + 45_000);
    expect(seconds.disableSubmit && dated.disableSubmit).toBe(true);
    expect(seconds.autoRetry || dated.autoRetry).toBe(false);
    expect(seconds.message).not.toContain("raw");
    expect(submitBlocked(seconds, now)).toBe(true);
    expect(submitBlocked(seconds, now + 30_000)).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("shows one generic 503 message for scanner and contract outages", async () => {
    for (const code of ["SCANNER_UNAVAILABLE", "SERVICE_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE", undefined]) {
      const notice = await handleCardPaymentError(new ApiClientError("<b>secret</b>", code, 503, null, "5"), { logout, redirect, now });
      expect(notice.message).toBe("بعداً دوباره تلاش کنید");
      expect(notice.autoRetry).toBe(false);
      expect(notice.message).not.toContain("secret");
    }
    expect(provisionalCodes).toEqual(["SCANNER_UNAVAILABLE"]);
    expect(CONTRACT_ERROR_CODES).not.toContain("SCANNER_UNAVAILABLE");
  });
});

describe("payer flow", () => {
  beforeEach(() => {
    clearPayments();
    localStorage.clear();
    sessionStorage.clear();
    resetCardPaymentReauthForTests();
  });

  it("refetches after submit, leaves storage empty, and does not edit the destination", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const calls: string[] = [];
    const api: CardPaymentApi = {
      async getPayment(id) {
        calls.push("get");
        return cardPaymentMock.getPayment(id);
      },
      async submitReceipt(id, body, key) {
        calls.push("submit");
        return cardPaymentMock.submitReceipt(id, body, key);
      },
    };
    render(<CardPaymentScreen paymentId="TEST_pay" api={api} onLogout={async () => undefined} onReauth={() => undefined} />);
    expect(await screen.findByText(TEST_PAN)).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const file = new File(["x"], "TEST_receipt.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("رسید"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت رسید" }));
    expect(await screen.findByText("در حال بررسی")).toBeInTheDocument();
    expect(calls).toEqual(["get", "submit", "get"]);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    setItem.mockRestore();
  });

  it("disables submit while a 429 countdown is running", async () => {
    const submit = vi.fn(async () => {
      throw new ApiClientError("RAW", "RATE_LIMITED", 429, null, "30");
    });
    const api: CardPaymentApi = { getPayment: async () => testPayment(), submitReceipt: submit };
    render(<CardPaymentScreen paymentId="TEST_pay" api={api} onLogout={async () => undefined} onReauth={() => undefined} />);
    expect(await screen.findByText(TEST_HOLDER)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("رسید"), { target: { files: [new File(["x"], "TEST_receipt.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت رسید" }));
    const button = await screen.findByRole("button", { name: "ثبت رسید" });
    expect(button).toBeDisabled();
    expect(screen.getByRole("alert").textContent).not.toContain("RAW");
    expect(screen.getByTestId("retry-visual").textContent).not.toBe("در انتظار به‌روزرسانی");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("renders the generic 503 text without server HTML", async () => {
    const api: CardPaymentApi = {
      async getPayment() {
        throw new ApiClientError("<script>alert(1)</script>", "SERVICE_UNAVAILABLE", 503);
      },
      async submitReceipt() {
        throw new Error("no");
      },
    };
    const { container } = render(<CardPaymentScreen paymentId="TEST_pay" api={api} onLogout={async () => undefined} onReauth={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("بعداً دوباره تلاش کنید");
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("alert(1)");
  });
});

function Clock({ extra, onElapsed }: { extra: number; onElapsed: () => void }) {
  const [status] = useState("pending");
  return <div><output data-testid="status">{status}</output><TickingLabel targetMs={Date.now() + extra} onZero={onElapsed} liveId="deadline-live" visualId="deadline-visual" /></div>;
}

describe("countdown", () => {
  afterEach(() => vi.useRealTimers());

  it("throttles the live region and refetches at zero without changing status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00.000Z"));
    const onElapsed = vi.fn();
    const view = render(<Clock extra={120_000} onElapsed={onElapsed} />);
    expect(screen.getByTestId("deadline-live").textContent).toBe(screen.getByTestId("deadline-visual").textContent);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const live = screen.getByTestId("deadline-live").textContent;
    expect(screen.getByTestId("deadline-visual").textContent).not.toBe(live);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByTestId("deadline-live").textContent).not.toBe(live);
    expect(onElapsed).not.toHaveBeenCalled();
    view.unmount();
    render(<Clock extra={5_000} onElapsed={onElapsed} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("deadline-live")).toHaveTextContent("در انتظار به‌روزرسانی");
    expect(screen.getByTestId("status")).toHaveTextContent("pending");
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });
});

describe("logout and production bundle", () => {
  it("drops the memory cache on logout and keeps accounts out of web storage", async () => {
    localStorage.clear();
    rememberPayment(testPayment());
    await useAppStore.getState().logout();
    expect(readPayment("TEST_pay")).toBeUndefined();
    const stored = `${dump(localStorage)}\n${dump(sessionStorage)}`;
    expect(stored).not.toContain(TEST_PAN);
    expect(stored).not.toContain(TEST_IBAN);
    expect(stored).not.toContain(SLICE_F_MOCK_MARKER);
  });

  it("omits the mock from a production bundle and rejects the prod flag", async () => {
    expect(() => assertProductionMockOff("production", "1")).toThrow(/production/);
    expect(() => assertProductionMockOff("production", undefined)).not.toThrow();
    delete process.env.VITE_CARD_PAYMENTS_MOCK;
    const clean = await bundle();
    expect(clean).not.toContain(SLICE_F_MOCK_MARKER);
    expect(clean).not.toContain(TEST_PAN);
    expect(clean).not.toContain(TEST_IBAN);
    process.env.VITE_CARD_PAYMENTS_MOCK = "1";
    await expect(bundle()).rejects.toThrow(/production/);
    delete process.env.VITE_CARD_PAYMENTS_MOCK;
  }, 60_000);
});

function dump(store: Storage) {
  return Array.from({ length: store.length }, (_, index) => {
    const key = store.key(index) ?? "";
    return `${key}=${store.getItem(key)}`;
  }).join("\n");
}

function mockGate(): Plugin {
  return { name: "card-payment-mock-gate", configResolved(config) { assertProductionMockOff(config.mode, config.env.VITE_CARD_PAYMENTS_MOCK ?? process.env.VITE_CARD_PAYMENTS_MOCK); } };
}

async function bundle() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "card-pay-"));
  await build({ configFile: false, mode: "production", logLevel: "error", root: path.resolve("."), plugins: [react(), mockGate()], resolve: { alias: { "@": path.resolve("src") } }, build: { outDir, emptyOutDir: true, minify: false, sourcemap: false, rollupOptions: { input: path.resolve("src/cardPayment/bundleProbe.ts") } } });
  const read = (dir: string): string => fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? read(full) : /\.(js|css|html)$/.test(entry.name) ? fs.readFileSync(full, "utf8") : "";
  }).join("\n");
  return read(outDir);
}
