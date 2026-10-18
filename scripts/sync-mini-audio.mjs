// Export the same original synthesized settlement cues used by the web client.
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
mkdirSync('.local/generated-audio',{recursive:true});
const compiled=path.resolve('.local/generated-audio/table-audio.cjs');
await build({entryPoints:['src/online/client/table-audio.ts'],bundle:true,platform:'node',format:'cjs',outfile:compiled});
const {makeTileSoundBuffer}=createRequire(import.meta.url)(compiled);
const rate=22050;
const context={sampleRate:rate,createBuffer(channels,length,sampleRate){const data=new Float32Array(length);return {sampleRate,length,getChannelData(){return data}}}};
mkdirSync('miniprogram/assets/audio',{recursive:true});
for(const kind of ['yaku','hand-value','score-roll']) {
 const buffer=makeTileSoundBuffer(context,kind),samples=buffer.getChannelData(0),wav=Buffer.alloc(44+samples.length*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples.length*2,40);
 for(let i=0;i<samples.length;i++)wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),44+i*2);
 writeFileSync(`miniprogram/assets/audio/${kind}.wav`,wav);
 console.log(`${kind}: ${samples.length} samples / ${wav.length} bytes`);
}
