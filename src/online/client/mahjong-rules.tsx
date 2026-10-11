import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { GameVariant } from "../domain/types";

export function MahjongRules({ variant, onClose }: { variant: GameVariant; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sanma = variant === "sanma";
  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="mahjong-confirm mahjong-rules" aria-labelledby="mahjong-rules-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <button type="button" className="mahjong-icon-button mahjong-rules__close" aria-label="关闭规则" onClick={onClose}><X size={18}/></button>
    <p className="mahjong-kicker">RIICHI · {sanma ? "THREE" : "FOUR"} SEATS</p>
    <h2 id="mahjong-rules-title">{sanma ? "三人" : "四人"}麻将规则</h2>
    {sanma ? <ul>
      <li>东、南、西三席，108 张牌。移除二至八万；赤五筒、赤五索各一枚。一万与九万的宝牌互指。</li>
      <li>每家 35000 点。东风为东一至东三，半庄再打南一至南三；庄家和了或流局听牌连庄，破产结束，无延长战。最终按实际点数排名。</li>
      <li>禁止吃；可碰、杠、立直、自摸、荣和，适用振听。北可当普通字牌，也可在自己的摸牌阶段拔北补牌，每枚加一翻宝牌，不能独立成役，不破坏门清，不翻杠宝牌。</li>
      <li>立直后只可拔刚摸到的北；补牌须仍有余量。拔北打断一发和首巡役，补牌自摸计岭上开花。可抢北荣和，不另加抢杠役；过胡仍适用振听。</li>
      <li>暗杠立即翻开新宝牌指示牌。大明杠、加杠在随后弃牌或下一次杠时翻开；未翻开的指示牌不计宝牌或里宝牌。</li>
      <li>自摸损：子家满贯收庄家 4000、另一家 2000；庄家满贯两家各付 4000。荣和放铳者支付全额。每本场自摸两家各加 100，荣和加 200；立直每次 1000。</li>
      <li>荒牌罚符总额 3000：一人听牌收两家各 1500，两人听牌各收未听者 1500；全听或全未听不交换。</li>
      <li>双荣和按距放铳者顺序结算，立直棒归最近和牌者。九种九牌、多人合计四杠流局、流局满贯与责任支付适用三席规则；一人独自四杠继续。役满责任支付按完整点数结算，责任家自摸每本场共加 200、荣和加 200。终局剩余立直棒归首位。</li>
    </ul> : <ul>
      <li>东、南、西、北四席，136 张牌，每家 25000 点；赤五万、赤五筒、赤五索各一枚。</li>
      <li>可吃、碰、杠、立直、自摸及荣和，适用振听；北是普通字牌，没有拔北。</li>
      <li>东风打东场，半庄包含南场，可连庄；采用日本麻将役、符翻与四家点数结算，立直每次 1000。</li>
    </ul>}
    <p>电脑为基础陪打，自动准备。房主可在开局前添加或移除电脑；全部真人准备、座位坐满后开局。再开一场保留座位，真人重新准备。</p>
  </dialog>;
}
