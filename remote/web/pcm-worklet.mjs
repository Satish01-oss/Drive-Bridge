class RemotePcmSource extends AudioWorkletProcessor{
 constructor(){super();this.queue=[];this.frames=0;this.port.onmessage=e=>{const {samples,channels}=e.data;if(!(samples instanceof Float32Array)||!Number.isInteger(channels)||channels<1||channels>8)return;this.queue.push({samples,channels,index:0});this.frames+=samples.length/channels;while(this.frames>sampleRate/4&&this.queue.length){const old=this.queue.shift();this.frames-=(old.samples.length-old.index)/old.channels;}};}
 process(_,outputs){const output=outputs[0];for(let i=0;i<(output[0]?.length||0);i++){while(this.queue[0]&&this.queue[0].index>=this.queue[0].samples.length)this.queue.shift();const item=this.queue[0];for(let c=0;c<output.length;c++)output[c][i]=item?item.samples[item.index+Math.min(c,item.channels-1)]:0;if(item){item.index+=item.channels;this.frames--;}}return true;}
}
class RemotePcmSink extends AudioWorkletProcessor{
 constructor(){super();this.buffer=new Float32Array(2048);this.offset=0;}
 process(inputs){const channels=inputs[0];if(!channels?.length)return true;for(let i=0;i<channels[0].length;i++){let sample=0;for(const c of channels)sample+=c[i]||0;this.buffer[this.offset++]=sample/channels.length;if(this.offset===this.buffer.length){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(2048);this.offset=0;}}return true;}
}
registerProcessor('remote-pcm-source',RemotePcmSource);registerProcessor('remote-pcm-sink',RemotePcmSink);
