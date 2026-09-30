import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import EmptyState from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { paths } from "@/routes/paths";

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass />}
      title="صفحه پیدا نشد"
      description="آدرس وارد شده وجود ندارد یا منتقل شده است."
      className="py-32"
      action={
        <Button asChild variant="secondary">
          <Link to={paths.dashboard}>بازگشت به داشبورد</Link>
        </Button>
      }
    />
  );
}
