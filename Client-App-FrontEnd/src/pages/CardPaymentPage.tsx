import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { loadCardPaymentApi, type CardPaymentApi } from "@/cardPayment/model";
import { CardPaymentScreen } from "@/cardPayment/ui";
import { useAppStore } from "@/store/useAppStore";

export default function CardPaymentPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const logout = useAppStore((s) => s.logout);
  const [api, setApi] = useState<CardPaymentApi | null>(null);
  useEffect(() => {
    void loadCardPaymentApi().then(setApi);
  }, []);
  if (!api) return null;
  return <CardPaymentScreen paymentId={id} api={api} onLogout={() => logout()} onReauth={(path) => navigate(path, { replace: true })} />;
}
