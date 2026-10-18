import type { Choice, GameView } from '../domain/types';
export type AutomaticPreferences = { win: boolean; noCalls: boolean; drawnDiscard: boolean; north: boolean };
export const automaticOff: AutomaticPreferences = { win:false, noCalls:false, drawnDiscard:false, north:false };

// Only select an option offered by the authoritative engine. A visible win
// keeps the response open even when the player elected not to make calls.
export function automaticChoice(game: GameView, options: AutomaticPreferences, lastDiscardValue?: string): Choice | null {
 if(game.settlement || game.ranking) return null;
 const choices=game.choices, win=choices.find(c=>c.type==='ron')??choices.find(c=>c.type==='tsumo');
 if(win) return options.win ? win : null;
 const pass=choices.find(c=>c.type==='pass');
 if(pass && choices.every(c=>c.type==='pass')) return pass;
 // Accepted riichi makes ordinary draws mandatory tsumogiri. Legal kan/nuki
 // remain deliberate choices, including when automatic north was selected.
 if((game.ownRiichi?.han??0)>0){
  if(!game.drawnTile || choices.some(c=>c.type!=='discard')) return null;
  return choices.find(c=>c.type==='discard' && c.value===game.drawnTile+'_')??null;
 }
 if(options.noCalls && pass && choices.some(c=>c.type==='chi'||c.type==='pon'||c.type==='kan') && !choices.some(c=>c.type==='discard')) return pass;
 const specials=choices.filter(c=>!['discard','nuki'].includes(c.type));
 if(specials.length) return null;
 const north=choices.find(c=>c.type==='nuki');
 if(north) return options.north ? north : null;
 if(!options.drawnDiscard || !game.drawnTile) return null;
 return choices.find(c=>c.type==='discard' && c.value===(lastDiscardValue??game.drawnTile+'_'))??null;
}

// Both clients leave time to see the drawn tile after its arrival animation.
export function automaticChoiceDelay(choice: Choice): number {
 return choice.type==='discard'?650:choice.type==='ron'||choice.type==='tsumo'?800:0;
}
