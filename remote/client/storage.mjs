// Browser/app sandbox storage for the development client. Windows production keys
// will use the native DPAPI bridge; do not export private keys into JSON.
export class MemoryStore{
 #values=new Map();async get(key){return this.#values.get(key);}async set(key,value){this.#values.set(key,value);}
}
export class BrowserStore{
 #db;
 async #open(){if(!this.#db)this.#db=new Promise((resolve,reject)=>{const request=indexedDB.open('devicebridge-remote-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};});return this.#db;}
 async get(key){const db=await this.#open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly'),r=tx.objectStore('state').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async set(key,value){const db=await this.#open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,key);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}
}
