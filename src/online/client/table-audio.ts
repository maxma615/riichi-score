import type {TableSoundEvent} from './table-sounds';
import type {MahjongVoiceKind,VoiceBufferLoader} from './voice-samples';

type SoundKind=TableSoundEvent['kind'];
type SynthSoundKind=Exclude<SoundKind,'chi'|'pon'|'kan'|'north'>;
const durations:Record<SynthSoundKind,number>={draw:.1,discard:.14,nuki:.13,call:.19,riichi:.28,ron:.34,tsumo:.38,yaku:.09,'hand-value':.24,'score-roll':.99,'rank-first':.26,'rank-row':.12};

/** Original short resin/cloth transients, generated locally without samples. */
export function makeTileSoundBuffer(context:BaseAudioContext,kind:SynthSoundKind):AudioBuffer{
 const buffer=context.createBuffer(1,Math.ceil(context.sampleRate*durations[kind]),context.sampleRate);
 if(kind==='rank-first'||kind==='rank-row'){
  const samples=buffer.getChannelData(0),notes=kind==='rank-first'?[880,1108.73,1318.51]:[659.25];
  for(let i=0;i<samples.length;i++){
   const t=i/context.sampleRate;let value=0;
   for(let n=0;n<notes.length;n++){
    const age=t-n*.025;if(age<0)continue;
    value+=Math.min(1,age/.003)*Math.exp(-age/.038)*(.2*Math.sin(2*Math.PI*notes[n]*age)+.035*Math.sin(4*Math.PI*notes[n]*age));
   }
   samples[i]=value*Math.min(1,(samples.length-i)/context.sampleRate/.008);
  }
  return buffer;
 }
 if(kind==='yaku'||kind==='hand-value'||kind==='score-roll'){
  const samples=buffer.getChannelData(0);
  for(let i=0;i<samples.length;i++){
   const t=i/context.sampleRate,age=kind==='score-roll'?t%.03:t;
   const frequency=kind==='yaku'?1174.66:kind==='hand-value'?783.99:920;
   const decay=kind==='score-roll'?.008:kind==='yaku'?.022:.07;
   const envelope=Math.min(1,age/.002)*Math.exp(-age/decay);
   samples[i]=envelope*(.18*Math.sin(2*Math.PI*frequency*age)+.04*Math.sin(2*Math.PI*frequency*2*age))*Math.min(1,(samples.length-i)/context.sampleRate/.008);
  }
  return buffer;
 }
 if(kind==='riichi'||kind==='ron'||kind==='tsumo'){
  // Original resonant declaration motifs. These are cues, not character voice.
  const samples=buffer.getChannelData(0),notes=kind==='riichi'?[660,990]:kind==='ron'?[440,660,880]:[523.25,783.99,1046.5];
  for(let i=0;i<samples.length;i++){
   const t=i/context.sampleRate;let value=0;
   for(let note=0;note<notes.length;note++){
    const age=t-note*.045;if(age<0)continue;
    const envelope=Math.min(1,age/.004)*Math.exp(-age/.05);
    value+=envelope*(.24*Math.sin(2*Math.PI*notes[note]*age)+.06*Math.sin(2*Math.PI*notes[note]*2*age));
   }
   samples[i]=value*Math.min(1,(samples.length-i)/context.sampleRate/.012);
  }
  return buffer;
 }
 const samples=buffer.getChannelData(0),strikes=kind==='call'?[0,.027,.054]:[0];
 let random=0x6d2b79f5,filtered=0;
 for(let i=0;i<samples.length;i++){
  random^=random<<13;random^=random>>>17;random^=random<<5;
  const noise=(random>>>0)/0xffffffff*2-1;
  filtered+=.3*(noise-filtered);
  const t=i/context.sampleRate;
  let value=0;
  for(const start of strikes){
   const age=t-start;if(age<0)continue;
   const attack=Math.min(1,age/.0015),decay=Math.exp(-age/(kind==='draw'?.014:.022));
   const body=.2*Math.sin(age*2*Math.PI*710)+.1*Math.sin(age*2*Math.PI*1430);
   value+=attack*decay*(body+filtered*(kind==='draw'?.6:.38));
  }
  // Leave a smooth final 8ms tail and ample headroom for overlapping tiles.
  const tail=Math.min(1,(samples.length-i)/context.sampleRate/.008);
  samples[i]=Math.max(-.75,Math.min(.75,value*tail));
 }
 return buffer;
}

