import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { Loader2 } from "lucide-react";
import AuthLayout from "@/layouts/AuthLayout";
import AdminLayout from "@/layouts/AdminLayout";
import RequireAuth, { RedirectIfAuthed } from "./guards/RequireAuth";
import RequireRole from "./guards/RequireRole";
import LoginPage from "@/pages/auth/LoginPage";
import OtpPage from "@/pages/auth/OtpPage";
import NotFoundPage from "@/pages/NotFoundPage";

const DashboardPage = lazy(() => import("@/pages/dashboard/DashboardPage"));
const OrdersPage = lazy(() => import("@/pages/orders/OrdersPage"));
const OrderDetailPage = lazy(() => import("@/pages/orders/OrderDetailPage"));
const ProductsPage = lazy(() => import("@/pages/products/ProductsPage"));
const ProductFormPage = lazy(() => import("@/pages/products/ProductFormPage"));
const StockPage = lazy(() => import("@/pages/stock/StockPage"));
const DistributorsPage = lazy(() => import("@/pages/distributors/DistributorsPage"));
const DistributorDetailPage = lazy(() => import("@/pages/distributors/DistributorDetailPage"));
const RetailersPage = lazy(() => import("@/pages/retailers/RetailersPage"));
const RetailerDetailPage = lazy(() => import("@/pages/retailers/RetailerDetailPage"));
const CouponsPage = lazy(() => import("@/pages/marketing/CouponsPage"));
const BannersPage = lazy(() => import("@/pages/marketing/BannersPage"));
const MessagesPage = lazy(() => import("@/pages/marketing/MessagesPage"));
const PaymentsPage = lazy(() => import("@/pages/finance/PaymentsPage"));
const WalletsPage = lazy(() => import("@/pages/finance/WalletsPage"));
const SubscriptionsPage = lazy(() => import("@/pages/finance/SubscriptionsPage"));
const SlotsPage = lazy(() => import("@/pages/delivery/SlotsPage"));
const CitiesPage = lazy(() => import("@/pages/delivery/CitiesPage"));
const GeneralPage = lazy(() => import("@/pages/settings/GeneralPage"));
const StaffPage = lazy(() => import("@/pages/settings/StaffPage"));
const AuditLogPage = lazy(() => import("@/pages/settings/AuditLogPage"));
const DriversPage = lazy(() => import("@/pages/drivers/DriversPage"));
const DriverDetailPage = lazy(() => import("@/pages/drivers/DriverDetailPage"));
const DeliveriesPage = lazy(() => import("@/pages/deliveries/DeliveriesPage"));

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-label-secondary">
          <Loader2 className="size-5 animate-spin" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export const routes: RouteObject[] = [
  {
    element: <RedirectIfAuthed />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/otp", element: <OtpPage /> },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          {
            path: "/",
            element: (
              <Lazy>
                <DashboardPage />
              </Lazy>
            ),
          },
          {
            element: <RequireRole perm="orders.view" />,
            children: [
              {
                path: "/orders",
                element: (
                  <Lazy>
                    <OrdersPage />
                  </Lazy>
                ),
              },
              {
                path: "/orders/:id",
                element: (
                  <Lazy>
                    <OrderDetailPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="products.view" />,
            children: [
              {
                path: "/products",
                element: (
                  <Lazy>
                    <ProductsPage />
                  </Lazy>
                ),
              },
              {
                path: "/products/new",
                element: (
                  <Lazy>
                    <ProductFormPage />
                  </Lazy>
                ),
              },
              {
                path: "/products/:id",
                element: (
                  <Lazy>
                    <ProductFormPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="stock.view" />,
            children: [
              {
                path: "/stock",
                element: (
                  <Lazy>
                    <StockPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="distributors.view" />,
            children: [
              {
                path: "/distributors",
                element: (
                  <Lazy>
                    <DistributorsPage />
                  </Lazy>
                ),
              },
              {
                path: "/distributors/:id",
                element: (
                  <Lazy>
                    <DistributorDetailPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="retailers.view" />,
            children: [
              {
                path: "/retailers",
                element: (
                  <Lazy>
                    <RetailersPage />
                  </Lazy>
                ),
              },
              {
                path: "/retailers/:id",
                element: (
                  <Lazy>
                    <RetailerDetailPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="coupons.view" />,
            children: [
              {
                path: "/marketing/coupons",
                element: (
                  <Lazy>
                    <CouponsPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="banners.manage" />,
            children: [
              {
                path: "/marketing/banners",
                element: (
                  <Lazy>
                    <BannersPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="messages.send" />,
            children: [
              {
                path: "/marketing/messages",
                element: (
                  <Lazy>
                    <MessagesPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="finance.view" />,
            children: [
              {
                path: "/finance/payments",
                element: (
                  <Lazy>
                    <PaymentsPage />
                  </Lazy>
                ),
              },
              {
                path: "/finance/wallets",
                element: (
                  <Lazy>
                    <WalletsPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="subscriptions.manage" />,
            children: [
              {
                path: "/finance/subscriptions",
                element: (
                  <Lazy>
                    <SubscriptionsPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="delivery.manage" />,
            children: [
              {
                path: "/delivery/slots",
                element: (
                  <Lazy>
                    <SlotsPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="drivers.view" />,
            children: [
              {
                path: "/drivers",
                element: (
                  <Lazy>
                    <DriversPage />
                  </Lazy>
                ),
              },
              {
                path: "/drivers/:id",
                element: (
                  <Lazy>
                    <DriverDetailPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="deliveries.confirm" />,
            children: [
              {
                path: "/deliveries",
                element: (
                  <Lazy>
                    <DeliveriesPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="settings.manage" />,
            children: [
              {
                path: "/delivery/cities",
                element: (
                  <Lazy>
                    <CitiesPage />
                  </Lazy>
                ),
              },
              {
                path: "/settings/general",
                element: (
                  <Lazy>
                    <GeneralPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="staff.manage" />,
            children: [
              {
                path: "/settings/staff",
                element: (
                  <Lazy>
                    <StaffPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            element: <RequireRole perm="audit.view" />,
            children: [
              {
                path: "/settings/audit-log",
                element: (
                  <Lazy>
                    <AuditLogPage />
                  </Lazy>
                ),
              },
            ],
          },
          {
            path: "/settings",
            element: <Navigate to="/settings/general" replace />,
          },
          {
            path: "/marketing",
            element: <Navigate to="/marketing/coupons" replace />,
          },
          {
            path: "/finance",
            element: <Navigate to="/finance/payments" replace />,
          },
          {
            path: "/delivery",
            element: <Navigate to="/delivery/slots" replace />,
          },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
