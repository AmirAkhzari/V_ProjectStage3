import { CloudOff } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { NetworkError } from "@/services/api";

export default function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = error instanceof NetworkError && error.kind === "offline";
  const timeout = error instanceof NetworkError && error.kind === "timeout";
  return (
    <EmptyState
      icon={<CloudOff />}
      title={offline ? "اتصال برقرار نیست" : timeout ? "پاسخی از سرور دریافت نشد" : "دریافت اطلاعات ناموفق بود"}
      body={
        offline
          ? "اتصال اینترنت گوشی را بررسی کنید و دوباره تلاش کنید."
          : "چند لحظه بعد دوباره تلاش کنید. اگر مشکل ادامه داشت با مدیر شرکت پخش تماس بگیرید."
      }
      action={
        <Button variant="secondary" size="md" onClick={onRetry}>
          تلاش دوباره
        </Button>
      }
    />
  );
}
