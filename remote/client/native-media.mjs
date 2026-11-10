function bytes64(bytes){let text='';for(const b of bytes)text+=String.fromCharCode(b);return btoa(text);}
function samples64(text,format){
 const raw=Uint8Array.from(atob(text),c=>c.charCodeAt(0)),view=new DataView(raw.buffer),size=format.bits/8,result=new Float32Array(Math.floor(raw.length/size));
 for(let i=0;i<result.length;i++){const p=i*size;let value;if(format.encoding==='float')value=view.getFloat32(p,true);else if(size===2)value=view.getInt16(p,true)/32768;else if(size===4)value=view.getInt32(p,true)/2147483648;else if(size===3)value=((raw[p]|raw[p+1]<<8|raw[p+2]<<16)<<8>>8)/8388608;else value=(raw[p]-128)/128;result[i]=Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;}return result;
}
export async function acquireNativeHost(grant,{rpc,post,status,resources}){
 const capture=await rpc('capture.start',{grantId:grant.id}),canvas=document.createElement('canvas');canvas.width=capture.width;canvas.height=capture.height;const context=canvas.getContext('2d'),stream=canvas.captureStream(12);
 let drawing=false,stopped=false,soundContext,soundNode,micContext,micNode,micPending=0;
 const effective=[...capture.permissions];
 const source={videoTrack:stream.getVideoTracks()[0],display:{id:capture.displayId,width:capture.width,height:capture.height},permissions:effective,
  handle:async message=>{
   if(message.type==='mic-ack'){micPending=Math.max(0,micPending-1);return;}
   if(message.type==='sound'){
    try{if(!stopped&&soundNode){const samples=samples64(message.data,capture.soundFormat);soundNode.port.postMessage({samples,channels:capture.soundFormat.channels},[samples.buffer]);}}
    finally{post({type:'sound.ack',captureId:capture.captureId});}return;
   }
   if(message.type!=='frame')return;
   if(drawing||stopped){post({type:'frame.ack',captureId:capture.captureId});return;}drawing=true;
   try{const image=new Image();image.src='data:image/jpeg;base64,'+message.jpeg;await image.decode();if(!stopped)context.drawImage(image,0,0,canvas.width,canvas.height);}
   finally{drawing=false;post({type:'frame.ack',captureId:capture.captureId});}
  },
  applyInput:input=>post({type:'input',captureId:capture.captureId,input}),releaseInput:()=>post({type:'input.release',captureId:capture.captureId}),
  receiveMicrophone:track=>{
   if(!effective.includes('microphone')){track.stop();return;}
   (async()=>{micContext=new AudioContext({sampleRate:48000});await micContext.audioWorklet.addModule('pcm-worklet.mjs');if(stopped){await micContext.close();return;}
    await rpc('mic.format',{captureId:capture.captureId,sampleRate:micContext.sampleRate});if(stopped)return;
    micNode=new AudioWorkletNode(micContext,'remote-pcm-sink');micNode.port.onmessage=event=>{if(stopped||micPending>=4)return;const samples=event.data,pcm=new Int16Array(samples.length);for(let i=0;i<samples.length;i++)pcm[i]=Math.round(Math.max(-1,Math.min(1,samples[i]))*32767);micPending++;post({type:'mic.data',captureId:capture.captureId,data:bytes64(new Uint8Array(pcm.buffer))});};
    micContext.createMediaStreamSource(new MediaStream([track])).connect(micNode).connect(micContext.destination);await micContext.resume();
   })().catch(error=>{track.stop();status('Phone microphone: '+error.message);});
  },
  dispose:()=>{stopped=true;stream.getTracks().forEach(t=>t.stop());resources.delete(capture.captureId);soundContext?.close().catch(()=>{});micContext?.close().catch(()=>{});post({type:'capture.stop',captureId:capture.captureId});}
 };
 resources.set(capture.captureId,source);
 if(capture.soundFormat&&effective.includes('speaker')){
  try{soundContext=new AudioContext({sampleRate:capture.soundFormat.sampleRate});await soundContext.audioWorklet.addModule('pcm-worklet.mjs');soundNode=new AudioWorkletNode(soundContext,'remote-pcm-source',{outputChannelCount:[2]});const destination=soundContext.createMediaStreamDestination();soundNode.connect(destination);source.audioTrack=destination.stream.getAudioTracks()[0];await soundContext.resume();}
  catch(error){source.permissions=source.permissions.filter(p=>p!=='speaker');status('Computer sound: '+error.message);}
 }
 if(capture.audioError)status(capture.audioError);return source;
}
