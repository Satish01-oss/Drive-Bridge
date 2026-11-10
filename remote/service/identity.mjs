import {createPublicKey,createHash,randomBytes,verify} from 'node:crypto';
import {signingBytes} from '../shared/signatures.mjs';
export {canonical,signingBytes} from '../shared/signatures.mjs';
export const randomId=()=>randomBytes(24).toString('base64url');
export const digest=value=>createHash('sha256').update(value).digest('base64url');
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
