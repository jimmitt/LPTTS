export const RELAY_URL = 'https://api.msyumyum.com/lptts.php';

const SESSION_KEY = 'lptts-relay-session-v1';

export class RelaySession {
  constructor(data, handlers = {}) {
    this.code = data.code;
    this.participantId = data.participantId;
    this.token = data.token;
    this.role = data.role;
    this.cursor = Number(data.cursor) || 0;
    this.handlers = handlers;
    this.running = false;
    this.controller = null;
    this.sendQueue = Promise.resolve();
    this.save();
  }

  static async create(name, handlers) {
    const data = await request({ op: 'create', name });
    return new RelaySession({ ...data, role: 'host' }, handlers);
  }

  static async join(code, name, handlers) {
    const data = await request({ op: 'join', code: String(code).replace(/[^a-z0-9]/gi, '').toUpperCase(), name });
    return new RelaySession({ ...data, role: 'guest' }, handlers);
  }

  static restore(handlers) {
    try {
      const data = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return data?.token && data?.code ? new RelaySession(data, handlers) : null;
    } catch {
      return null;
    }
  }

  save() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: this.code, participantId: this.participantId, token: this.token, role: this.role, cursor: this.cursor }));
    } catch { /* Session resumption is optional. */ }
  }

  clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Optional storage. */ } }

  send(messages) {
    const list = Array.isArray(messages) ? messages : [messages];
    this.sendQueue = this.sendQueue.catch(() => {}).then(() => request({ op: 'send', token: this.token, messages: list }));
    return this.sendQueue;
  }

  async upload(file, onProgress = () => {}) {
    const started = await request({ op: 'asset_start', token: this.token, mime: file.type, size: file.size });
    const chunkSize = 192 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const result = await request({ op: 'asset_chunk', token: this.token, uploadId: started.uploadId, offset, data: btoa(binary) });
      onProgress(result.received / file.size);
    }
    return request({ op: 'asset_finish', token: this.token, uploadId: started.uploadId });
  }

  start() { if (!this.running) { this.running = true; this.poll(); } }
  stop() { this.running = false; this.controller?.abort(); }

  async poll() {
    let failures = 0;
    while (this.running) {
      try {
        this.controller = new AbortController();
        const timeout = setTimeout(() => this.controller?.abort(), 25000);
        const result = await request({ op: 'poll', token: this.token, since: this.cursor }, this.controller.signal).finally(() => clearTimeout(timeout));
        failures = 0;
        this.handlers.status?.('connected');
        for (const event of result.events || []) {
          await this.handlers.event?.(event);
          this.cursor = Math.max(this.cursor, Number(event.id) || 0);
          this.save();
        }
      } catch (error) {
        if (!this.running) return;
        failures += 1;
        this.handlers.status?.('reconnecting', error);
        if (/expired|authorized/i.test(error.message)) {
          this.clear();
          this.running = false;
          this.handlers.status?.('expired', error);
          return;
        }
        await delay(Math.min(1000 * (2 ** (failures - 1)), 10000));
      }
    }
  }
}

async function request(body, signal) {
  try {
    const response = await fetch(RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || `Relay returned ${response.status}.`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Relay request timed out.');
    throw error;
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
