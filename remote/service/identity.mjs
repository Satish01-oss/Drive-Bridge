import {createPublicKey,createHash,randomBytes,verify} from 'node:crypto';
export const randomId=()=>randomBytes(24).toString('base64url');
export const digest=value=>createHash('sha256').update(value).digest('base64url');
export function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw Error('Invalid signed value');
}
export const signingBytes=(purpose,value)=>Buffer.from('devicebridge.'+purpose+'.v1\n'+canonical(value),'utf8');
export function publicIdentity(encoded){
 if(typeof encoded!=='string'||!/^MCowBQYDK2VwAyEA[A-Za-z0-9_-]{43}$/.test(encoded))throw Error('Invalid Ed25519 identity');
 const der=Buffer.from(encoded,'base64url'),key=createPublicKey({key:der,format:'der',type:'spki'});
 if(key.asymmetricKeyType!=='ed25519'||key.export({format:'der',type:'spki'}).toString('base64url')!==encoded)throw Error('Invalid Ed25519 identity');
 return {id:digest(der),publicKey:encoded,key};
}
export function verifiedSignature(publicKey,purpose,value,signature){
 if(typeof signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(signature))return false;
 try{return verify(null,signingBytes(purpose,value),publicIdentity(publicKey).key,Buffer.from(signature,'base64url'));}catch{return false;}
}
