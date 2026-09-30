import { Outlet } from "react-router-dom";
import ThemeToggle from "@/components/shared/ThemeToggle";
import VisitorLogo from "@/components/shared/VisitorLogo";

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="flex items-center justify-between px-6 py-4">
        <VisitorLogo size="sm" suffix="پنل مدیریت" />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[400px] rounded-2xl bg-card p-7">
          <Outlet />
        </div>
      </main>
      <footer className="pb-6 text-center text-[12px] text-label-tertiary">
        نسخه نمایشی · داده‌ها فقط در این مرورگر ذخیره می‌شوند
      </footer>
    </div>
  );
}
