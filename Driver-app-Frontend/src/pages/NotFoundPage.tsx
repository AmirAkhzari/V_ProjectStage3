import { Link } from "react-router-dom";
import { MapPinOff } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";

export default function NotFoundPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={<MapPinOff />}
        title="صفحه پیدا نشد"
        action={
          <Link to="/" className="flex h-11 items-center justify-center rounded-xl bg-fill font-semibold">
            بازگشت به توزیع امروز
          </Link>
        }
      />
    </div>
  );
}
