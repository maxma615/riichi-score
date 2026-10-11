import {asset} from "./api-client";
export type DeclarationVoiceKind = 'riichi' | 'ron' | 'tsumo';
export type ActionVoiceKind = 'chi' | 'pon' | 'kan' | 'north';
export type MahjongVoiceKind = DeclarationVoiceKind | ActionVoiceKind;
export type VoiceBuffers = Partial<Record<MahjongVoiceKind, AudioBuffer>>;
export type VoiceBufferLoader = (context: AudioContext, signal: AbortSignal) => Promise<VoiceBuffers>;

export const mahjongVoicePaths: Record<MahjongVoiceKind, string> = {
 riichi: asset('/online/assets/audio/voices/riichi.wav'),
 ron: asset('/online/assets/audio/voices/ron.wav'),
 tsumo: asset('/online/assets/audio/voices/tsumo.wav'),
 chi: asset('/online/assets/audio/voices/chi.wav'),
 pon: asset('/online/assets/audio/voices/pon.wav'),
 kan: asset('/online/assets/audio/voices/kan.wav'),
 north: asset('/online/assets/audio/voices/north.wav'),
};

// Fixed, locally hosted clips. The browser decodes these once; no inference,
// microphone permission, or remote speech service is used during a game.
export const loadMahjongVoices: VoiceBufferLoader = async (context, signal) => {
 const request = new AbortController();
 const cancel = () => request.abort();
 signal.addEventListener('abort', cancel, {once: true});
 if (signal.aborted) cancel();
 const timeout = setTimeout(cancel, 10_000);
 let rejectAborted!: () => void;
 const aborted = new Promise<never>((_, reject) => {
  rejectAborted = () => reject(Error('Declaration voice load cancelled'));
  request.signal.addEventListener('abort', rejectAborted, {once: true});
  if (request.signal.aborted) rejectAborted();
 });
 try {
 const entries = await Promise.race([aborted, Promise.all(Object.entries(mahjongVoicePaths).map(async ([kind, path]) => {
  if (request.signal.aborted) throw Error('Declaration voice load cancelled');
  const response = await fetch(path, {signal: request.signal, cache: 'force-cache'});
  if (!response.ok) throw Error('Declaration voice unavailable');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 44 || bytes.byteLength > 128_000) throw Error('Invalid declaration voice size');
  const buffer = await context.decodeAudioData(bytes);
  if (!Number.isFinite(buffer.duration) || buffer.duration < .1 || buffer.duration > 1.5 || buffer.numberOfChannels !== 1) throw Error('Invalid declaration voice duration');
  return [kind, buffer] as const;
 }))]);
 return Object.fromEntries(entries);
 } finally {
  clearTimeout(timeout);
  signal.removeEventListener('abort', cancel);
  request.signal.removeEventListener('abort', rejectAborted);
  request.abort();
 }
};
