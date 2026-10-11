import { TileFace } from "./mahjong-tile";

const sideFaces = ["top", "left", "right", "bottom"] as const;

/** The concealed back and public discard face joined by four real side planes. */
export function MahjongSolidFlightTile({ value }: { value: string }) {
  return (
    <span className="mahjong-discard-flight__solid" data-flight-volume="true" aria-hidden="true">
      <span className="mahjong-discard-flight__back" data-flight-face="back" aria-hidden="true" />
      <span className="mahjong-discard-flight__front" data-flight-face="front" aria-hidden="true">
        <TileFace value={value} className={`mahjong-discard-flight__face${value.includes("_") ? " is-tsumogiri" : ""}${value.includes("*") ? " is-riichi" : ""}`} />
      </span>
      {sideFaces.map(face => (
        <span
          key={face}
          className={`mahjong-discard-flight__side mahjong-discard-flight__side--${face}`}
          data-flight-face={face}
          data-flight-side={face}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/** Face-up body used while a hand discard or called river tile travels. Its
 * cap stays on the measured plane while its real walls grow to target depth. */
export function MahjongFaceUpFlightTile({ value }: { value: string }) {
  return <span className="mahjong-discard-flight__face-up" data-flight-volume="true" aria-hidden="true">
    <span className="mahjong-discard-flight__face-up-base" data-flight-base="true" data-flight-face="base" aria-hidden="true"/>
    <span className="mahjong-discard-flight__face-up-cap" data-flight-face="front">
      <TileFace value={value} className={`mahjong-discard-flight__face${value.includes("_") ? " is-tsumogiri" : ""}${value.includes("*") ? " is-riichi" : ""}`}/>
    </span>
    <span className="mahjong-discard-flight__face-up-contact" data-flight-contact="true" aria-hidden="true"/>
    {sideFaces.map(face => <span
      key={face}
      className={`mahjong-discard-flight__face-up-side mahjong-discard-flight__face-up-side--${face}`}
      data-flight-face={face} data-flight-side={face} aria-hidden="true"
    />)}
  </span>;
}
