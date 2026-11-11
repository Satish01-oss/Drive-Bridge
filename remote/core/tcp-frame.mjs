// TCP relay frames contain authenticated ciphertext only. No input is decoded here.
export function validateTcpFrame(frame){
 const fields=['protocol','grantId','sessionId','generation','from','to','seq','data'];
 if(!frame||Object.getPrototypeOf(frame)!==Object.prototype||Object.keys(frame).length!==fields.length||fields.some(k=>!(k in frame)))throw Error('Invalid TCP frame');
 if(frame.protocol!=='devicebridge.tcp.v1')throw Error('Unsupported TCP control protocol');
 for(const key of ['grantId','sessionId','from','to'])if(typeof frame[key]!=='string'||!/^[A-Za-z0-9_-]{16,96}$/.test(frame[key]))throw Error('Invalid TCP identity');
 if(frame.from===frame.to||!Number.isSafeInteger(frame.generation)||frame.generation<1||!Number.isSafeInteger(frame.seq)||frame.seq<0)throw Error('Invalid TCP sequence');
 if(typeof frame.data!=='string'||!/^[A-Za-z0-9_-]{22,44000}$/.test(frame.data))throw Error('Invalid TCP ciphertext');return frame;
}
