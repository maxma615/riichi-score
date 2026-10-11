import type {Choice,GameView} from '../domain/types';
export type BlankTableAction={kind:'choice';choice:Choice}|{kind:'return-riichi'|'return-picker'};
/** The gesture selects only a current native operation; it never constructs one. */
export function blankTableAction(game:GameView,ownSeat:number,riichi:boolean,picker:boolean,lastDiscardValue?:string):BlankTableAction|null{
 if(game.settlement)return null;
 const discards=game.choices.filter(c=>c.type==='discard');
 if(game.turnSeat!==ownSeat){
  const pass=game.choices.find(c=>c.type==='pass');
  return pass?{kind:'choice',choice:pass}:null;
 }
 if(picker)return {kind:'return-picker'};
 if(riichi)return {kind:'return-riichi'};
 // A displayed opening last tile may differ from the true logical draw.
 // Match the exact offered value, including its existing draw flag.
 const value=lastDiscardValue??(game.drawnTile?game.drawnTile+'_':game.hand.at(-1));
 const choice=discards.find(c=>c.value===value);
 return choice?{kind:'choice',choice}:null;
}
