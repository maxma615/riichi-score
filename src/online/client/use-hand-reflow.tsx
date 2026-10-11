"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { DiscardMotionIntent } from "./discard-motion";
import { isAcceptedOwnHandDiscard, matchHandReflowOccurrences, type HandReflowTile } from "./hand-reflow";
import { acceptedNukiEvent, uniqueOwnNorthInstance } from "./nuki-motion";
import type { RoomView } from "../domain/types";

const durationMs = 250;
const easing = "cubic-bezier(.22,.65,.35,1)";

type Baseline = Readonly<{
  room: RoomView;
  ownSeat: number;
  connected: boolean;
  scope: string;
  tiles: HandReflowTile[];
}>;
type PreparedSource = Readonly<{
  roomId: string;
  version: number;
  decisionId: string | null;
  scope: string;
  connected: boolean;
  tiles: HandReflowTile[];
}>;
type ActiveAnimation = Readonly<{
  animation: Animation;
  transition: string;
  transitionPriority: string;
}>;

function tableScope(room: RoomView, ownSeat: number) {
  const game = room.game;
  return `${room.id}:${game?.gameInstanceId ?? "legacy"}:${game?.handId ?? "legacy"}:${ownSeat}`;
}

function readHandTiles(table: HTMLElement | null): HandReflowTile[] {
  const hand = table?.querySelector<HTMLElement>(".mahjong-hand");
  if (!hand) return [];
  return [...hand.querySelectorAll<HTMLElement>("button[data-hand-instance-id][data-tile-face]")].flatMap(element => {
    const instanceId = element.dataset.handInstanceId || "";
    const face = element.dataset.tileFace || "";
    const rect = element.getBoundingClientRect();
    if (!instanceId || !face || rect.width <= 0 || rect.height <= 0) return [];
    return [{ instanceId, face, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }];
  });
}

