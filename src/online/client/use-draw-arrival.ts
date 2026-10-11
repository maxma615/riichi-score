"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GameView } from "../domain/types";

type Source = { connected: boolean; canAnimate: boolean; heldDecisionId?: string | null };
type Snapshot = { scope: string; decision: string; connected: boolean };

// A displayed drawn tile is state. Only a new live decision is an arrival.
export function useDrawArrival(game: GameView | null, roomId: string, ownSeat: number, source: Source) {
  const previous = useRef<Snapshot | null>(null);
  const pending = useRef<string | null>(null);
  const heldSequence = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [arrival, setArrival] = useState<string | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    heldSequence.current = null;
    setArrival(null);
  }, []);
  const scope = game?.gameInstanceId && Number.isInteger(game.handId)
    ? JSON.stringify([roomId, game.gameInstanceId, game.handId, ownSeat]) : null;
  const drawKey = scope && game?.drawnTile ? JSON.stringify([scope, game.decisionId]) : null;

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = scope && game ? { scope, decision: game.decisionId, connected: source.connected } : null;
    const preservingHeldSequence = heldSequence.current === drawKey && old?.decision === game?.decisionId;
    if (!game || !scope || !source.connected || (!source.canAnimate && !preservingHeldSequence) || !old?.connected || old.scope !== scope) {
      cancel();
      return;
    }
    if (old.decision === game.decisionId) {
      if (pending.current === drawKey && source.heldDecisionId !== game.decisionId) {
        pending.current = null;
        setArrival(drawKey);
        timer.current = setTimeout(() => { setArrival(null); timer.current = null; heldSequence.current = null; }, 220);
      }
      return;
    }
    cancel();
    if (!drawKey || game.turnSeat !== ownSeat || game.settlement || !["zimo", "gangzimo", "nukizimo"].includes(game.phase)) return;
    if (source.heldDecisionId === game.decisionId) {
      pending.current = drawKey;
      heldSequence.current = drawKey;
      return;
    }
    setArrival(drawKey);
    timer.current = setTimeout(() => { setArrival(null); timer.current = null; heldSequence.current = null; }, 220);
  }, [game, scope, drawKey, ownSeat, source.connected, source.canAnimate, source.heldDecisionId, cancel]);
  useEffect(() => {
    const events = ["resize", "orientationchange", "fullscreenchange", "webkitfullscreenchange"];
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    events.forEach(event => window.addEventListener(event, cancel));
    document.addEventListener("visibilitychange", cancel);
    window.visualViewport?.addEventListener("resize", cancel);
    screen.orientation?.addEventListener?.("change", cancel);
    query?.addEventListener?.("change", cancel);
    return () => {
      events.forEach(event => window.removeEventListener(event, cancel));
      document.removeEventListener("visibilitychange", cancel);
      window.visualViewport?.removeEventListener("resize", cancel);
      screen.orientation?.removeEventListener?.("change", cancel);
      query?.removeEventListener?.("change", cancel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [cancel]);

  return { arriving: source.connected && (source.canAnimate || heldSequence.current === drawKey) && arrival !== null && arrival === drawKey, cancel };
}
