"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { RoomView } from "../domain/types";
import { MahjongFaceUpFlightTile, MahjongSolidFlightTile } from "./mahjong-solid-flight-tile";
import { quadToMatrix3d } from "./projected-geometry";
import { projectedRect, readProjectedTile } from "./table3d-projection";
import {
  DiscardMotionTracker,
  type DiscardMotionEvent,
  type DiscardMotionIntent,
  type MotionQuad,
  type MotionRect,
  type MotionNormal,
  type MotionSourceGeometry,
  type MotionTilePaint,
} from "./discard-motion";

type PointRect = MotionRect;

export type FlightGeometry = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  scale: number;
  quad?: MotionQuad;
  depth?: number;
  normal?: MotionNormal;
}>;

export type FlightView = Readonly<{
  event: DiscardMotionEvent;
  source: "own" | "opponent" | "public";
  sourceTileId?: string;
  sourcePaint?: MotionTilePaint;
  targetPaint?: MotionTilePaint;
  from: FlightGeometry;
  to: FlightGeometry;
}>;

type OpponentRackGeometry = { closed?: FlightGeometry; drawn?: FlightGeometry };

export function useDiscardMotion({
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
  const tracker = useRef(new DiscardMotionTracker());
  const previousRackRects = useRef(new Map<number, OpponentRackGeometry>());
  const environmentEpoch = useRef(0);
  const priorConnection = useRef(connected);
  const activeFlight = useRef<FlightView | null>(null);
  const [flight, setFlight] = useState<FlightView | null>(null);
  const [hiddenEvents, setHiddenEvents] = useState<ReadonlySet<string>>(() => new Set());

  const captureRackRects = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    const next = new Map<number, OpponentRackGeometry>();
    table.querySelectorAll<HTMLElement>("[data-motion-rack-seat] > i").forEach((element) => {
      const seat = Number(element.parentElement?.dataset.motionRackSeat);
      if (!Number.isInteger(seat) || seat === ownSeat) return;
      // An upright tile's visible back occupies a different plane from its
      // layout wrapper. Cache that surface before the accepted discard arrives.
      const surface = element.querySelector<HTMLElement>("[data-motion-surface]") ?? element;
      const rect = projectedRect(surface) ?? surface.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const rack = next.get(seat) ?? {};
        rack[element.dataset.motionDrawn === "true" ? "drawn" : "closed"] = elementToFlight(surface, rect);
        next.set(seat, rack);
      }
    });
    previousRackRects.current = next;
  }, [ownSeat, tableRef]);

  const cancelFlight = useCallback((refreshRacks = false) => {
    activeFlight.current = null;
    setFlight(null);
    setHiddenEvents(new Set());
    if (refreshRacks) captureRackRects();
  }, [captureRackRects]);

  const invalidateEnvironment = useCallback((refreshRacks = true) => {
    environmentEpoch.current++;
    cancelFlight(refreshRacks);
  }, [cancelFlight]);

  const finishFlight = useCallback((eventId: string) => {
    if (activeFlight.current?.event.id !== eventId) return;
    activeFlight.current = null;
    setFlight(null);
    setHiddenEvents((events) => {
      const next = new Set(events);
      next.delete(eventId);
      return next;
    });
  }, []);
  const getEnvironmentEpoch = useCallback(() => environmentEpoch.current, []);

  useLayoutEffect(() => {
    if (priorConnection.current !== connected) {
      priorConnection.current = connected;
      invalidateEnvironment(false);
    }
    const table = tableRef.current;
    const reducedMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const eligible = connected && canAnimate && !reducedMotion && !hidden;
    const currentIntent = intent?.environmentEpoch === environmentEpoch.current ? intent : null;
    const result = tracker.current.observe(room, { canAnimate: eligible, intent: currentIntent });

    if (!connected || reducedMotion || hidden) cancelFlight();
    if (result.reset || (!eligible && result.newEvents.length > 0)) cancelFlight();
    if (result.cancelledEventIds.some((eventId) => activeFlight.current?.event.id === eventId)) cancelFlight();

    if (result.flight && table) {
      const eventId = result.flight.event.id;
      const target = [...table.querySelectorAll<HTMLElement>("[data-discard-event-id]")]
        .find((element) => element.dataset.discardEventId === eventId);
      const face = target?.querySelector<HTMLElement>(".mahjong-tile");
      const targetRect = face && (projectedRect(face) ?? face.getBoundingClientRect());
      const cachedRack = result.flight.source === "opponent"
        ? previousRackRects.current.get(result.flight.event.seat)
        : undefined;
      const cachedSource = result.flight.event.tile.includes("_")
        ? cachedRack?.drawn ?? cachedRack?.closed
        : cachedRack?.closed;
      const sourceRect = result.flight.source === "own"
        ? result.flight.sourceRect
        : undefined;

      if (target && face && targetRect && (sourceRect || cachedSource) && targetRect.width > 0 && targetRect.height > 0) {
        const from = cachedSource || rectToFlight(sourceRect!, result.flight.sourceGeometry!);
        const to = targetToFlight(face, targetRect);
        const next: FlightView = {
          event: result.flight.event,
          source: result.flight.source,
          sourceTileId: result.flight.sourceTileId,
          sourcePaint: result.flight.sourcePaint,
          targetPaint: result.flight.source === "own" ? readTilePaint(face, target) : undefined,
          from,
          to,
        };
        activeFlight.current = next;
        setFlight(next);
        setHiddenEvents(new Set([eventId]));
      }
    }

    captureRackRects();
  }, [room, ownSeat, connected, canAnimate, intent, tableRef, captureRackRects, cancelFlight, invalidateEnvironment]);

  useEffect(() => {
    const cancelAndRefresh = () => invalidateEnvironment(true);
    const cancelForVisibility = () => {
      invalidateEnvironment(true);
    };
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMotionPreference = () => invalidateEnvironment(true);
    const observer = typeof ResizeObserver === "undefined" || !tableRef.current
      ? null
      : new ResizeObserver(cancelAndRefresh);

    window.addEventListener("resize", cancelAndRefresh);
    window.addEventListener("orientationchange", cancelAndRefresh);
    window.addEventListener("fullscreenchange", cancelAndRefresh);
    window.addEventListener("webkitfullscreenchange", cancelAndRefresh);
    window.visualViewport?.addEventListener("resize", cancelAndRefresh);
    screen.orientation?.addEventListener?.("change", cancelAndRefresh);
    document.addEventListener("visibilitychange", cancelForVisibility);
    query?.addEventListener?.("change", onMotionPreference);
    if (tableRef.current) observer?.observe(tableRef.current);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", cancelAndRefresh);
      window.removeEventListener("orientationchange", cancelAndRefresh);
      window.removeEventListener("fullscreenchange", cancelAndRefresh);
      window.removeEventListener("webkitfullscreenchange", cancelAndRefresh);
      window.visualViewport?.removeEventListener("resize", cancelAndRefresh);
      screen.orientation?.removeEventListener?.("change", cancelAndRefresh);
      document.removeEventListener("visibilitychange", cancelForVisibility);
      query?.removeEventListener?.("change", onMotionPreference);
    };
  }, [tableRef, captureRackRects, cancelFlight, invalidateEnvironment]);

  return {
    flight,
    hiddenEventIds: hiddenEvents,
    finishFlight,
    environmentEpoch: getEnvironmentEpoch,
  };
}

