export type GameVariant = "sanma" | "yonma";
export type GameMode = "east" | "hanchan";
export type ChoiceType = "discard" | "riichi" | "chi" | "pon" | "kan" | "tsumo" | "ron" | "abort" | "nuki" | "pass" | "ack";
export type Choice = { id: string; type: ChoiceType; value?: string };
export type PublicPlayer = { seat: number; wind: number; score: number; handCount: number; hasDrawnTile?: boolean; discards: string[]; melds: string[]; riichi: boolean; nuki?: number };
export type DrawInfo = { abortPresentation?: { riichiSeat?: number; ronSeats: number[] }; kind: "exhaustive" | "abort" | "nagashi"; revealedHands: { seat: number; hand: string; waits: string[] }[]; nagashiResults: { seat: number; points: number; delta: number[] }[] };
export type Settlement = { kind: "win" | "draw"; name: string; winnerSeat?: number; hand?: string; winMethod?: "tsumo" | "ron"; winningTile?: string; yaku: { name: string; han: number | string }[]; fu?: number; han?: number; points?: number; delta: number[]; uraIndicators: string[]; tenpaiSeats?: number[]; drawInfo?: DrawInfo };
export type PublicWinDeclaration = { seat: number; winMethod: "tsumo" | "ron" };
export type SettlementFlow = { id: string; stage: "draw" | "detail" | "scores"; detailIndex: number; detailCount: number; elapsedMs: number; oldScores: number[]; delta: number[]; newScores: number[]; winDeclarations?: PublicWinDeclaration[] };
export type GameView = { gameInstanceId?: string; handId?: number; decisionId: string; phase: string; roundWind: number; roundNumber: number; honba: number; riichiSticks: number; remainingTiles: number; doraIndicators: string[]; turnSeat: number; ronBlocked?: boolean; ownRiichi?: { han: 0 | 1 | 2; declarationHan: 0 | 1 | 2 }; hand: string[]; initialDeal?: string[]; drawnTile: string | null; players: PublicPlayer[]; choices: Choice[]; settlement: Settlement | null; settlementFlow?: SettlementFlow; rankingFlow?: { id: string; elapsedMs: number }; ranking: { seat: number; rank: number; score: number }[] | null };
export interface MahjongGame { view(seat: number): GameView; respond(seat: number, decisionId: string, choiceId: string): void; }
export type PlayerIdentity = { userId: string; displayName: string };
export type RoomMember = PlayerIdentity & { kind: "human" | "bot"; seat: number; ready: boolean; connected: boolean };
export type RoomView = { id: string; code: string; hostUserId: string; variant: GameVariant; mode: GameMode; status: "lobby" | "playing" | "finished"; version: number; mySeat: number; members: RoomMember[]; game: GameView | null };
export type MahjongResponse = { room: RoomView | null; serviceRunning: boolean };
export type MahjongCommand = { nonce: string } & (
  | { action: "create"; mode: GameMode; variant?: GameVariant }
  | { action: "add-bot" | "remove-bot"; seat: number; roomId: string }
  | { action: "fill-bots"; roomId: string }
  | { action: "join"; code: string }
  | { action: "ready"; ready: boolean; roomId: string }
  | { action: "start" | "leave" | "finish" | "rematch"; roomId: string }
  | { action: "respond"; decisionId: string; choiceId: string; roomId: string }
);
