// Platform-neutral contract. No sockets, capture, input injection or permissions are enabled here.
export const PROTOCOL = 'devicebridge.remote';
export const VERSION = 1;
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const PERMISSIONS = Object.freeze(['view', 'input', 'speaker', 'microphone']);
const modes = ['local-share', 'remote-access'];
const platforms = ['windows', 'macos', 'android', 'ios'];
const kinds = ['hello', 'session.open', 'session.ready', 'heartbeat', 'session.stop', 'input', 'signal'];
const idPattern = /^[A-Za-z0-9_-]{16,96}$/;
const textBytes = text => new TextEncoder().encode(text).byteLength;
function requireThat(value, message) { if (!value) throw new Error(message); }
function object(value, keys) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  requireThat(Object.keys(value).every(key => keys.includes(key)), 'Unknown field');
}
function identifier(value) { requireThat(typeof value === 'string' && idPattern.test(value), 'Invalid identifier'); }
function strings(value, allowed) {
  requireThat(Array.isArray(value) && value.length <= allowed.length && new Set(value).size === value.length && value.every(v => allowed.includes(v)), 'Invalid capability list');
}
function integer(value, min, max) { requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 'Invalid integer'); }
function point(value) {
  object(value, ['displayId', 'x', 'y']); identifier(value.displayId);
  for (const key of ['x', 'y']) requireThat(Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1, 'Invalid normalized point');
}
export function validateHello(value) {
  object(value, ['protocol', 'minVersion', 'maxVersion', 'deviceId', 'platform', 'roles', 'modes', 'capabilities']);
  requireThat(value.protocol === PROTOCOL, 'Wrong protocol');
  integer(value.minVersion, 1, 65535); integer(value.maxVersion, value.minVersion, 65535);
  identifier(value.deviceId); requireThat(platforms.includes(value.platform), 'Unknown platform');
  strings(value.roles, ['host', 'controller']); requireThat(value.roles.length > 0, 'Role required');
  strings(value.modes, modes); requireThat(value.modes.length > 0, 'Mode required');
  strings(value.capabilities, PERMISSIONS);
  requireThat(!['android', 'ios'].includes(value.platform) || !value.roles.includes('host'), 'Mobile desktop hosting is unsupported in v1');
  return value;
}
export function negotiate(host, controller, requested = ['view']) {
  validateHello(host); validateHello(controller); strings(requested, PERMISSIONS);
  requireThat(requested.includes('view'), 'Remote desktop requires view');
  requireThat(host.deviceId !== controller.deviceId, 'Cannot connect device to itself');
  requireThat(host.roles.includes('host') && controller.roles.includes('controller'), 'Incompatible roles');
  requireThat(host.modes.includes('remote-access') && controller.modes.includes('remote-access'), 'Remote mode unavailable');
  requireThat(Math.max(host.minVersion, controller.minVersion) <= VERSION && Math.min(host.maxVersion, controller.maxVersion) >= VERSION, 'No supported protocol version');
  const capabilities = requested.filter(p => host.capabilities.includes(p) && controller.capabilities.includes(p));
  requireThat(capabilities.includes('view'), 'Screen viewing unavailable');
  // Capability availability is not consent. Only a current host grant authorizes these.
  return Object.freeze({version: VERSION, capabilities: Object.freeze(capabilities)});
}
export function validateInput(value) {
  object(value, ['type', 'point', 'button', 'down', 'code', 'text', 'dx', 'dy']);
  switch (value.type) {
    case 'pointer': object(value, ['type', 'point']); point(value.point); break;
    case 'button': object(value, ['type', 'button', 'down']); requireThat(['primary', 'secondary', 'middle'].includes(value.button) && typeof value.down === 'boolean', 'Invalid button'); break;
    case 'key': object(value, ['type', 'code', 'down']); requireThat(typeof value.code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(value.code) && typeof value.down === 'boolean', 'Invalid key'); break;
    case 'text': object(value, ['type', 'text']); requireThat(typeof value.text === 'string' && value.text.length > 0 && textBytes(value.text) <= 4096 && !/[\u0000]/.test(value.text), 'Invalid text'); break;
    case 'scroll': object(value, ['type', 'dx', 'dy']); for (const key of ['dx', 'dy']) requireThat(Number.isFinite(value[key]) && Math.abs(value[key]) <= 4096, 'Invalid scroll'); break;
    case 'release-all': object(value, ['type']); break;
    default: throw new Error('Unknown input event');
  }
  return value;
}
export function validateMessage(message) {
  object(message, ['protocol', 'version', 'kind', 'sessionId', 'generation', 'seq', 'payload']);
  requireThat(message.protocol === PROTOCOL && message.version === VERSION, 'Unsupported protocol');
  requireThat(kinds.includes(message.kind), 'Unknown message kind');
  identifier(message.sessionId); integer(message.generation, 1, Number.MAX_SAFE_INTEGER); integer(message.seq, 0, Number.MAX_SAFE_INTEGER);
  const p = message.payload;
  switch (message.kind) {
    case 'hello': validateHello(p); break;
    case 'session.open':
      object(p, ['deviceId', 'grantId', 'permissionRevision', 'permissions']); identifier(p.deviceId); identifier(p.grantId); integer(p.permissionRevision, 1, Number.MAX_SAFE_INTEGER); strings(p.permissions, PERMISSIONS); requireThat(p.permissions.includes('view'), 'View required'); break;
    case 'session.ready':
      object(p, ['permissions', 'permissionRevision']); strings(p.permissions, PERMISSIONS); requireThat(p.permissions.includes('view'), 'View required'); integer(p.permissionRevision, 1, Number.MAX_SAFE_INTEGER); break;
    case 'heartbeat': object(p, ['nonce']); identifier(p.nonce); break;
    case 'session.stop': object(p, ['reason']); requireThat(['user', 'revoked', 'expired', 'shutdown', 'permission-changed', 'transport-failed'].includes(p.reason), 'Invalid stop reason'); break;
    case 'input': validateInput(p); break;
    case 'signal':
      object(p, ['type', 'data']); requireThat(['offer', 'answer', 'candidate'].includes(p.type), 'Invalid signal'); requireThat(typeof p.data === 'string' && textBytes(p.data) <= 48 * 1024, 'Invalid signal data'); break;
  }
  return message;
}
export function encodeMessage(message) {
  validateMessage(message); const text = JSON.stringify(message);
  requireThat(textBytes(text) <= MAX_MESSAGE_BYTES, 'Message too large'); return text;
}
export function decodeMessage(text) {
  requireThat(typeof text === 'string' && textBytes(text) <= MAX_MESSAGE_BYTES, 'Message too large');
  return validateMessage(JSON.parse(text));
}

// One gate per authenticated peer session and channel. Never reuse after reconnect.
export class SessionGate {
  #sessionId; #generation; #permissions; #lastSeq = -1; #closed = false;
  constructor({sessionId, generation, permissions}) {
    identifier(sessionId); integer(generation, 1, Number.MAX_SAFE_INTEGER); strings(permissions, PERMISSIONS);
    this.#sessionId = sessionId; this.#generation = generation; this.#permissions = new Set(permissions);
  }
  accept(message) {
    validateMessage(message);
    if (this.#closed || message.sessionId !== this.#sessionId || message.generation !== this.#generation || message.seq <= this.#lastSeq) return false;
    // Input requires view AND input. A release-all packet may never inject a press.
    if (message.kind === 'input' && (!this.#permissions.has('input') || !this.#permissions.has('view'))) return false;
    if (message.kind === 'session.open' || message.kind === 'session.ready' || message.kind === 'hello') return false;
    this.#lastSeq = message.seq;
    if (message.kind === 'session.stop') this.#closed = true;
    return true;
  }
  close() { this.#closed = true; }
}