export function rectToFlight(rect: PointRect, geometry: MotionSourceGeometry): FlightGeometry {
  return {
    left: rect.left + rect.width / 2,
    top: rect.top + rect.height / 2,
    ...geometry,
  };
}

export function measureDiscardElement(element: HTMLElement) {
  const rect = projectedRect(element) ?? element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const geometry = elementToFlight(element, rect);
  return {
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    paint: readTilePaint(element),
    geometry: {
      width: geometry.width,
      height: geometry.height,
      angle: geometry.angle,
      scale: geometry.scale,
      quad: geometry.quad,
      ...(geometry.depth ? { depth: geometry.depth } : {}),
      ...(geometry.normal ? { normal: geometry.normal } : {}),
    },
  };
}

// A source outside the table must keep its actual paint when the portal takes
// over. Capture only visual properties; geometry and private tile state stay
// separate. This snapshot never enters the server Choice payload.
function readTilePaint(element: HTMLElement, wrapper?: HTMLElement): MotionTilePaint {
  const style = getComputedStyle(element);
  // Tsumogiri tint lives on the cap and side paint planes so their shared
  // preserve-3d parent stays unflattened. Retain any other source wrapper paint.
  const wrapperFilter = wrapper ? getComputedStyle(wrapper).filter : "none";
  const filter = [style.filter, wrapperFilter].filter(value => value && value !== "none").join(" ") || "none";
  return {
    background: style.background, border: style.borderTop,
    borderRadius: style.borderTopLeftRadius, padding: style.padding,
    boxShadow: style.boxShadow,
    outline: style.outlineStyle === "none" ? "none" : style.outline,
    outlineOffset: style.outlineOffset, filter,
  };
}

