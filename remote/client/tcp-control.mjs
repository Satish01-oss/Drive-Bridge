import {canonical,toBase64Url} from '../shared/signatures.mjs';
import {validateInput} from '../core/protocol.mjs';
import {validateTcpFrame} from '../core/tcp-frame.mjs';
const bytes=value=>new TextEncoder().encode(canonical(value));
function decode(value,max){if(typeof value!=='string'||value.length>max||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid encrypted control encoding');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
const iv=seq=>{const result=new Uint8Array(12),view=new DataView(result.buffer);view.setBigUint64(4,BigInt(seq));return result;};
function payload(value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==2)throw Error('Invalid TCP payload');
 if(value.kind==='input'&&'input'in value)validateInput(value.input);
 else if(value.kind==='ack'&&'ack'in value&&Number.isSafeInteger(value.ack)&&value.ack>=0){}else throw Error('Invalid TCP payload');return value;
}
export class TcpControlCipher{
 #incoming=Promise.resolve();#outgoing=Promise.resolve();
 #context;#role;#pair;#tx;#rx;#txSeq=0;#rxSeq=0;#accepted=false;#closed=false;
 static async create(context){const cipher=new TcpControlCipher(context);cipher.#pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);cipher.publicKey=toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw',cipher.#pair.publicKey)));return cipher;}
 constructor({grantId,sessionId,generation,localId,remoteId,role}){
  if(!['host','controller'].includes(role))throw Error('Invalid TCP role');this.#role=role;this.#context={protocol:'devicebridge.tcp.v1',grantId,sessionId,generation,from:localId,to:remoteId};validateTcpFrame({...this.#context,seq:0,data:'a'.repeat(22)});
 }
 get ready(){return !this.#closed&&!!this.#tx&&!!this.#rx;}
 async acceptKey(publicKey){
  if(this.#closed||this.#accepted)throw Error('TCP key already set or closed');this.#accepted=true;const raw=decode(publicKey,90);if(raw.length!==65||raw[0]!==4)throw Error('Invalid TCP public key');
  const remote=await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},false,[]),secret=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:remote},this.#pair.privateKey,256));
  const material=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);secret.fill(0);
  const c=this.#context,salt=bytes({protocol:c.protocol,grantId:c.grantId,sessionId:c.sessionId,generation:c.generation});
  const derive=(from,to)=>crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:bytes({from,to,purpose:'devicebridge.tcp-control.v1'})},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const [tx,rx]=await Promise.all([derive(c.from,c.to),derive(c.to,c.from)]);if(this.#closed)return;this.#tx=tx;this.#rx=rx;this.#pair=null;
 }
 seal(value){const snapshot=structuredClone(value),work=this.#outgoing.then(()=>this.#seal(snapshot));this.#outgoing=work.catch(()=>{});return work;}
 async #seal(value){
  if(!this.ready)throw Error('TCP control is not ready');payload(value);if(value.kind!==(this.#role==='controller'?'input':'ack'))throw Error('Wrong TCP control direction');
  const seq=this.#txSeq++;if(!Number.isSafeInteger(seq))throw Error('TCP sequence exhausted');const header={...this.#context,seq},encoded=new TextEncoder().encode(JSON.stringify(value));if(encoded.length>32768)throw Error('TCP command is too large');
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv(seq),additionalData:bytes(header),tagLength:128},this.#tx,encoded);if(this.#closed)throw Error('TCP control closed');return {...header,data:toBase64Url(new Uint8Array(data))};
 }
 open(frame){const snapshot=structuredClone(frame),work=this.#incoming.then(()=>this.#open(snapshot));this.#incoming=work.catch(()=>{});return work;}
 async #open(frame){
  if(!this.ready)throw Error('TCP control is not ready');validateTcpFrame(frame);const {data,...header}=frame,c=this.#context;
  if(frame.grantId!==c.grantId||frame.sessionId!==c.sessionId||frame.generation!==c.generation||frame.from!==c.to||frame.to!==c.from)throw Error('Wrong TCP session');
  if(frame.seq<this.#rxSeq)return null;if(frame.seq!==this.#rxSeq)throw Error('TCP input arrived out of order');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv(frame.seq),additionalData:bytes(header),tagLength:128},this.#rx,decode(data,44000));if(this.#closed)throw Error('TCP control closed');
  const value=payload(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));if(value.kind!==(this.#role==='host'?'input':'ack'))throw Error('Wrong TCP payload direction');this.#rxSeq++;return value;
 }
 close(){this.#closed=true;this.#pair=this.#tx=this.#rx=null;}
}
