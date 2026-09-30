import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AdminSession, Permission, Role } from "@/types";
import { api } from "@/services/client";
import { hasPermission } from "@/lib/permissions";

type SessionState = {
  hydrated: boolean;
  session: AdminSession | null;
  /** SuperAdmin-only switcher. DistributorAdmin is always pinned to its own distributor. */
  activeDistributorId: string | null;
  hydrate: () => void;
  setSession: (session: AdminSession | null) => void;
  setActiveDistributor: (id: string | null) => void;
  logout: () => Promise<void>;
};

function applyScope(session: AdminSession | null, active: string | null) {
  const pinned = session?.staff.role === "distributor_admin" ? (session.staff.distributorId ?? null) : active;
  api.setScope({ distributorId: pinned });
  return pinned;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      session: null,
      activeDistributorId: null,
      hydrate() {
        const session = api.getSession();
        const active = applyScope(session, get().activeDistributorId);
        set({ session, activeDistributorId: active, hydrated: true });
      },
      setSession(session) {
        const active = applyScope(
          session,
          session?.staff.role === "distributor_admin" ? (session.staff.distributorId ?? null) : null,
        );
        set({ session, activeDistributorId: active });
      },
      setActiveDistributor(id) {
        const active = applyScope(get().session, id);
        set({ activeDistributorId: active });
      },
      async logout() {
        await api.logout();
        api.setScope({ distributorId: null });
        set({ session: null, activeDistributorId: null });
      },
    }),
    {
      name: "visitor-admin:session:v1",
      partialize: (s) => ({ activeDistributorId: s.activeDistributorId }),
    },
  ),
);

export function useSession() {
  return useSessionStore((s) => s.session);
}

export function useRole(): Role | null {
  return useSessionStore((s) => s.session?.staff.role ?? null);
}

export function useIsDistributorAdmin() {
  return useRole() === "distributor_admin";
}

export function useCan(perm: Permission | Permission[] | undefined) {
  const permissions = useSessionStore((s) => s.session?.permissions);
  return hasPermission(permissions, perm);
}

export function useActiveDistributorId() {
  return useSessionStore((s) => s.activeDistributorId);
}
