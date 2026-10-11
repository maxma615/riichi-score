import type { Choice } from "../domain/types";
import { MahjongMeld } from "./mahjong-meld";

/** Presentation only: the parent button retains the exact legal Choice ID. */
export function MahjongCallOption({ choice }: { choice: Choice }) {
  if (!choice.value || !["chi", "pon", "kan"].includes(choice.type)) return null;
  return <span className="mahjong-call-preview" aria-hidden="true" data-preview-choice-id={choice.id}>
    <MahjongMeld meld={choice.value}/>
  </span>;
}
