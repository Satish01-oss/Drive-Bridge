import {PERMISSIONS} from './protocol.mjs';
// Deterministic policy only: native/WebRTC adapters must execute every returned effect.
// Grants and authenticated completion events MUST come from the host identity verifier,
// never directly from an untrusted signaling server or incoming JSON.
export class Recovery {
  #clock; #random; #time = -Infinity; #trust = null; #generation = 0;
  #active = null; #attempts = 0; #deadline = null; #next = null;
  #state = 'idle'; #online = true; #hostOnline = false;
  constructor({now = () => Date.now(), random = () => Math.random()} = {}) { this.#clock = now; this.#random = random; }
  #now() {
    const time = this.#clock(); if (!Number.isFinite(time)) throw new Error('Invalid clock');
    this.#time = Math.max(this.#time, time); return this.#time;
  }
  get snapshot() { return Object.freeze({state: this.#state, generation: this.#generation, attemptId: this.#active, nextAttemptAt: this.#next, attempts: this.#attempts}); }
  #cleanup(reason) {
    this.#generation++; this.#active = null; this.#deadline = null; this.#next = null;
    return [{type: 'cancel-transport', reason}, {type: 'release-input'}, {type: 'restore-pointer'}, {type: 'stop-media'}];
  }
  #authorized() { return this.#trust !== null && this.#trust.expiresAt > this.#now(); }
  #wait() {
    if (!this.#authorized()) { this.#trust = null; this.#state = 'approval-required'; return; }
    if (!this.#online) this.#state = 'phone-offline';
    else if (!this.#hostOnline) this.#state = 'host-offline';
    else { this.#state = 'waiting'; this.#next = this.#now(); }
  }
  approve(grant) {
    const now = this.#now();
    if (!grant || typeof grant.hostId !== 'string' || !/^[A-Za-z0-9_-]{16,96}$/.test(grant.hostId) ||
        typeof grant.grantId !== 'string' || !/^[A-Za-z0-9_-]{16,96}$/.test(grant.grantId) ||
        !Number.isSafeInteger(grant.revision) || grant.revision < 1 || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now ||
        typeof grant.reconnect !== 'boolean' || !Array.isArray(grant.permissions) || !grant.permissions.includes('view') ||
        new Set(grant.permissions).size !== grant.permissions.length || grant.permissions.some(p => !PERMISSIONS.includes(p))) throw new Error('Invalid host grant');
    const effects = this.#cleanup('new-approval');
    this.#trust = Object.freeze({...grant, permissions: Object.freeze([...grant.permissions])});
    this.#attempts = 0; this.#wait(); return effects;
  }
  setAvailability({phoneOnline = this.#online, hostOnline = this.#hostOnline} = {}) {
    if (typeof phoneOnline !== 'boolean' || typeof hostOnline !== 'boolean') throw new Error('Invalid availability');
    if (phoneOnline === this.#online && hostOnline === this.#hostOnline) return [];
    this.#online = phoneOnline; this.#hostOnline = hostOnline;
    if (['idle', 'stopped', 'approval-required'].includes(this.#state)) return [];
    // Availability reports are a hint, not authentication. They can never grant access.
    if (!phoneOnline || !hostOnline) return this.#drop('network-lost');
    this.#wait(); return [];
  }
  tick() {
    const now = this.#now();
    if (['idle', 'stopped', 'approval-required'].includes(this.#state)) return [];
    if (!this.#authorized()) { const effects = this.#cleanup('expired'); this.#trust = null; this.#state = 'approval-required'; return effects; }
    if (this.#state === 'connecting' && now >= this.#deadline) return this.failed(this.#active);
    if (this.#state !== 'waiting' || this.#next === null || now < this.#next) return [];
    this.#generation++; this.#active = this.#generation; this.#attempts++; this.#state = 'connecting'; this.#deadline = now + 15000; this.#next = null;
    return [{type: 'connect', attemptId: this.#active, hostId: this.#trust.hostId, grantId: this.#trust.grantId, revision: this.#trust.revision, permissions: [...this.#trust.permissions]}];
  }
  connected(attemptId, {hostId, grantId, revision, permissions}) {
    if (attemptId === this.#active && this.#state === 'connected') return [];
    if (attemptId !== this.#active || this.#state !== 'connecting') return [{type: 'discard-transport', attemptId}];
    if (!this.#authorized() || hostId !== this.#trust.hostId || grantId !== this.#trust.grantId || revision !== this.#trust.revision ||
        !Array.isArray(permissions) || !permissions.includes('view') || new Set(permissions).size !== permissions.length || permissions.some(p => !this.#trust.permissions.includes(p))) {
      const effects = this.#cleanup('authorization-rejected'); this.#trust = null; this.#state = 'approval-required'; return effects;
    }
    // A reduced host grant must also govern later reconnects; never restore old permissions.
    this.#trust = Object.freeze({...this.#trust, permissions: Object.freeze([...permissions])});
    this.#state = 'connected'; this.#deadline = null; this.#attempts = 0;
    return [{type: 'session-ready', permissions: [...permissions], generation: this.#generation}];
  }
  failed(attemptId) {
    if (attemptId !== this.#active || this.#state !== 'connecting') return [];
    const effects = this.#cleanup('attempt-failed');
    if (!this.#trust?.reconnect) { this.#trust = null; this.#state = 'approval-required'; return effects; }
    this.#wait();
    if (this.#state === 'waiting') {
      const sample = this.#random(); if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Invalid random sample');
      const delay = Math.min(30000, 1000 * 2 ** Math.min(Math.max(this.#attempts - 1, 0), 5));
      this.#next = this.#now() + Math.min(30000, Math.round(delay * (0.8 + sample * 0.4)));
    }
    return effects;
  }
  disconnected(attemptId, reason = 'transport-lost') {
    if (attemptId !== this.#active || !['connected', 'connecting'].includes(this.#state)) return [];
    return this.#drop(reason);
  }
  #drop(reason) {
    if (['idle', 'stopped', 'approval-required'].includes(this.#state)) return [];
    const effects = this.#cleanup(reason);
    if (!this.#trust?.reconnect) { this.#trust = null; this.#state = 'approval-required'; return effects; }
    this.#wait(); return effects;
  }
  reconnectNow() {
    if (this.#state !== 'waiting') return [];
    this.#next = this.#now(); return this.tick();
  }
  stop() { const effects = this.#cleanup('user-stopped'); this.#trust = null; this.#state = 'stopped'; return effects; }
  revoke() { const effects = this.#cleanup('revoked'); this.#trust = null; this.#state = 'approval-required'; return effects; }
}
export function reconnectDelay(failures,sample=Math.random()){
 if(!Number.isInteger(failures)||failures<0||!Number.isFinite(sample)||sample<0||sample>=1)throw Error('Invalid retry state');
 return Math.min(30000,Math.round(Math.min(30000,1000*2**Math.min(failures,5))*(.8+sample*.4)));
}
export function shouldRestartNetwork(previous,online,changed=false){
 if([previous,online,changed].some(value=>typeof value!=='boolean'))throw Error('Invalid network state');return previous!==online||(online&&changed);
}