function targetToFlight(face: HTMLElement, rect: MotionRect): FlightGeometry {
  return elementToFlight(face, rect);
}

function elementToFlight(element: HTMLElement, rect: MotionRect): FlightGeometry {
  const projected = readProjectedTile(element);
  if (projected) return rectToFlight(projected.rect, projected.geometry);
  const style = getComputedStyle(element);
  const width = borderBoxSize(element, style, "width") || element.offsetWidth || rect.width;
  const height = borderBoxSize(element, style, "height") || element.offsetHeight || rect.height;
  const depth = physicalDepth(element);
  const quad = measureElementQuad(element, style);
  const normal = quad && depth ? measureElementNormal(element, style, depth, quad) : undefined;
  const { angle, scale } = accumulatedTransform(element);
  return {
    left: rect.left + rect.width / 2,
    top: rect.top + rect.height / 2,
    width,
    height,
    angle,
    scale,
    quad,
    ...(depth ? { depth } : {}),
    ...(normal ? { normal } : {}),
  };
}

function physicalDepth(element: HTMLElement) {
  const standing = element.closest<HTMLElement>("[data-standing-body]");
  if (standing) return numeric(getComputedStyle(standing).height);
  const volume = element.closest<HTMLElement>("[data-river-volume], [data-meld-volume], [data-nuki-volume]");
  return volume ? numeric(getComputedStyle(volume).height) * .4 : 0;
}

function borderBoxSize(element: HTMLElement, style: CSSStyleDeclaration, axis: "width" | "height") {
  const size = numeric(style[axis]);
  if (!size || style.boxSizing === "border-box") return size;
  const sides = axis === "width" ? ["Left", "Right"] : ["Top", "Bottom"];
  const extras = sides.reduce((sum, side) => sum
    + numeric(style[`padding${side}` as keyof CSSStyleDeclaration] as string)
    + numeric(style[`border${side}Width` as keyof CSSStyleDeclaration] as string), 0);
  return size + extras;
}

function measureElementQuad(element: HTMLElement, style: CSSStyleDeclaration): MotionQuad | undefined {
  const corners: Array<keyof MotionQuad> = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  const dataNames: Record<keyof MotionQuad, string> = {
    topLeft: "top-left",
    topRight: "top-right",
    bottomRight: "bottom-right",
    bottomLeft: "bottom-left",
  };
  const border = {
    left: numeric(style.borderLeftWidth),
    right: numeric(style.borderRightWidth),
    top: numeric(style.borderTopWidth),
    bottom: numeric(style.borderBottomWidth),
  };
  const savedStyle = element.getAttribute("style");
  const changedPosition = style.position === "static";
  const markers = corners.map((corner) => {
    const marker = document.createElement("span");
    marker.dataset.discardMotionCorner = dataNames[corner];
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText = "position:absolute;display:block;width:0;height:0;min-width:0;min-height:0;padding:0;margin:0;border:0;overflow:hidden;line-height:0;pointer-events:none!important;visibility:hidden;transform:none!important;";
    if (corner === "topLeft" || corner === "bottomLeft") marker.style.left = `${-border.left}px`;
    else marker.style.right = `${-border.right}px`;
    if (corner === "topLeft" || corner === "topRight") marker.style.top = `${-border.top}px`;
    else marker.style.bottom = `${-border.bottom}px`;
    return marker;
  });

  try {
    if (changedPosition) element.style.setProperty("position", "relative", "important");
    markers.forEach((marker) => element.append(marker));
    const points = markers.map((marker) => {
      const rect = marker.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    });
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return undefined;
    const quad = {
      topLeft: points[0],
      topRight: points[1],
      bottomRight: points[2],
      bottomLeft: points[3],
    };
    return usableQuad(quad) ? quad : undefined;
  } catch {
    return undefined;
  } finally {
    markers.forEach((marker) => marker.remove());
    if (changedPosition) {
      if (savedStyle === null) element.removeAttribute("style");
      else element.setAttribute("style", savedStyle);
    }
  }
}

