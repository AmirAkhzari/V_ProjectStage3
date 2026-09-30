import { createBrowserRouter, type RouteObject } from "react-router-dom";
import RequireAuth, { RedirectIfAuthed } from "@/components/layout/RequireAuth";
import TabLayout from "@/components/layout/TabLayout";
import LoginPage from "@/pages/LoginPage";
import HomePage from "@/pages/HomePage";
import RoutePage from "@/pages/RoutePage";
import TaskPage from "@/pages/TaskPage";
import CodeEntryPage from "@/pages/CodeEntryPage";
import HistoryPage from "@/pages/HistoryPage";
import NotificationsPage from "@/pages/NotificationsPage";
import ProfilePage from "@/pages/ProfilePage";
import NotFoundPage from "@/pages/NotFoundPage";

export const routes: RouteObject[] = [
  {
    element: <RedirectIfAuthed />,
    children: [{ path: "/login", element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <TabLayout />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/route", element: <RoutePage /> },
          { path: "/history", element: <HistoryPage /> },
          { path: "/profile", element: <ProfilePage /> },
        ],
      },
      { path: "/tasks/:id", element: <TaskPage /> },
      { path: "/tasks/:id/code", element: <CodeEntryPage /> },
      { path: "/notifications", element: <NotificationsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
