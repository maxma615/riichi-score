"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { RoomView } from "../domain/types";
import { acceptedNukiEvent, uniqueOwnNorthInstance } from "./nuki-motion";
import { measureDiscardElement, rectToFlight, type FlightView } from "./use-discard-motion";
import type { HandReflowTile } from "./hand-reflow";

type Baseline = {
  room: RoomView;
  connected: boolean;
  tiles: HandReflowTile[];
  sources: Map<string, ReturnType<typeof measureDiscardElement>>;
};
type Active = {
  id: string;
  decision: string;
  target: HTMLElement;
  volume: HTMLElement;
  visibility: { value: string; priority: string };
  volumeVisibility: { value: string; priority: string };
  emphasis?: Animation;
};

function saveVisibility(element: HTMLElement) {
  return {
    value: element.style.getPropertyValue("visibility"),
    priority: element.style.getPropertyPriority("visibility"),
  };
}

function setVisibility(element: HTMLElement, visibility: { value: string; priority: string }) {
  if (visibility.value) element.style.setProperty("visibility", visibility.value, visibility.priority);
  else element.style.removeProperty("visibility");
}

function readHandGeometry(table: HTMLElement | null): Pick<Baseline, "tiles" | "sources"> {
  const sources: Baseline["sources"] = new Map();
  const tiles: HandReflowTile[] = [];
  table?.querySelectorAll<HTMLElement>(".mahjong-hand [data-hand-instance-id][data-tile-face]").forEach(element => {
    const id = element.dataset.handInstanceId!;
    const face = element.dataset.tileFace!;
    const measurement = measureDiscardElement(element);
    if (measurement) {
      sources.set(id, measurement);
      tiles.push({ instanceId: id, face, rect: {
        x: measurement.rect.left, y: measurement.rect.top, width: measurement.rect.width, height: measurement.rect.height,
      } });
    }
  });
  return { tiles, sources };
}

