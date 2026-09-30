import { create } from "zustand";
import type { DriverSession } from "@/types";
import { api } from "@/services/client";

export type SignOutReason = "expired" | "inactive" | null;

type SessionState = {
  hydrated: boolean;
  session: DriverSession | null;
  signOutReason: SignOutReason;
  hydrate: () => void;
  setSession: (session: DriverSession) => void;
  logout: (reason?: SignOutReason) => Promise<void>;
};

export const useSessionStore = create<SessionState>()((set) => ({
  hydrated: false,
  session: null,
  signOutReason: null,
  hydrate() {
    set({ session: api.getSession(), hydrated: true });
  },
  setSession(session) {
    set({ session, signOutReason: null });
  },
  async logout(reason = null) {
    await api.logout();
    set({ session: null, signOutReason: reason });
  },
}));
