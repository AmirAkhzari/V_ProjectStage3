import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";

export default function ToastHost() {
  const toast = useAppStore((s) => s.toast);
  const toastAction = useAppStore((s) => s.toastAction);
  const setToast = useAppStore((s) => s.setToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), toastAction ? 4500 : 2800);
    return () => clearTimeout(t);
  }, [toast, toastAction, setToast]);

  if (!toast) return null;

  return (
    <div className="absolute top-3 inset-x-3 z-50">
      <div className="toast-in mx-auto max-w-sm rounded-[14px] bg-accent text-inverse px-4 py-2.5 text-[13px] font-semibold flex items-center justify-center gap-3">
        <span className="text-center">{toast}</span>
        {toastAction ? (
          <button
            type="button"
            className="shrink-0 underline underline-offset-2"
            onClick={() => {
              toastAction.onClick();
              setToast("");
            }}
          >
            {toastAction.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