/** A locked or paused cue is consumed, never queued for later permission. */
export class TableAudioPlayer{
 private context:AudioContext|null=null;
 private master:GainNode|null=null;
 private ready=false;
 private enabled=true;
 private disposed=false;
 private generation=0;
 private suspension:Promise<void>=Promise.resolve();
 private seen=new Set<string>();
 private buffers=new Map<SoundKind,AudioBuffer>();
 private active=new Set<AudioBufferSourceNode>();
 private voiceBuffers=new Map<MahjongVoiceKind,AudioBuffer>();
 private loadingVoices:Promise<void>|null=null;
 private voiceAbort=new AbortController();
 constructor(private create:()=>AudioContext,private loadVoices?:VoiceBufferLoader){}
 private preloadVoices(){
  const context=this.context;
  if(!context||!this.loadVoices||this.loadingVoices||this.disposed)return;
  this.loadingVoices=Promise.resolve().then(()=>this.loadVoices!(context,this.voiceAbort.signal)).then(buffers=>{
   if(this.disposed||this.context!==context)return;
   for(const kind of ['riichi','ron','tsumo','chi','pon','kan','north'] as const){
    const buffer=buffers[kind];
    if(buffer&&Number.isFinite(buffer.duration)&&buffer.duration>=.1&&buffer.duration<=1.5)this.voiceBuffers.set(kind,buffer);
   }
  }).catch(()=>{this.loadingVoices=null;});
 }

 async unlock():Promise<boolean>{
  if(this.disposed||!this.enabled)return false;
  const generation=this.generation;
  try{
   if(!this.context){
    this.context=this.create();this.master=this.context.createGain();
    this.master.gain.value=.32;this.master.connect(this.context.destination);
   }
   const context=this.context;
   await context.resume();
   if(this.disposed||!this.enabled||generation!==this.generation)return false;
   this.ready=context.state==='running';if(this.ready)this.preloadVoices();return this.ready;
  }catch{return false;}
 }
 play(cue:TableSoundEvent,offsetSeconds=0):boolean{
  if(this.seen.has(cue.id))return false;
  this.seen.add(cue.id);
  while(this.seen.size>512)this.seen.delete(this.seen.values().next().value!);
  const context=this.context;
  if(this.disposed||!this.enabled||!this.ready||!context||context.state!=='running'||!this.master)return false;
  try{
   const voice=this.voiceBuffers.get(cue.kind as MahjongVoiceKind);
   // Unloaded action voices are consumed silently; their existing tile impacts
   // still play at landing. Never queue a declaration behind a download.
   if(!voice&&['chi','pon','kan','north'].includes(cue.kind))return false;
   let buffer=voice??this.buffers.get(cue.kind);
   if(!buffer){buffer=makeTileSoundBuffer(context,cue.kind as SynthSoundKind);this.buffers.set(cue.kind,buffer);}

   // Resume a late score-roll callback at its current visual position. Do not
   // restart the full roll after the visible count has almost finished.
   if(!Number.isFinite(offsetSeconds)||offsetSeconds<0||offsetSeconds>=(voice?voice.duration:durations[cue.kind as SynthSoundKind]))return false;
   if(this.active.size>=8)this.release(this.active.values().next().value!,true);
   const source=context.createBufferSource();source.buffer=buffer;source.connect(this.master);
   this.active.add(source);source.onended=()=>this.release(source,false);
   try{if(offsetSeconds>0)source.start(0,offsetSeconds);else source.start();return true;}catch{this.release(source,true);return false;}
  }catch{return false;}
 }
 setEnabled(enabled:boolean){
  if(this.enabled===enabled)return;
  this.enabled=enabled;this.pause();
 }
 cancel(){
  this.generation++;
  for(const source of [...this.active])this.release(source,true);
 }
 pause(){
  this.cancel();this.ready=false;
  if(this.context&&this.context.state!=='closed')this.suspension=this.context.suspend().catch(()=>{});
 }
 async dispose(){
  if(this.disposed)return;
  this.disposed=true;this.cancel();this.ready=false;this.master?.disconnect();this.buffers.clear();this.voiceAbort.abort();this.voiceBuffers.clear();
  // WebKit may commit a pending suspension after close and resurrect its state.
  // Finish the existing suspension before closing the context permanently.
  await this.suspension;
  if(this.context)await this.context.close().catch(()=>{});
 }
 private release(source:AudioBufferSourceNode,stop:boolean){
  if(!this.active.delete(source))return;
  source.onended=null;
  if(stop)try{source.stop();}catch{/* A source may already have finished. */}
  source.disconnect();
 }
}
