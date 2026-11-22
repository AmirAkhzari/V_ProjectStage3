import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiClientError } from "@/lib/apiError";
import { formatToman, toFaDigits } from "@/lib/format";
import {
  describeStatus,
  formatRemain,
  formatTehran,
  handleCardPaymentError,
  noteCardPaymentAuthed,
  plainText,
  receiptPrecheck,
  rememberPayment,
  submitBlocked,
  trackingHint,
  trackingToSend,
  type CardPaymentApi,
  type CardPaymentNotice,
  type FullAccountNumber,
  type MaskedAccountNumber,
  type StatusIcon,
} from "./model";

const GLYPH: Record<StatusIcon, string> = { clock: "⏳", search: "◌", check: "✓", cross: "✕", calendar: "▣", question: "?" };
const ink = { background: "#F2F1EE", color: "#121214" };

export function StatusBadge({ status, screen }: { status: string; screen: string }) {
  const view = describeStatus(status, screen);
  return (
    <span role="status" data-icon={view.icon} className="inline-flex items-center gap-2 min-h-11 px-3 rounded-full" style={{ ...ink, border: "1px solid #121214" }}>
      <span aria-hidden="true">{GLYPH[view.icon]}</span>
      <span>{view.label}</span>
    </span>
  );
}

export function RejectLine({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return <p>رد شد <bdi>{plainText(reason)}</bdi></p>;
}

function displayableAccount(value: string) {
  return /^\d{16}$/.test(value) || /^IR\d{24}$/.test(value);
}

export function PayerDestination({ account, holderName, bankName }: { account: FullAccountNumber; holderName: string; bankName: string }) {
  const shown = displayableAccount(account) ? account : "";
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p><bdi>{plainText(holderName)}</bdi> <bdi>{plainText(bankName)}</bdi></p>
      {shown ? <bdi dir="ltr">{shown}</bdi> : null}
      {shown ? <button type="button" className="min-h-11 min-w-11 px-3" style={ink} onClick={() => void copyExact(shown, setCopied)}>کپی</button> : null}
      {copied ? <p role="status">کپی شد</p> : null}
    </div>
  );
}

export function MaskedDestination({ account, holderName, bankName }: { account: MaskedAccountNumber; holderName: string; bankName: string }) {
  return (
    <div>
      <p><bdi>{plainText(holderName)}</bdi> <bdi>{plainText(bankName)}</bdi></p>
      <bdi dir="ltr">{account}</bdi>
    </div>
  );
}

async function copyExact(account: string, setCopied: (value: boolean) => void) {
  try {
    await navigator.clipboard.writeText(account);
    setCopied(true);
  } catch {
    setCopied(false);
  }
}

