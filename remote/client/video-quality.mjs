export const VIDEO_QUALITIES={low:{maxBitrate:220000,maxFramerate:7,scaleResolutionDownBy:2},balanced:{maxBitrate:750000,maxFramerate:12,scaleResolutionDownBy:1.5},sharp:{maxBitrate:2500000,maxFramerate:12,scaleResolutionDownBy:1}};
export function videoNetworkSample(stats){
 const rows=[...stats.values()],transports=rows.filter(r=>r.type==='transport'),pair=rows.find(r=>r.type==='candidate-pair'&&transports.some(t=>t.selectedCandidatePairId===r.id))||rows.find(r=>r.type==='candidate-pair'&&r.nominated&&r.state==='succeeded'),remote=rows.find(r=>r.type==='remote-inbound-rtp'&&(r.kind==='video'||r.mediaType==='video')),outbound=rows.find(r=>r.type==='outbound-rtp'&&(r.kind==='video'||r.mediaType==='video')),candidate=rows.find(r=>r.type==='local-candidate'&&r.id===pair?.localCandidateId);
 const positive=value=>Number.isFinite(value)&&value>0?value:0;
 return {bandwidth:positive(pair?.availableOutgoingBitrate),loss:Math.min(1,positive(remote?.fractionLost)),rtt:positive(remote?.roundTripTime||pair?.currentRoundTripTime),protocol:['udp','tcp'].includes(candidate?.protocol)?candidate.protocol:'unknown',cpuLimited:outbound?.qualityLimitationReason==='cpu',packetsLost:remote?.packetsLost,packetsReceived:remote?.packetsReceived};
}
export function chooseVideoQuality({bandwidth=0,loss=0,rtt=0,cpuLimited=false}={}){if(cpuLimited||loss>.08||rtt>.8||bandwidth>0&&bandwidth<600000)return'low';if(bandwidth>3000000&&loss<.02&&rtt<.2)return'sharp';return'balanced';}
export class AdaptiveVideo{
 #pc;#sender;#timer;#busy=false;#stopped=false;#candidate=null;#healthy=0;#quality='balanced';#applied=null;#protocol='unknown';#interval;#cancel;#previous;#sample={};#error=null;
 constructor({pc,sender,interval=(fn,ms)=>globalThis.setInterval(fn,ms),cancelInterval=id=>globalThis.clearInterval(id)}){this.#pc=pc;this.#sender=sender;this.#interval=interval.bind(globalThis);this.#cancel=cancelInterval.bind(globalThis);}
 get snapshot(){return{quality:this.#quality,mediaProtocol:this.#protocol,availableKbps:Math.round((this.#sample.bandwidth||0)/1000),roundTripMilliseconds:Math.round((this.#sample.rtt||0)*1000),videoLossPercent:Math.round((this.#sample.loss||0)*1000)/10,encoderCpuLimited:!!this.#sample.cpuLimited,videoConfigurationError:this.#error};}
 start(){if(this.#timer||this.#stopped||!this.#sender?.setParameters)return;this.poll();this.#timer=this.#interval(()=>this.poll(),5000);this.#timer.unref?.();}
 async poll(){
  if(this.#busy||this.#stopped||!this.#sender?.setParameters)return;this.#busy=true;
  try{
   const sample=videoNetworkSample(await this.#pc.getStats());if(this.#stopped)return;
   const prev=this.#previous,lost=sample.packetsLost-(prev?.packetsLost||0),received=sample.packetsReceived-(prev?.packetsReceived||0);
   if(Number.isFinite(lost)&&Number.isFinite(received)&&lost>=0&&received>=0&&lost+received>0)sample.loss=Math.max(sample.loss,lost/(lost+received));
   this.#previous=sample;this.#sample=sample;this.#protocol=sample.protocol;
   const next=chooseVideoQuality(sample),order=['low','balanced','sharp'];
   if(order.indexOf(next)>order.indexOf(this.#quality)){this.#healthy=next===this.#candidate?this.#healthy+1:1;this.#candidate=next;if(this.#healthy>=2)this.#quality=next;}else{this.#quality=next;this.#healthy=0;this.#candidate=null;}
   if(this.#applied===this.#quality)return;
   const parameters=this.#sender.getParameters();if(!parameters.encodings?.length){this.#error='Video encoder is not ready yet.';return;}
   Object.assign(parameters.encodings[0],VIDEO_QUALITIES[this.#quality]);if(this.#stopped)return;await this.#sender.setParameters(parameters);this.#applied=this.#quality;this.#error=null;
  }catch{this.#error='The video encoder could not apply its quality setting.';}finally{this.#busy=false;}
 }
 stop(){this.#stopped=true;this.#cancel(this.#timer);}
}