export function useHandReflow({
  room,
  ownSeat,
  connected,
  canAnimate,
  intent,
  tableRef,
}: {
  room: RoomView;
  ownSeat: number;
  connected: boolean;
  canAnimate: boolean;
  intent: DiscardMotionIntent | null;
  tableRef: RefObject<HTMLDivElement | null>;
}) {
  const latest = useRef<Baseline | null>(null);
  const preparedSource = useRef<PreparedSource | null>(null);
  const active = useRef(new Map<HTMLElement, ActiveAnimation>());
  const activeDecision = useRef<string | null>(null);

  const restoreTransition = useCallback((element: HTMLElement, transition: string, priority: string) => {
    if (transition) element.style.setProperty("transition", transition, priority);
    else element.style.removeProperty("transition");
  }, []);

  const cancel = useCallback(() => {
    const animations = [...active.current.entries()];
    active.current.clear();
    activeDecision.current = null;
    for (const [element, activeAnimation] of animations) {
      activeAnimation.animation.onfinish = null;
      activeAnimation.animation.cancel();
      restoreTransition(element, activeAnimation.transition, activeAnimation.transitionPriority);
    }
  }, [restoreTransition]);

  const recaptureAfterEnvironmentChange = useCallback(() => {
    cancel();
    preparedSource.current = null;
    const baseline = latest.current;
    if (baseline) latest.current = { ...baseline, tiles: readHandTiles(tableRef.current) };
  }, [cancel, tableRef]);

  const captureBeforeInput = useCallback(() => {
    cancel();
    const baseline = latest.current;
    if (!baseline) return;
    const tiles = readHandTiles(tableRef.current);
    latest.current = { ...baseline, tiles };
    preparedSource.current = {
      roomId: baseline.room.id,
      version: baseline.room.version,
      decisionId: baseline.room.game?.decisionId ?? null,
      scope: baseline.scope,
      connected: baseline.connected,
      tiles,
    };
  }, [cancel, tableRef]);

  useLayoutEffect(() => {
    const previous = latest.current;
    const scope = tableScope(room, ownSeat);
    const game = room.game;
    const scopeChanged = Boolean(previous && previous.scope !== scope);
    const connectionChanged = Boolean(previous && previous.connected !== connected);
    const decisionChanged = Boolean(activeDecision.current && game?.decisionId !== activeDecision.current);
    if (scopeChanged || connectionChanged || decisionChanged) cancel();

    const reducedMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const eligible = connected && canAnimate && !reducedMotion && !hidden;
    const handRoot = tableRef.current?.querySelector<HTMLElement>(".mahjong-hand") ?? null;
    const nuki = previous && eligible && previous.connected && !scopeChanged && !connectionChanged ? acceptedNukiEvent(previous.room, room) : null;
    const northId = nuki?.seat === ownSeat ? uniqueOwnNorthInstance(previous?.tiles ?? []) : null;
    const acceptedDiscard = Boolean(previous && !scopeChanged && !connectionChanged && previous.connected && eligible
      && isAcceptedOwnHandDiscard(previous.room, room, intent));
    const accepted = acceptedDiscard || Boolean(northId);
    const prepared = preparedSource.current;
    const usePreparedSource = Boolean(accepted && prepared && previous
      && prepared.roomId === previous.room.id
      && prepared.version === previous.room.version
      && prepared.decisionId === previous.room.game?.decisionId
      && prepared.scope === previous.scope
      && prepared.connected === previous.connected);
    const sourceTiles = usePreparedSource ? prepared!.tiles : previous?.tiles ?? [];
    const neutralized = new Map<HTMLElement, { transition: string; priority: string }>();
    if (accepted) {
      for (const element of handRoot?.querySelectorAll<HTMLElement>("button[data-hand-instance-id]") ?? []) {
        neutralized.set(element, {
          transition: element.style.getPropertyValue("transition"),
          priority: element.style.getPropertyPriority("transition"),
        });
        element.style.setProperty("transition", "none");
      }
    }
    const targets = readHandTiles(tableRef.current);

    let startedForAcceptance = false;
    if (accepted) {
      const removedId = northId || intent!.sourceTileId;
      const destinations = northId ? targets.filter(tile => !tile.instanceId.startsWith("drawn:")) : targets;
      const matches = matchHandReflowOccurrences(sourceTiles, destinations, removedId);
      for (const match of matches) {
        const dx = match.from.x - match.to.x;
        const dy = match.from.y - match.to.y;
        if (Math.hypot(dx, dy) < .5) continue;
        const target = [...(handRoot?.querySelectorAll<HTMLElement>("button[data-hand-instance-id]") ?? [])]
          .find(element => element.dataset.handInstanceId === match.targetInstanceId && element.dataset.tileFace === match.face);
        if (!target || typeof target.animate !== "function") continue;

        const transition = neutralized.get(target) ?? {
          transition: target.style.getPropertyValue("transition"),
          priority: target.style.getPropertyPriority("transition"),
        };
        neutralized.delete(target);
        target.style.setProperty("transition", "none");
        const animation = target.animate(
          [
            { translate: `${dx}px ${dy}px` } as Keyframe,
            { translate: "0px 0px" } as Keyframe,
          ],
          { duration: durationMs, easing, fill: "both" },
        );
        animation.id = `mahjong-hand-reflow:${encodeURIComponent(match.sourceInstanceId)}`;
        active.current.set(target, {
          animation,
          transition: transition.transition,
          transitionPriority: transition.priority,
        });
        animation.onfinish = () => {
          if (active.current.get(target)?.animation !== animation) return;
          active.current.delete(target);
          animation.onfinish = null;
          animation.cancel();
          restoreTransition(target, transition.transition, transition.priority);
          if (active.current.size === 0) activeDecision.current = null;
        };
      }
      if (active.current.size) {
        activeDecision.current = game?.decisionId ?? null;
        startedForAcceptance = true;
      }
    }
    for (const [element, transition] of neutralized) restoreTransition(element, transition.transition, transition.priority);

    const keepDestinationBaseline = Boolean(!startedForAcceptance && active.current.size && previous && !scopeChanged && !connectionChanged
      && game?.decisionId === activeDecision.current);
    if (previous && (scopeChanged || connectionChanged || previous.room.version !== room.version)) preparedSource.current = null;
    latest.current = {
      room, ownSeat, connected, scope,
      // Reading a running WAAPI transform gives its visible interpolated box;
      // retain the accepted target boxes across quiet snapshots instead.
      tiles: keepDestinationBaseline ? previous!.tiles : targets,
    };
  });

  useEffect(() => {
    const invalidate = () => recaptureAfterEnvironmentChange();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const observerTarget = tableRef.current;
    let priorSize = observerTarget?.getBoundingClientRect();
    const observer = typeof ResizeObserver === "undefined" || !observerTarget
      ? null
      : new ResizeObserver(() => {
        const next = observerTarget.getBoundingClientRect();
        if (!priorSize || Math.abs(next.width - priorSize.width) > .5 || Math.abs(next.height - priorSize.height) > .5) invalidate();
        priorSize = next;
      });
    observer?.observe(observerTarget!);

    window.addEventListener("resize", invalidate);
    window.addEventListener("orientationchange", invalidate);
    window.addEventListener("fullscreenchange", invalidate);
    window.addEventListener("webkitfullscreenchange", invalidate);
    window.visualViewport?.addEventListener("resize", invalidate);
    screen.orientation?.addEventListener?.("change", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    reducedMotion?.addEventListener?.("change", invalidate);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("orientationchange", invalidate);
      window.removeEventListener("fullscreenchange", invalidate);
      window.removeEventListener("webkitfullscreenchange", invalidate);
      window.visualViewport?.removeEventListener("resize", invalidate);
      screen.orientation?.removeEventListener?.("change", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
      reducedMotion?.removeEventListener?.("change", invalidate);
      cancel();
    };
  }, [cancel, recaptureAfterEnvironmentChange, tableRef]);

  return { cancel, captureBeforeInput };
}
