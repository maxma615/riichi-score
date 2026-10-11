import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
mkdirSync('dist',{recursive:true});mkdirSync('public/online',{recursive:true});
const node={bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}};
await build({...node,entryPoints:['src/online/service.ts'],outfile:'dist/online-server.js'});
await build({...node,entryPoints:['src/online/domain/bot-worker.ts'],outfile:'dist/bot-worker.js'});
await build({entryPoints:['src/online/client/entry.tsx'],bundle:true,platform:'browser',target:'es2022',format:'esm',jsx:'automatic',minify:true,outfile:'public/online/client.js',external:['./assets/*'],loader:{'.woff2':'file','.webp':'file'}});
