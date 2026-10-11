import {asset} from "./api-client";
import type { ButtonHTMLAttributes } from "react";
import type {GameVariant} from "../domain/types";

const honorNames: Record<string, string> = {
  z1: "东风",
  z2: "南风",
  z3: "西风",
  z4: "北风",
  z5: "白板",
  z6: "发财",
  z7: "红中",
};
const numberNames = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const suitNames: Record<string, string> = { m: "萬", p: "筒", s: "索" };

const stockSuitNames: Record<string, string> = { m: "Man", p: "Pin", s: "Sou" };
const stockHonorNames: Record<string, string> = {
  z1: "Ton", z2: "Nan", z3: "Shaa", z4: "Pei", z5: "Haku", z6: "Hatsu", z7: "Chun",
};

/** Original upstream files, pinned and locally hosted; never drawn in the app. */
function TileArtwork({ tile }: { tile: string }) {
  const suit = stockSuitNames[tile[0]];
  const number = Number(tile[1]);
  const file = stockHonorNames[tile]
    ?? (suit && Number.isInteger(number) && number >= 0 && number <= 9
      ? `${suit}${number === 0 ? "5-Dora" : number}` : "Blank");
  return <img className="mahjong-tile__art" src={asset(`/online/assets/tiles/regular/${file}.svg`)}
    alt="" aria-hidden="true" draggable={false} width={300} height={400} decoding="async"/>;
}

export function tileKey(value: string) {
  return value.trim().slice(0, 2).toLowerCase();
}

/** Visible red fives and ordinary fives belong to the same tile family. */
export function tileMatchKey(value: string | null | undefined): string | null {
  const tile = value?.trim().toLowerCase();
  if (!tile || !/^(?:[mps][0-9]|z[1-7])[_*+\-=]*$/.test(tile)) return null;
  const key = tile.slice(0, 2);
  return key[1] === "0" ? `${key[0]}5` : key;
}

/** Only exposed indicators contribute; hidden ura never enters table visuals. */
export function indicatorBonus(value: string, variant: GameVariant) {
  const key = tileKey(value), suit = key[0], rank = Number(key[1] === "0" ? 5 : key[1]);
  if (suit === "m" && variant === "sanma") return rank === 1 ? "m9" : "m1";
  if (suit === "z") return `z${rank <= 4 ? rank % 4 + 1 : (rank - 4) % 3 + 5}`;
  return `${suit}${rank % 9 + 1}`;
}

export function visibleDoraFamilies(indicators: readonly string[], variant: GameVariant): string[] {
  return [...new Set(indicators.filter(tile => tileMatchKey(tile) !== null
    && (variant !== "sanma" || !/^m[02-8]/.test(tileKey(tile)))).map(tile => indicatorBonus(tile, variant)))];
}

export function tileName(value: string) {
  const key = tileKey(value);
  if (honorNames[key]) return honorNames[key];
  const suit = key[0];
  const number = Number(key[1] === "0" ? "5" : key[1]);
  return `${numberNames[number] || "?"}${suitNames[suit] || "牌"}${key[1] === "0" ? "（赤）" : ""}`;
}

export function TileFace({
  value,
  className = "",
  ...props
}: { value: string; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const key = tileKey(value);
  const honor = key[0] === "z";
  const red = key[1] === "0";
  const baseClass = `mahjong-tile${honor ? " is-honor" : ""}${red ? " is-red" : ""}${className ? ` ${className}` : ""}`;

  if (props.type === "button" || props.onClick) {
    return <button {...props} className={baseClass} type={props.type || "button"} aria-label={props["aria-label"] || tileName(value)} data-tile-face={key}>
      <TileArtwork tile={key}/>
    </button>;
  }
  return <span className={baseClass} role="img" aria-label={tileName(value)} data-tile-face={key}>
    <TileArtwork tile={key}/>
  </span>;
}
