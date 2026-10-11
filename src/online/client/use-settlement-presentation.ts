"use client";
import { useEffect, useRef, useState } from "react";
import type { Choice, Settlement, SettlementFlow } from "../domain/types";
import { AUTO_CONFIRM_MS, confirmationAt, displayedScores, presentationBoundaries } from "./settlement-presentation";

/** A server-relative age anchored to the monotonic device clock. Timers only
 * wake at reveal/score/confirmation boundaries; there is no permanent loop. */
export function useSettlementPresentation({ flow, settlement, ack, connected, busy, onChoice, leadInMs = 0 }: {
  flow?: SettlementFlow; settlement: Settlement | null; ack?: Choice; connected: boolean; busy: boolean; onChoice: (choice: Choice) => void;
  leadInMs?: number;
}) {
  const key = flow && settlement ? `${flow.id}:${flow.stage}:${flow.detailIndex}` : "";
  const readyAt = flow && settlement ? confirmationAt(flow, settlement) : 0;
  const [clock, setClock] = useState({ key, elapsed: flow?.elapsedMs ?? 0 });
  const anchor = useRef<{ key: string; elapsed: number; at: number } | null>(null);
  const [submitted, setSubmitted] = useState("");
  const pending = useRef({ key: "", waiting: false, sawBusy: false });
  const autoAttempt = useRef("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const rawElapsed = Math.max(0, clock.key === key ? Math.max(clock.elapsed, flow?.elapsedMs ?? 0) : flow?.elapsedMs ?? 0);
  const elapsed = Math.max(0, rawElapsed - leadInMs);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!flow || !settlement || !key) { anchor.current = null; return; }
    const time = performance.now(), previous = anchor.current;
    const age = previous?.key === key ? Math.max(flow.elapsedMs, previous.elapsed + time - previous.at) : flow.elapsedMs;
    anchor.current = { key, elapsed: age, at: time };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const boundaries = [...new Set([leadInMs,...presentationBoundaries(flow, settlement).map(boundary => boundary + leadInMs)])].sort((a,b)=>a-b);
    const update = () => {
      if (cancelled) return;
      const current = age + performance.now() - time;
      setClock({ key, elapsed: current });
      const next = boundaries.find(boundary => boundary > current);
      if (next !== undefined) timer = setTimeout(update, next - current);
    };
    update();
    return () => { cancelled = true; clearTimeout(timer); };
    // The phase and server-reported relative age are the synchronization inputs.
    // Recreated room/settlement objects must not restart the presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, flow?.elapsedMs, readyAt, connected, leadInMs]);

  useEffect(() => {
    if (pending.current.key !== key) {
      pending.current = { key, waiting: false, sawBusy: false };
      autoAttempt.current = ""; setSubmitted("");
    }
    if (pending.current.waiting && busy) pending.current.sawBusy = true;
    if (pending.current.waiting && pending.current.sawBusy && !busy) {
      pending.current.waiting = false; setSubmitted("");
    }
  }, [key, busy]);

  const submit = () => {
    if (!ack || !connected || busy || (key && elapsed < readyAt) || (pending.current.key === key && pending.current.waiting)) return;
    if (key) {
      pending.current = { key, waiting: true, sawBusy: false };
      autoAttempt.current = key; setSubmitted(key);
    }
    onChoice(ack);
  };
  useEffect(() => {
    if (!key || elapsed < readyAt + AUTO_CONFIRM_MS || !ack || !connected || busy || autoAttempt.current === key) return;
    submit();
  });

  return { elapsed, rawElapsed, reducedMotion, submit,
    canConfirm: !!ack && connected && !busy && elapsed >= readyAt && (!key || submitted !== key),
    countdown: Math.max(0, Math.ceil((readyAt + AUTO_CONFIRM_MS - elapsed) / 1000)),
    ready: elapsed >= readyAt,
    scores: flow ? displayedScores(flow, elapsed, reducedMotion) : [],
  };
}
