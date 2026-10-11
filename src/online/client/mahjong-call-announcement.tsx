import type { RoomMember } from "../domain/types";
import type { TableFeedback } from "./use-table-feedback";

const announcementKinds = new Set<TableFeedback["kind"]>(["call", "riichi", "nuki", "win"]);

export function MahjongCallAnnouncement({ feedback, members, ownSeat }: {
  feedback: TableFeedback | null;
  members: RoomMember[];
  ownSeat: number;
}) {
  if (!feedback?.actionLabel || !announcementKinds.has(feedback.kind)) return null;

  const actor = feedback.seat === undefined
    ? "牌桌"
    : feedback.seat === ownSeat
      ? "你"
      : members.find(member => member.seat === feedback.seat)?.displayName || "牌友";
  const avatar = feedback.seat === undefined ? undefined : ((feedback.seat % 4) + 4) % 4;

  return <div
    className={`mahjong-table-feedback is-${feedback.kind} mahjong-call-announcement`}
    role="status"
    aria-label="牌桌动作"
    data-feedback-seat={feedback.seat}
    data-feedback-decision={feedback.key}
    data-action-voice-kind={feedback.actionLabel === "吃" ? "chi" : feedback.actionLabel === "碰" ? "pon" : feedback.actionLabel === "杠" ? "kan" : feedback.actionLabel === "拔北" ? "north" : undefined}
  >
    {avatar !== undefined ? <span className="mahjong-call-announcement__portrait" aria-hidden="true" data-avatar={avatar}/> : null}
    <strong className="mahjong-call-announcement__label" aria-hidden="true">{feedback.actionLabel}</strong>
    <small className="mahjong-call-announcement__actor" aria-hidden="true">{actor}</small>
    <span className="mahjong-call-announcement__accessible">{feedback.text}</span>
  </div>;
}