function measureElementNormal(element: HTMLElement, style: CSSStyleDeclaration, depth: number, plane: MotionQuad): MotionNormal | undefined {
  if (!(depth > 0) || !Number.isFinite(depth)) return undefined;
  const borderLeft = numeric(style.borderLeftWidth);
  const borderTop = numeric(style.borderTopWidth);
  const saved = new Map<HTMLElement, string | null>();
  const marker = (corner: "top-left" | "top-right", z: number) => {
    const marker = document.createElement("span");
    marker.dataset.discardMotionNormal = `${corner}-${z === 0 ? "plane" : "raised"}`;
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText = `position:absolute;display:block;width:0;height:0;min-width:0;min-height:0;padding:0;margin:0;border:0;overflow:hidden;line-height:0;pointer-events:none!important;visibility:hidden;transition:none!important;animation:none!important;transform:${z === 0 ? "none" : `translateZ(${z}px)`}!important;`;
    if (corner === "top-left") marker.style.left = `${-borderLeft}px`;
    else marker.style.right = `${-numeric(style.borderRightWidth)}px`;
    marker.style.top = `${-borderTop}px`;
    return marker;
  };
  const planeMarkers = (["top-left", "top-right"] as const).map(corner => marker(corner, 0));
  const raisedMarkers = (["top-left", "top-right"] as const).map(corner => marker(corner, depth));
  const markers = [...planeMarkers, ...raisedMarkers];

  try {
    // A flat ancestor silently projects translateZ back onto the face plane.
    // Temporarily preserve the actual 3D chain through the shared table camera,
    // then restore every pre-existing inline style byte-for-byte.
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
      saved.set(current, current.getAttribute("style"));
      current.style.setProperty("transform-style", "preserve-3d", "important");
      current.style.setProperty("-webkit-transform-style", "preserve-3d", "important");
      current.style.setProperty("overflow", "visible", "important");
      // A paint filter on the tile cap (for example the tsumogiri tint) is a
      // grouping property: it flattens a child's translateZ even while
      // transform-style says preserve-3d. Remove it only during this
      // synchronous probe so the normal reflects the shared table camera.
      current.style.setProperty("filter", "none", "important");
      current.style.setProperty("-webkit-filter", "none", "important");
      current.style.setProperty("opacity", "1", "important");
      current.style.setProperty("clip-path", "none", "important");
      current.style.setProperty("-webkit-clip-path", "none", "important");
      current.style.setProperty("mask", "none", "important");
      current.style.setProperty("-webkit-mask", "none", "important");
      current.style.setProperty("mix-blend-mode", "normal", "important");
      current.style.setProperty("isolation", "auto", "important");
      current.style.setProperty("contain", "none", "important");
      current.style.setProperty("backdrop-filter", "none", "important");
      current.style.setProperty("-webkit-backdrop-filter", "none", "important");
      if (current.classList.contains("mahjong-table__surface") || current === document.documentElement) break;
    }
    if (style.position === "static") element.style.setProperty("position", "relative", "important");
    markers.forEach(marker => element.append(marker));
    const points = raisedMarkers.map(marker => {
      const rect = marker.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    });
    const planePoints = planeMarkers.map(marker => {
      const rect = marker.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    });
    if ([...points, ...planePoints].some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return undefined;
    // Preserve-3D and clearing grouping properties must not alter the z=0
    // face quad captured immediately beforehand. Otherwise the raised probe
    // would encode a different plane instead of the element's true normal.
    if (Math.hypot(planePoints[0].x - plane.topLeft.x, planePoints[0].y - plane.topLeft.y) > .5
      || Math.hypot(planePoints[1].x - plane.topRight.x, planePoints[1].y - plane.topRight.y) > .5) return undefined;
    return { depth, topLeft: points[0], topRight: points[1] };
  } catch {
    return undefined;
  } finally {
    markers.forEach(marker => marker.remove());
    for (const [node, styleText] of saved) {
      if (styleText === null) node.removeAttribute("style");
      else node.setAttribute("style", styleText);
    }
  }
}

