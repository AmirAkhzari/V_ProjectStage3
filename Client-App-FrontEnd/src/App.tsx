import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import GuestLayout from "@/components/layout/GuestLayout";
import ProtectedLayout from "@/components/layout/ProtectedLayout";
import LoginPage from "@/pages/LoginPage";
import OtpPage from "@/pages/OtpPage";
import HomePage from "@/pages/HomePage";
import SearchPage from "@/pages/SearchPage";
import CategoryPage from "@/pages/CategoryPage";
import CartPage from "@/pages/CartPage";
import CheckoutPage from "@/pages/CheckoutPage";
import PaymentPage, { PaymentFailedPage } from "@/pages/PaymentPage";
import OrdersPage, { OrderDetailPage } from "@/pages/OrdersPage";
import ProfilePage from "@/pages/ProfilePage";
import WalletPage from "@/pages/WalletPage";
import DistributorPage from "@/pages/DistributorPage";
import DistributorStorePage from "@/pages/DistributorStorePage";
import AddressSelectPage from "@/pages/AddressSelectPage";
import AddressSearchPage from "@/pages/AddressSearchPage";
import MapPage from "@/pages/MapPage";
import AddressDetailsPage from "@/pages/AddressDetailsPage";
import EditProfilePage, { DiscountsPage, GiftCardsPage, MessagesPage, SupportPage } from "@/pages/AccountPages";
import SubscriptionPage from "@/pages/SubscriptionPage";
import PrimaryDistributorPage from "@/pages/PrimaryDistributorPage";
import { useAppStore } from "@/store/useAppStore";
import { applyTheme } from "@/lib/theme";

export default function App() {
  const hydrate = useAppStore((s) => s.hydrate);
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<GuestLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/otp" element={<OtpPage />} />
        </Route>

        <Route element={<ProtectedLayout tabs />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/category/:name" element={<CategoryPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/distributors" element={<DistributorPage />} />
        </Route>

        <Route element={<ProtectedLayout />}>
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/pay/:id" element={<PaymentPage />} />
          <Route path="/pay/:id/result" element={<PaymentPage />} />
          <Route path="/payment-failed" element={<PaymentFailedPage />} />
          <Route path="/subscription" element={<SubscriptionPage />} />
          <Route path="/onboarding/distributor" element={<PrimaryDistributorPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/distributors/:id" element={<DistributorStorePage />} />
          <Route path="/addresses" element={<AddressSelectPage />} />
          <Route path="/addresses/search" element={<AddressSearchPage />} />
          <Route path="/addresses/map" element={<MapPage />} />
          <Route path="/addresses/new" element={<AddressDetailsPage />} />
          <Route path="/profile/edit" element={<EditProfilePage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/discounts" element={<DiscountsPage />} />
          <Route path="/gift-cards" element={<GiftCardsPage />} />
          <Route path="/support" element={<SupportPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
