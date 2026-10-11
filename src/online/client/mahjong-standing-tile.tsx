const standingFaces = ["back", "front", "top", "left", "right", "bottom"] as const;

/** A concealed opponent tile with public geometry and no concealed tile identity. */
export function MahjongStandingTile({ drawn = false, dealVisible=true, dealWave }: { drawn?: boolean;dealVisible?:boolean;dealWave?:number }) {
  return (
    <i
      className={`mahjong-standing-tile${drawn ? " is-drawn" : ""}`}
      data-motion-drawn={drawn ? "true" : undefined}
      data-deal-visible={dealVisible?undefined:"false"} data-deal-wave={dealWave}
    >
      <span className="mahjong-standing-tile__body" data-standing-body="true">
        {standingFaces.map(face => (
          <span
            key={face}
            className={`mahjong-standing-tile__face mahjong-standing-tile__face--${face}`}
            data-standing-face={face}
            data-motion-surface={face === "back" ? "true" : undefined}
            aria-hidden="true"
          />
        ))}
      </span>
    </i>
  );
}
