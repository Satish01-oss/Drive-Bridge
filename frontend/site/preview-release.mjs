const repository='Satish01-oss/Drive-Bridge';
export function previewRelease(value){
 if(!value||!/^\d+\.\d+\.\d+$/.test(value.version)||!Number.isSafeInteger(value.preview)||value.preview<1||value.preview>9999||value.tag!==`v${value.version}-preview.${value.preview}`||value.url!==`https://github.com/${repository}/releases/tag/${value.tag}`||!/^[a-f0-9]{40}$/.test(value.source))throw Error('Invalid preview identity');
 for(const platform of ['windows','android']){
  const asset=value[platform],filename=platform==='windows'?`DeviceBridge-Setup-${value.version}.exe`:`DeviceBridge-Android-${value.version}-preview.apk`;
  if(!asset||asset.filename!==filename||asset.url!==`https://github.com/${repository}/releases/download/${value.tag}/${filename}`||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>(platform==='windows'?512:100)*1024*1024||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid preview asset: '+platform);
 }
 if(value.android.versionName!==value.tag.slice(1)||!Number.isSafeInteger(value.android.versionCode)||value.android.versionCode<1)throw Error('Mismatched Android version');
 return {value,label:`${value.version} · Preview ${value.preview}`,size:platform=>(value[platform].bytes/1024/1024).toFixed(platform==='windows'?0:1)+' MiB'};
}
export function renderPreview(html,value){
 const release=previewRelease(value);
 html=html.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bdata-preview-version(?=\s|>)[^>]*>)[\s\S]*?(<\/\2>)/gi,(_,a,tag,b)=>a+release.label+b);
 html=html.replace(/<a\b[^>]*\bdata-preview-notes(?=\s|>)[^>]*>/g,tag=>tag.replace(/href="[^"]*"/,`href="${value.url}"`));
 for(const platform of ['windows','android']){
  html=html.replace(new RegExp(`<a\\b[^>]*data-preview-download="${platform}"[^>]*>`,'g'),tag=>tag.replace(/href="[^"]*"/,`href="${value[platform].url}"`));
  for(const [field,text]of [['size',release.size(platform)],['filename',value[platform].filename]])html=html.replace(new RegExp(`(<([a-z][a-z0-9]*)\\b[^>]*data-preview-${field}="${platform}"[^>]*>)[\\s\\S]*?(<\\/\\2>)`,'gi'),(_,a,tag,b)=>a+text+b);
 }
 return html;
}
if(typeof document!=='undefined'&&document.body?.dataset.primaryDownload==='remote-preview'){
 fetch(new URL('remote-preview.json',location.href),{cache:'no-cache',signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error('Preview metadata unavailable');return r.json();}).then(value=>{
  const release=previewRelease(value);
  document.querySelectorAll('[data-preview-version]').forEach(el=>el.textContent=release.label);
  document.querySelectorAll('[data-preview-notes]').forEach(el=>el.href=value.url);
  for(const platform of ['windows','android']){
   document.querySelectorAll(`[data-preview-download="${platform}"]`).forEach(el=>el.href=value[platform].url);
   document.querySelectorAll(`[data-preview-size="${platform}"]`).forEach(el=>el.textContent=release.size(platform));
   document.querySelectorAll(`[data-preview-filename="${platform}"]`).forEach(el=>el.textContent=value[platform].filename);
  }
 }).catch(()=>{}); // The verified build-time links remain usable offline or if metadata fails.
}