function usableQuad(quad: MotionQuad) {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
  return Number.isFinite(area) && Math.abs(area) > 1;
}

function numeric(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function accumulatedTransform(element: HTMLElement) {
  let a = 1, b = 0, c = 0, d = 1;
  for (let current: HTMLElement | null = element; current && current !== document.body; current = current.parentElement) {
    const matrix = parseTransform(getComputedStyle(current).transform);
    const nextA = matrix.a * a + matrix.c * b;
    const nextB = matrix.b * a + matrix.d * b;
    const nextC = matrix.a * c + matrix.c * d;
    const nextD = matrix.b * c + matrix.d * d;
    a = nextA; b = nextB; c = nextC; d = nextD;
  }
  return { angle: Math.atan2(b, a) * 180 / Math.PI, scale: Math.hypot(a, b) || 1 };
}

function parseTransform(transform: string) {
  if (!transform || transform === "none") return { a: 1, b: 0, c: 0, d: 1 };
  const values = transform.match(/matrix\(([^)]+)\)/)?.[1].split(",").map(Number);
  if (values?.length === 6 && values.every(Number.isFinite)) return { a: values[0], b: values[1], c: values[2], d: values[3] };
  const values3d = transform.match(/matrix3d\(([^)]+)\)/)?.[1].split(",").map(Number);
  if (values3d?.length === 16 && values3d.every(Number.isFinite)) return { a: values3d[0], b: values3d[1], c: values3d[4], d: values3d[5] };
  return { a: 1, b: 0, c: 0, d: 1 };
}

function animateVolumeDepth(node: HTMLElement, fromDepth: number, toDepth: number) {
  const volume = node.querySelector<HTMLElement>("[data-flight-volume]");
  if (!volume || !Number.isFinite(fromDepth) || !Number.isFinite(toDepth) || fromDepth < 0 || toDepth < 0) return [];
  const timing: KeyframeAnimationOptions = { duration: 230, easing: "cubic-bezier(.18,.74,.28,1)", fill: "forwards" };
  const animations: Animation[] = [];
  volume.querySelectorAll<HTMLElement>("[data-flight-side]").forEach(side => {
    const property = side.dataset.flightSide === "top" || side.dataset.flightSide === "bottom" ? "height" : "width";
    animations.push(side.animate([
      { [property]: `${fromDepth}px` },
      { [property]: `${toDepth}px` },
    ], timing));
  });
  volume.querySelectorAll<HTMLElement>("[data-flight-base], [data-flight-contact]").forEach(surface => {
    const contact = surface.hasAttribute("data-flight-contact");
    const offset = contact ? .15 : 0;
    animations.push(surface.animate([
      { transform: `translateZ(-${fromDepth + offset}px)` },
      { transform: `translateZ(-${toDepth + offset}px)` },
    ], timing));
  });
  return animations;
}

