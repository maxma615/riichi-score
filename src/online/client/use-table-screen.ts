"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { fitTableViewport } from "./fit-table-viewport";

type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

const landscape = () => window.matchMedia ? window.matchMedia("(orientation: landscape)").matches : window.innerWidth >= window.innerHeight;
const rotationHint = "当前浏览器无法自动横屏，请旋转手机后继续。";

export function useTableScreen(enabled = true) {
  const [frame, setFrame] = useState<ReturnType<typeof fitTableViewport>>(null);
  const [hint, setHint] = useState("");
  const [pending, setPending] = useState(false);
  const lifecycle = useRef({ mounted: true, fullscreen: false, orientation: false, orientationSession: null as Element | null, pending: false });
  useLayoutEffect(() => {
    const state = lifecycle.current;
    state.mounted = true;
    const media = window.matchMedia?.("(orientation: landscape)");
    const touch = window.matchMedia?.("(pointer: coarse)");
    const refresh = () => {
      const rotated = Boolean(touch?.matches && window.innerWidth <= 1024 && window.innerHeight > window.innerWidth);
      const next = fitTableViewport(window.innerWidth, window.innerHeight, rotated);
      setFrame(previous => previous?.width === next?.width && previous?.height === next?.height && previous?.rotated === next?.rotated ? previous : next);
      if (landscape()) setHint("");
    };
    refresh();
    const fullscreenChanged = () => {
      if (state.fullscreen && document.fullscreenElement !== document.documentElement) state.fullscreen = false;
      // An Escape/browser exit ends our ownership. Do not later exit a new
      // fullscreen session started by another part of the page.
      if (state.orientation && document.fullscreenElement !== state.orientationSession) { window.screen.orientation?.unlock?.(); state.orientation = false; state.orientationSession = null; }
    };
    media?.addEventListener?.("change", refresh);
    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
    touch?.addEventListener?.("change", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => {
      media?.removeEventListener?.("change", refresh);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
      touch?.removeEventListener?.("change", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      state.mounted = false;
      if (state.orientation) { window.screen.orientation?.unlock?.(); state.orientation = false; state.orientationSession = null; }
      if (state.fullscreen && document.fullscreenElement === document.documentElement) {
        void document.exitFullscreen?.().catch(() => {});
      }
      state.fullscreen = false;
    };
  }, []);

  async function enter() {
    const state = lifecycle.current;
    if (state.pending) return;
    state.pending = true;
    setPending(true);
    try {
      if (!document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen) throw new Error("fullscreen unavailable");
        await document.documentElement.requestFullscreen();
        state.fullscreen = true;
      }
      if (!state.mounted) {
        if (state.fullscreen && document.fullscreenElement === document.documentElement) await document.exitFullscreen?.();
        state.fullscreen = false;
        return;
      }
      const session = document.fullscreenElement;
      if (!session) throw new Error("fullscreen ended");
      const orientation = window.screen.orientation as LockableOrientation | undefined;
      if (!orientation?.lock) throw new Error("orientation unavailable");
      await orientation.lock("landscape");
      state.orientation = true;
      state.orientationSession = session;
      if (!state.mounted || document.fullscreenElement !== session) {
        orientation.unlock?.(); state.orientation = false; state.orientationSession = null;
        if (state.mounted) setHint(landscape() ? "" : rotationHint);
        return;
      }
      setHint("");
    } catch {
      if (state.mounted) setHint(landscape() ? "" : rotationHint);
    } finally {
      state.pending = false;
      if (state.mounted) setPending(false);
    }
  }
  return { enter, hint, pending, frame: enabled ? frame : null, rotated: enabled && Boolean(frame?.rotated) };
}
