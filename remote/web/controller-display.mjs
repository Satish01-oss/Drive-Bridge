export function mountControllerDisplay({doc=document,nativeFullscreen=null,onError=()=>{}}={}){
 const button=doc.getElementById('fullscreen'),toggle=doc.getElementById('tools-toggle'),tools=doc.getElementById('remote-tools-panel');
 let fullscreen=false,connected=false,busy=false,generation=0;
 function render(value){fullscreen=value;doc.body.classList.toggle('remote-fullscreen',value);button.textContent=value?'Exit fullscreen':'Fullscreen';button.setAttribute('aria-pressed',String(value));tools.hidden=value;toggle.setAttribute('aria-expanded',String(!tools.hidden));}
 async function change(value){if(busy||!connected&&value)return;busy=true;button.disabled=true;const attempt=generation;
  try{if(nativeFullscreen)await nativeFullscreen(value);else if(value)await doc.documentElement.requestFullscreen?.();else if(doc.fullscreenElement)await doc.exitFullscreen();
   if(attempt!==generation){if(nativeFullscreen)await nativeFullscreen(false);else if(doc.fullscreenElement)await doc.exitFullscreen();return;}render(value);
  }catch(error){onError(error);}finally{busy=false;button.disabled=!connected;}
 }
 function exit(){generation++;render(false);if(nativeFullscreen)Promise.resolve(nativeFullscreen(false)).catch(onError);else if(doc.fullscreenElement)doc.exitFullscreen().catch(onError);}
 button.onclick=()=>change(!fullscreen);toggle.onclick=()=>{tools.hidden=!tools.hidden;toggle.setAttribute('aria-expanded',String(!tools.hidden));};
 doc.addEventListener('fullscreenchange',()=>{if(!nativeFullscreen&&!doc.fullscreenElement&&fullscreen)render(false);});
 doc.defaultView?.addEventListener('devicebridge-exit-fullscreen',()=>render(false));
 render(false);button.disabled=true;
 return {setConnected(value){connected=value;button.disabled=busy||!connected;if(!value)exit();},exit,get fullscreen(){return fullscreen;}};
}
