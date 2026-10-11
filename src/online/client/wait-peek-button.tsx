"use client";

import {useEffect, type PointerEvent} from "react";

/** A momentary peek: releasing or interrupting input always closes the card. */
export function WaitPeekButton({held,onHold}:{held:boolean;onHold:(held:boolean)=>void}) {
  useEffect(() => {
    const stop = () => onHold(false);
    const events = ["blur","pagehide","resize","orientationchange","fullscreenchange","webkitfullscreenchange"];
    for (const event of events) window.addEventListener(event,stop);
    document.addEventListener("visibilitychange",stop);
    window.screen.orientation?.addEventListener?.("change",stop);
    return () => {
      for (const event of events) window.removeEventListener(event,stop);
      document.removeEventListener("visibilitychange",stop);
      window.screen.orientation?.removeEventListener?.("change",stop);
      stop();
    };
  },[onHold]);
  const stop = () => onHold(false);
  const start = (event:PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (event.pointerType !== "mouse") {
      event.preventDefault();
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Already interrupted by the browser. */ }
    }
    onHold(true);
  };
  return <button type="button" className="mahjong-screen-button mahjong-wait-peek" style={{touchAction:"none"}}
    aria-label="查看待牌" aria-pressed={held} title="按住查看待牌"
    onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onPointerLeave={stop}
    onPointerMove={event => {
      if (!held) return;
      const box=event.currentTarget.getBoundingClientRect();
      if (event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom) stop();
    }}
    onBlur={stop}
    onKeyDown={event => {
      if (event.key==="Escape") stop();
      if (event.key!==" " && event.key!=="Enter") return;
      event.preventDefault();
      if (!event.repeat) onHold(true);
    }}
    onKeyUp={event => {
      if (event.key!==" " && event.key!=="Enter") return;
      event.preventDefault();stop();
    }}>听牌</button>;
}