export function TickingLabel({ targetMs, onZero, liveId, visualId }: { targetMs: number; onZero?: () => void; liveId: string; visualId: string }) {
  const onZeroRef = useRef(onZero);
  onZeroRef.current = onZero;
  const ended = useRef(false);
  const lastLive = useRef(0);
  const [visual, setVisual] = useState(() => formatRemain(targetMs - Date.now()));
  const [live, setLive] = useState(visual);
  useEffect(() => {
    const tick = () => {
      const ms = targetMs - Date.now();
      const label = formatRemain(ms);
      setVisual(label);
      if (ms <= 0) {
        setLive("در انتظار به‌روزرسانی");
        if (!ended.current) {
          ended.current = true;
          onZeroRef.current?.();
        }
        return;
      }
      if (Date.now() - lastLive.current >= 60_000) {
        lastLive.current = Date.now();
        setLive(label);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [targetMs]);
  return (
    <div>
      <span aria-live="polite" data-testid={liveId}>{live}</span>
      <span aria-hidden="true" data-testid={visualId}>{visual}</span>
    </div>
  );
}

function ReceiptPreview({ file }: { file: File | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!file) return null;
  if (!url) return <p>{file.name} · {file.size}</p>;
  return <img alt="" src={url} />;
}

export function CardPaymentScreen({
  paymentId,
  api,
  onLogout,
  onReauth,
}: {
  paymentId: string;
  api: CardPaymentApi;
  onLogout: () => Promise<void> | void;
  onReauth: (path: string) => void;
}) {
  const [payment, setPayment] = useState<Awaited<ReturnType<CardPaymentApi["getPayment"]>> | null>(null);
  const [notice, setNotice] = useState<CardPaymentNotice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tracking, setTracking] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const logoutRef = useRef(onLogout);
  const reauthRef = useRef(onReauth);
  logoutRef.current = onLogout;
  reauthRef.current = onReauth;
  const blocked = submitBlocked(notice, now);

  async function fail(err: unknown) {
    if (err instanceof ApiClientError && err.status === 401) setPayment(null);
    setNotice(await handleCardPaymentError(err, { logout: () => logoutRef.current(), redirect: (path) => reauthRef.current(path) }));
  }

  async function reload() {
    try {
      const next = await api.getPayment(paymentId);
      rememberPayment(next);
      noteCardPaymentAuthed();
      setPayment(next);
      return next;
    } catch (err) {
      await fail(err);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void api.getPayment(paymentId).then((next) => {
      if (cancelled) return;
      rememberPayment(next);
      noteCardPaymentAuthed();
      setPayment(next);
    }).catch(async (err) => {
      if (!cancelled) await fail(err);
    });
    return () => {
      cancelled = true;
    };
  }, [api, paymentId]);

  useEffect(() => {
    if (!notice?.retryAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [notice?.retryAt]);

  const alertText = fileError ?? notice?.message ?? "";
  useEffect(() => {
    if (alertText) summaryRef.current?.focus();
  }, [alertText]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked || submitting.current) return;
    const problem = receiptPrecheck(file);
    if (problem || !file) {
      setFileError(problem);
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    const key = idempotencyKey.current;
    submitting.current = true;
    setBusy(true);
    setFileError(null);
    try {
      await api.submitReceipt(paymentId, {
        tracking: trackingToSend(tracking),
        receipt: { name: file.name, mime: file.type, size: file.size, body: file },
      }, key);
      idempotencyKey.current = null;
      await reload();
      setNotice(null);
    } catch (err) {
      await fail(err);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="p-4" style={ink}>
      <header className="min-h-11 px-3 py-2 rounded-xl mb-3" style={{ background: "#FF8A1C", color: "#121214" }}>کارت به کارت</header>
      {alertText ? <div ref={summaryRef} tabIndex={-1} role="alert" id="card-pay-error">{alertText}{notice?.retryAt ? " " : ""}{notice?.retryAt ? <TickingLabel targetMs={notice.retryAt} liveId="retry-live" visualId="retry-visual" /> : null}</div> : null}
      {payment ? (
        <>
          <StatusBadge status={payment.status} screen="payer" />
          <RejectLine reason={payment.reject_reason} />
          <p><bdi dir="ltr">{formatToman(payment.amount)}</bdi></p>
          {payment.deadline_at ? <p>مهلت <bdi dir="ltr">{formatTehran(payment.deadline_at)}</bdi></p> : null}
          {payment.sla_due_at ? <p>بررسی <bdi dir="ltr">{formatTehran(payment.sla_due_at)}</bdi></p> : null}
          {payment.cool_down_ends_at ? <p>فاصله <bdi dir="ltr">{formatTehran(payment.cool_down_ends_at)}</bdi></p> : null}
          {payment.deadline_at ? <TickingLabel targetMs={Date.parse(payment.deadline_at)} onZero={() => { void reload(); }} liveId="deadline-live" visualId="deadline-visual" /> : null}
          {payment.status === "pending" ? (
            <>
              <PayerDestination account={payment.destination.full_account} holderName={payment.destination.holder_name} bankName={payment.destination.bank_name} />
              <form onSubmit={(event) => void onSubmit(event)}>
                <label className="block">پیگیری
                  <input dir="ltr" className="min-h-11 w-full" inputMode="numeric" aria-describedby="tracking-hint" autoComplete="off" value={toFaDigits(tracking)} onChange={(event) => { idempotencyKey.current = null; setTracking(event.target.value); }} />
                </label>
                <p id="tracking-hint">{trackingHint(tracking) ?? "شماره پیگیری"}</p>
                <label className="min-h-11 inline-flex items-center">رسید
                  <input className="min-h-11" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { idempotencyKey.current = null; setFile(event.target.files?.[0] ?? null); setFileError(null); }} />
                </label>
                <ReceiptPreview file={file} />
                <button type="submit" className="min-h-11 min-w-11 px-3" style={ink} disabled={busy || blocked} aria-describedby={blocked ? "card-pay-error" : undefined}>ثبت رسید</button>
              </form>
            </>
          ) : (
            <MaskedDestination account={payment.destination.masked_account} holderName={payment.destination.holder_name} bankName={payment.destination.bank_name} />
          )}
        </>
      ) : null}
    </div>
  );
}
