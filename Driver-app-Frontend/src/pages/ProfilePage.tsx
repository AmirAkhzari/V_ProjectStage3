import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Moon, Phone, RotateCcw, Sun } from "lucide-react";
import LargeHeader from "@/components/layout/LargeHeader";
import Button from "@/components/ui/Button";
import { useMe } from "@/features/queries";
import { initials } from "@/lib/format";
import { formatPhoneDisplay } from "@/lib/phone";
import { isMockMode } from "@/services/client";
import { resetMockDb } from "@/services/mockApi";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import type { ReactNode } from "react";

export default function ProfilePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSessionStore((s) => s.session);
  const logout = useSessionStore((s) => s.logout);
  const { data: me } = useMe();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const driver = me ?? session?.driver;
  if (!driver) return null;

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      <LargeHeader title="پروفایل" />
      <div className="space-y-4 px-4">
        <section className="flex items-center gap-4 rounded-2xl bg-card p-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent text-[22px] font-bold text-inverse">
            {initials(driver.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[20px] font-extrabold">{driver.name}</div>
            <div className="text-[14px] text-label-secondary">راننده، {driver.distributorName}</div>
          </div>
        </section>

        <Group title="اطلاعات حساب">
          <Row label="شناسه راننده" value={<span className="ltr">{driver.username}</span>} />
          <Row label="موبایل" value={<span className="ltr">{formatPhoneDisplay(driver.phone)}</span>} />
          <Row label="شرکت پخش" value={driver.distributorName} />
          <Row label="خودرو" value={driver.vehicle ? driver.vehicle.type : "ثبت نشده"} />
          {driver.vehicle ? <Row label="پلاک" value={driver.vehicle.plate} /> : null}
        </Group>

        <Group title="پشتیبانی">
          <a href={`tel:${driver.distributorPhone}`} className="flex min-h-[52px] items-center justify-between px-4">
            <span className="flex items-center gap-3 text-[15px]">
              <Phone className="size-5" aria-hidden /> تماس با شرکت پخش
            </span>
            <span className="ltr text-[14px] text-label-secondary">{formatPhoneDisplay(driver.distributorPhone)}</span>
          </a>
          <div className="flex items-start gap-3 px-4 py-3 text-[14px] leading-6 text-label-secondary">
            <KeyRound className="mt-0.5 size-5 shrink-0" aria-hidden />
            برای تغییر رمز عبور یا اطلاعات حساب، از مدیر شرکت پخش درخواست کنید.
          </div>
        </Group>

        <Group title="نمایش">
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-[15px]"
          >
            <span className="flex items-center gap-3">
              {theme === "dark" ? <Moon className="size-5" /> : <Sun className="size-5" />}
              حالت تیره
            </span>
            <span
              className={`flex h-[31px] w-[51px] items-center rounded-full p-0.5 transition-colors ${
                theme === "dark" ? "bg-accent" : "bg-fill-secondary"
              }`}
              aria-hidden
            >
              <span
                className={`size-[27px] rounded-full bg-white shadow transition-transform ${
                  theme === "dark" ? "-translate-x-5" : ""
                }`}
              />
            </span>
          </button>
        </Group>

        {isMockMode ? (
          <Button
            variant="secondary"
            onClick={async () => {
              resetMockDb();
              await qc.invalidateQueries();
            }}
          >
            <RotateCcw /> بازنشانی داده‌های نمایشی
          </Button>
        ) : null}

        <Button
          variant="danger"
          onClick={async () => {
            await logout();
            qc.clear();
            navigate("/login", { replace: true });
          }}
        >
          <LogOut /> خروج از حساب
        </Button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 px-4 text-[13px] font-medium text-label-secondary">{title}</h2>
      <div className="divide-y divide-separator overflow-hidden rounded-2xl bg-card">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 text-[15px]">
      <span className="text-label-secondary">{label}</span>
      <span className="truncate font-semibold">{value}</span>
    </div>
  );
}
