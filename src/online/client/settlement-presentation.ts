import type { Settlement, SettlementFlow } from "../domain/types";

export const SCORE_START_MS = 1200;
export const SCORE_STEP_MS = 30;
export const SCORE_STEPS = 33;
export const AUTO_CONFIRM_MS = 3000;
export const abortBaseAt = (settlement: Settlement) => settlement.drawInfo?.abortPresentation?.riichiSeat !== undefined || (!settlement.drawInfo?.abortPresentation && settlement.name === "四家立直") ? 1000 : 500;
export const drawRevealAt = (settlement: Settlement) => settlement.drawInfo?.kind === "abort" ? abortBaseAt(settlement) + (settlement.name === "三家和" ? 1500 : 0) : 1000;
export const drawSummaryAt = (settlement: Settlement) => settlement.drawInfo?.kind === "abort" ? abortBaseAt(settlement) + (settlement.name === "三家和" ? 2500 : settlement.name === "四家立直" ? 1000 : 500) : 2000;
export const NAGASHI_YAKU_MS = 600;
export const NAGASHI_TITLE_MS = 2500;
export const detailValueAt = (settlement: Settlement) => settlement.drawInfo?.kind === "nagashi" ? 1800 : 300 + Math.min(15, settlement.yaku.length) * 180;
export function confirmationAt(flow: SettlementFlow, settlement: Settlement) {
  return flow.stage === "draw" ? drawSummaryAt(settlement) + 1000 : flow.stage === "detail" ? settlement.drawInfo?.kind === "nagashi" ? 2800 : detailValueAt(settlement) + 600 : flow.delta.some(delta => delta !== 0) ? 4500 : 1200;
}
export function displayedScores(flow: SettlementFlow, elapsed: number, reducedMotion: boolean) {
  if (reducedMotion) return flow.newScores;
  const steps = elapsed < SCORE_START_MS ? 0 : Math.min(SCORE_STEPS, 1 + Math.floor((elapsed - SCORE_START_MS) / SCORE_STEP_MS));
  return flow.oldScores.map((score, seat) => steps === SCORE_STEPS ? flow.newScores[seat] : score + Math.trunc(flow.delta[seat] * steps / SCORE_STEPS));
}
export function presentationBoundaries(flow: SettlementFlow, settlement: Settlement) {
  const ready = confirmationAt(flow, settlement);
  const reveal = flow.stage === "draw" ? [drawRevealAt(settlement),drawRevealAt(settlement)+300,drawSummaryAt(settlement)] : flow.stage === "detail"
    ? Array.from({ length: Math.min(15, settlement.yaku.length) + 1 }, (_, i) => 300 + i * 180)
    : Array.from({ length: SCORE_STEPS }, (_, i) => SCORE_START_MS + i * SCORE_STEP_MS);
  const abort = flow.stage === "draw" && settlement.drawInfo?.kind === "abort";
  const declarations = abort ? [...(settlement.drawInfo?.abortPresentation?.riichiSeat !== undefined ? [300,500,1000] : []), ...(settlement.name === "三家和" ? [abortBaseAt(settlement)+300,abortBaseAt(settlement)+500,abortBaseAt(settlement)+1200] : []), drawSummaryAt(settlement)+500] : [];
  return [...new Set([...reveal, ...declarations, ...(flow.stage === "detail" ? [detailValueAt(settlement), ...(settlement.drawInfo?.kind === "nagashi" ? [NAGASHI_YAKU_MS,NAGASHI_TITLE_MS] : [])] : []), ready, ready + 1000, ready + 2000, ready + AUTO_CONFIRM_MS])].sort((a, b) => a - b);
}
