"use client";

import { create } from "zustand";

// Who is logged into the dashboard.
//
// "owner" = the machine owner (the dashboard password). "member" = a teammate
// who signed in with an API key — they may only use Basic Chat.
//
// The role is read from /api/auth/status, which reads the signed session
// cookie. The client never decides it; it only HIDES what the role may not
// use (the server enforces the same rules).
let inFlight = null;

const useSessionStore = create((set, get) => ({
  role: null,
  username: null,
  displayName: "",
  loading: false,
  loaded: false,

  fetchSession: async ({ force = false } = {}) => {
    if (!force && get().loaded) return get();
    if (inFlight) return inFlight;
    set({ loading: true });
    inFlight = (async () => {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        const data = res.ok ? await res.json() : {};
        set({
          role: data.role || null,
          username: data.username || null,
          displayName: data.displayName || "",
          loading: false,
          loaded: true,
        });
        return get();
      } catch {
        set({ loading: false, loaded: true });
        return get();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  reset: () => set({ role: null, username: null, displayName: "", loaded: false }),
}));

export default useSessionStore;
