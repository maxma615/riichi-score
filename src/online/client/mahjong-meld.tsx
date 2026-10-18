import { TileFace, tileName } from "./mahjong-tile";
import {parseMeld, type MeldKind, type MeldSource, type ParsedMeld} from "./mahjong-meld-model";
export {parseMeld} from "./mahjong-meld-model";
const sourceNames:Record<MeldSource,string>={"+":"下家","=":"对家","-":"上家"};

function kindName(kind: MeldKind) {
  return {
    chi: "吃",
    pon: "碰",
    daiminkan: "明杠",
    kakan: "加杠",
    ankan: "暗杠",
  }[kind];
}

function accessibleName(parsed: ParsedMeld) {
  if (parsed.kind === "ankan") {
    const face = parsed.slots.find(slot => slot.type === "tile");
    return `暗杠，${face?.type === "tile" ? tileName(face.value) : ""}`;
  }
  if (parsed.kind === "chi") return `吃，自${sourceNames[parsed.source!]}`;
  return `${kindName(parsed.kind)}，来自${sourceNames[parsed.source!]}`;
}

function MeldVolume({ value, back = false }: { value?: string; back?: boolean }) {
  return <span className="mahjong-meld__volume" data-meld-volume="true">
    <span className={`mahjong-meld__cap${back ? " mahjong-meld__cap--back" : ""}`} data-meld-surface="cap">
      {back ? <span className="mahjong-meld__back-cap"/> : <TileFace value={value!} className="mahjong-meld__face"/>}
    </span>
    <span className="mahjong-meld__contact" data-meld-surface="contact" aria-hidden="true"/>
    {(["top", "right", "bottom", "left"] as const).map(side =>
      <span className={`mahjong-meld__side mahjong-meld__side--${side}`} data-meld-side={side} key={side} aria-hidden="true"/>
    )}
  </span>;
}

function TileSlot({ value, sideways, called = false }: {
  value: string;
  sideways: boolean;
  called?: boolean;
}) {
  return <span
    className={`mahjong-meld__slot${sideways ? " is-sideways" : ""}`}
    data-called={called || undefined}
    data-tile-value={value}
  ><MeldVolume value={value}/></span>;
}

function KakanStack({ called, added }: { called: string; added: string }) {
  return <span className="mahjong-meld__stack">
    <span className="mahjong-meld__slot is-sideways" data-layer="added" data-tile-value={added}>
      <MeldVolume value={added}/>
    </span>
    <span className="mahjong-meld__slot is-sideways" data-layer="called" data-called="true" data-tile-value={called}>
      <MeldVolume value={called}/>
    </span>
  </span>;
}

export function MahjongMeld({ meld, seat, index }: { meld: string; seat?: number; index?: number }) {
  const parsed = parseMeld(meld);
  if (!parsed) return null;

  return <div
    className={`mahjong-meld mahjong-meld--public mahjong-meld--${parsed.kind}`}
    role="group"
    aria-label={accessibleName(parsed)}
    data-meld-seat={seat}
    data-meld-index={index}
    data-meld-value={seat === undefined ? undefined : meld}
    data-kind={parsed.kind}
    data-source={parsed.source}
  >
    <div className="mahjong-meld__tiles">
      {parsed.slots.map((slot, index) => slot.type === "back"
        ? <span className="mahjong-meld__back" aria-hidden="true" key={`back-${index}`}><MeldVolume back/></span>
        : slot.type === "stack"
          ? <KakanStack called={slot.called} added={slot.added} key={`stack-${index}`}/>
          : <TileSlot value={slot.value} sideways={slot.sideways} called={slot.called} key={`${slot.value}-${index}`}/>)
      }
    </div>
    <small>{kindName(parsed.kind)}</small>
  </div>;
}