export function DiscardFlightLayer({ flight, onFinish, kind = "discard", doraTiles = "" }: { doraTiles?: string; flight: FlightView; onFinish: (eventId: string) => void; kind?: "discard" | "nuki" | "call" }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    let movement: Animation | null = null;
    let flip: Animation | null = null;
    let paint: Animation | null = null;
    let depthAnimations: Animation[] = [];
    try {
      movement = node.animate([
        keyframe(flight.from),
        keyframe(flight.to),
      ], { duration: 230, easing: "cubic-bezier(.18,.74,.28,1)", fill: "forwards" });
      movement.onfinish = () => onFinish(flight.event.id);
      const sourceDepth = flight.from.depth ?? (flight.source === "opponent" ? flight.from.height * .4 : 0);
      const targetDepth = flight.to.depth ?? flight.to.height * .4;
      depthAnimations = animateVolumeDepth(node, sourceDepth, targetDepth);
      if (flight.source !== "opponent" && flight.sourcePaint && flight.targetPaint) {
        const face = node.querySelector<HTMLElement>(".mahjong-discard-flight__face");
        if (face) paint = face.animate([flight.sourcePaint, flight.targetPaint], {
          duration: 230, easing: "cubic-bezier(.18,.74,.28,1)", fill: "both",
        });
      }
      if (flight.source === "opponent") {
        const card = node.querySelector<HTMLElement>(".mahjong-discard-flight__card");
        const front = node.querySelector<HTMLElement>(".mahjong-discard-flight__front");
        const depth = targetDepth > 0 ? targetDepth : sourceDepth;
        if (front) depthAnimations.push(front.animate([
          { transform: `translateZ(-${sourceDepth}px) rotateY(180deg)` },
          { transform: `translateZ(-${depth}px) rotateY(180deg)` },
        ], { duration: 230, easing: "cubic-bezier(.18,.74,.28,1)", fill: "forwards" }));
        if (card) flip = card.animate([
          { transform: "translateZ(0px) rotateY(0deg)" },
          { transform: `translateZ(-${depth}px) rotateY(180deg)` },
        ], { duration: 230, easing: "ease-in-out", fill: "forwards" });
      }
    } catch {
      movement?.cancel();
      flip?.cancel();
      paint?.cancel();
      depthAnimations.forEach(animation => animation.cancel());
      onFinish(flight.event.id);
    }
    return () => {
      movement?.cancel();
      flip?.cancel();
      paint?.cancel();
      depthAnimations.forEach(animation => animation.cancel());
    };
  }, [flight, onFinish, kind]);

  const projected = Boolean(flight.from.quad && quadToMatrix3d(
    flight.from.width, flight.from.height, flight.from.quad, flight.from.left, flight.from.top, flight.from.normal,
  ));
  const targetDepth = flight.to.depth ?? flight.to.height * .4;
  const hasMeasuredNormal = (geometry: FlightGeometry) => Boolean(geometry.quad && geometry.normal && quadToMatrix3d(
    geometry.width, geometry.height, geometry.quad, geometry.left, geometry.top, geometry.normal,
  ));
  const measuredNormal = hasMeasuredNormal(flight.from) || hasMeasuredNormal(flight.to);
  const style = {
    left: `${flight.from.left}px`,
    top: `${flight.from.top}px`,
    width: `${flight.from.width}px`,
    height: `${flight.from.height}px`,
    transform: flightTransform(flight.from),
    transformOrigin: projected ? "0 0" : "center",
    "--flight-depth": `${targetDepth}px`,
  } as CSSProperties;
  return typeof document === "undefined" ? null : createPortal(
    <div
      ref={element}
      className="mahjong-discard-flight"
      data-testid={`mahjong-${kind}-flight`}
      data-dora-tiles={doraTiles}
      data-motion-seat={flight.event.seat}
      data-motion-source={flight.source}
      data-motion-event={flight.event.id}
      data-motion-source-tile-id={flight.sourceTileId}
      aria-hidden="true"
      style={style}
    >
      {flight.source === "opponent" ? (
        <span className="mahjong-discard-flight__stage" style={{ perspective: measuredNormal ? "none" : undefined }}>
          <span className="mahjong-discard-flight__card">
            <MahjongSolidFlightTile value={flight.event.tile}/>
          </span>
        </span>
      ) : (
        <span className="mahjong-discard-flight__card" style={{ transformStyle: "preserve-3d", WebkitTransformStyle: "preserve-3d" }}>
          <MahjongFaceUpFlightTile value={flight.event.tile}/>
        </span>
      )}
    </div>,
    document.body,
  );
}

function transform(geometry: FlightGeometry) {
  return `translate(-50%, -50%) rotate(${geometry.angle}deg) scale(${geometry.scale})`;
}

function flightTransform(geometry: FlightGeometry) {
  if (geometry.quad) {
    const matrix = quadToMatrix3d(geometry.width, geometry.height, geometry.quad, geometry.left, geometry.top, geometry.normal);
    if (matrix) return matrix;
  }
  return transform(geometry);
}

function keyframe(geometry: FlightGeometry): Keyframe {
  return {
    left: `${geometry.left}px`,
    top: `${geometry.top}px`,
    width: `${geometry.width}px`,
    height: `${geometry.height}px`,
    transform: flightTransform(geometry),
    transformOrigin: geometry.quad && quadToMatrix3d(geometry.width, geometry.height, geometry.quad, geometry.left, geometry.top, geometry.normal)
      ? "0 0"
      : "center",
  };
}
