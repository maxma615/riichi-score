import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GameRoom } from "../src/online/client/mahjong-client";
import "../src/online/client/table.css";
import "../src/online/client/mahjong-river.css";
import "../src/online/client/mahjong-meld.css";
import "../src/online/client/mahjong-interaction.css";
import "../src/online/client/mahjong-discard-motion.css";
import "../src/online/client/mahjong-table-center.css";
import "../src/online/client/mahjong-table-edge.css";
import "../src/online/client/mahjong-camera.css";
import "../src/online/client/mahjong-call-announcement.css";
import "../src/online/client/mahjong-standing-tile.css";
import "../src/online/client/mahjong-abort-announcements.css";
import "../src/online/client/mahjong-calligraphy.css";
import "../src/online/client/mahjong-action-placement.css";
import "../src/online/client/mahjong-yakuman-opportunity.css";
import "../src/online/client/mahjong-tile-match.css";
import "../src/online/client/mahjong-dora-sheen.css";
import "../src/online/client/mahjong-tablecloth.css";
import "../src/online/client/mahjong-round-opening.css";
import "../src/online/client/mahjong-table-screen.css";
import "../src/online/client/theme.css";
const query = location.search;
function Harness() {
  const [room, setRoom] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function state() {
    const r = await fetch("/fixture/state" + query);
    if (!r.ok) throw Error(await r.text());
    setRoom(await r.json());
  }
  useEffect(() => {
    state().catch((e) => setError(e.message));
  }, []);
  async function choose(choice: any) {
    setBusy(true);
    try {
      const r = await fetch("/fixture/choose" + query, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: choice.id,
          decisionId: room.game.decisionId,
        }),
      });
      if (!r.ok) throw Error(await r.text());
      setRoom(await r.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mahjong-page">
      <div className="mahjong-shell">
        {error ? <output role="alert">{error}</output> : null}
        {room ? (
          <GameRoom
            room={room}
            busy={busy}
            host={room.mySeat === 0}
            ownSeat={room.mySeat}
            connected={true}
            onChoice={choose}
            onFinish={() => {}}
            onRematch={() => {}}
            onLeave={() => {}}
          />
        ) : null}
      </div>
    </main>
  );
}
createRoot(document.getElementById("online-root")!).render(<Harness />);
