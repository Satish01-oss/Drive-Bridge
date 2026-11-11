import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'bundle');
const files=[['web/index.html','index.html'],['web/style.css','style.css'],['web/app.mjs','app.mjs'],['web/pcm-worklet.mjs','pcm-worklet.mjs'],['client/connection.mjs','client/connection.mjs'],['client/storage.mjs','client/storage.mjs'],['client/peer.mjs','client/peer.mjs'],['shared/signatures.mjs','shared/signatures.mjs'],['core/protocol.mjs','core/protocol.mjs']];
files.push(['client/native-media.mjs','client/native-media.mjs']);
files.push(['web/controller-display.mjs','controller-display.mjs']);
files.push(['web/fullscreen.css','fullscreen.css']);
files.push(['web/screen-gestures.mjs','screen-gestures.mjs']);
files.push(['client/tcp-control.mjs','client/tcp-control.mjs'],['core/tcp-frame.mjs','core/tcp-frame.mjs'],['client/video-quality.mjs','client/video-quality.mjs']);
files.push(['core/recovery.mjs','core/recovery.mjs']);
for(const [source,dest]of files){const text=fs.readFileSync(path.join(root,source),'utf8');fs.mkdirSync(path.dirname(path.join(output,dest)),{recursive:true});fs.writeFileSync(path.join(output,dest),text);}
console.log('Built remote/bundle: '+files.length+' self-contained client assets.');