export function useNukiMotion({ room, ownSeat, connected, canAnimate, tableRef }: {
  room: RoomView;
  ownSeat: number;
  connected: boolean;
  canAnimate: boolean;
  tableRef: RefObject<HTMLDivElement | null>;
}) {
  const previous = useRef<Baseline | null>(null);
  const active = useRef<Active | null>(null);
  const [flight, setFlight] = useState<FlightView | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  const restore = useCallback(() => {
    const current = active.current;
    active.current = null;
    if (current) {
      if (current.emphasis) current.emphasis.onfinish = null;
      current.emphasis?.cancel();
      setVisibility(current.volume, current.volumeVisibility);
      setVisibility(current.target, current.visibility);
    }
    setFlight(null);
    setHeld(null);
  }, []);
  const finishFlight = useCallback((id: string) => {
    if (active.current?.id === id) restore();
  }, [restore]);
  const cancel = restore;
  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  const eligible = connected && canAnimate && !reducedMotion && !hidden;
  const predicted = eligible && previous.current?.connected ? acceptedNukiEvent(previous.current.room, room) : null;
  // Prevent the replacement painting an entrance before the layout effect
  // establishes the durable hold. Rules and choices are already current.
  const heldDecisionId = held ?? (predicted?.seat === ownSeat ? room.game!.decisionId : null);

  useLayoutEffect(() => {
    const old = previous.current;
    const table = tableRef.current;
    const event = eligible && old?.connected ? acceptedNukiEvent(old.room, room) : null;
    const sameScope = old && old.room.id === room.id && old.room.mySeat === room.mySeat
      && old.room.game?.gameInstanceId === room.game?.gameInstanceId && old.room.game?.handId === room.game?.handId;
    if (active.current && (!connected || reducedMotion || hidden || !sameScope || old?.connected !== connected
      || room.game?.settlement || room.game?.decisionId !== active.current.decision)) restore();

    if (event && table) {
      restore();
      const target = table.querySelector<HTMLElement>(`[data-nuki-seat="${event.seat}"] [data-nuki-index="${event.index}"] .mahjong-tile`);
      const volume = target?.closest<HTMLElement>("[data-nuki-volume]") ?? null;
      const destination = target && measureDiscardElement(target);
      if (target && volume && destination) {
        const next: Active = {
          id: event.id, decision: room.game!.decisionId, target, volume,
          visibility: saveVisibility(target), volumeVisibility: saveVisibility(volume),
        };
        active.current = next;
        const sourceId = event.seat === ownSeat ? uniqueOwnNorthInstance(old!.tiles) : null;
        const source = sourceId ? old!.sources.get(sourceId) : null;
        if (event.seat === ownSeat) setHeld(room.game!.decisionId);
        if (source && sourceId) {
          volume.style.setProperty("visibility", "hidden", "important");
          target.style.setProperty("visibility", "hidden", "important");
          setFlight({
            event: { ...event, roomId: room.id, gameInstanceId: room.game!.gameInstanceId!, handId: room.game!.handId!, tile: "z4" },
            source: "own", sourceTileId: sourceId, sourcePaint: source.paint, targetPaint: destination.paint,
            from: rectToFlight(source.rect, source.geometry), to: rectToFlight(destination.rect, destination.geometry),
          });
        } else {
          try {
            const emphasis = target.animate([{ opacity: .45, filter: "brightness(1.35)" }, { opacity: 1, filter: "none" }],
              { duration: 230, easing: "ease-out", fill: "both" });
            emphasis.id = `mahjong-nuki-arrival:${event.id}`;
            active.current = { ...next, emphasis };
            emphasis.onfinish = () => finishFlight(event.id);
          } catch {
            finishFlight(event.id);
          }
        }
      }
    }

    previous.current = { room, connected, ...readHandGeometry(table) };
  }, [room, ownSeat, connected, canAnimate, eligible, reducedMotion, hidden, tableRef, restore, finishFlight]);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const table = tableRef.current;
    let size = table?.getBoundingClientRect();
    let captureFrame: number | null = null;
    // Environment invalidation differs from input cancellation: the old
    // room is still useful for acceptance, but its old layout is no longer a
    // physical source. Clear it until a frame captures the current layout.
    const invalidateEnvironment = () => {
      cancel();
      if (captureFrame !== null) window.cancelAnimationFrame(captureFrame);
      captureFrame = null;
      const baseline = previous.current;
      if (!baseline) return;
      const invalidated = { ...baseline, tiles: [], sources: new Map() };
      previous.current = invalidated;
      if (typeof window.requestAnimationFrame !== "function") return;
      captureFrame = window.requestAnimationFrame(() => {
        captureFrame = null;
        if (previous.current !== invalidated || !invalidated.connected || document.visibilityState === "hidden"
          || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        previous.current = { ...invalidated, ...readHandGeometry(table) };
      });
    };
    const observer = typeof ResizeObserver === "undefined" || !table ? null : new ResizeObserver(() => {
      const next = table.getBoundingClientRect();
      if (!size || Math.abs(next.width - size.width) > .5 || Math.abs(next.height - size.height) > .5) invalidateEnvironment();
      size = next;
    });
    observer?.observe(table!);
    const events = ["resize", "orientationchange", "fullscreenchange", "webkitfullscreenchange"];
    events.forEach(event => window.addEventListener(event, invalidateEnvironment));
    window.visualViewport?.addEventListener("resize", invalidateEnvironment);
    screen.orientation?.addEventListener?.("change", invalidateEnvironment);
    document.addEventListener("visibilitychange", invalidateEnvironment);
    query?.addEventListener?.("change", invalidateEnvironment);
    return () => {
      observer?.disconnect();
      if (captureFrame !== null) window.cancelAnimationFrame(captureFrame);
      events.forEach(event => window.removeEventListener(event, invalidateEnvironment));
      window.visualViewport?.removeEventListener("resize", invalidateEnvironment);
      screen.orientation?.removeEventListener?.("change", invalidateEnvironment);
      document.removeEventListener("visibilitychange", invalidateEnvironment);
      query?.removeEventListener?.("change", invalidateEnvironment);
      restore();
    };
  }, [cancel, restore, tableRef]);

  return { flight, finishFlight, cancel, heldDecisionId };
}
