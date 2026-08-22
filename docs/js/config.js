/**
 * LPTTS Network & WebRTC Configuration
 * 
 * You can provide your TURN credentials in ANY of these formats:
 * 
 * Format A (Simplified):
 * export const TURN_CONFIG = {
 *   host: 'global.relay.metered.ca',
 *   username: '...',
 *   credential: '...'
 * };
 * 
 * Format B (Full Metered iceServers array):
 * export const TURN_CONFIG = [
 *   { urls: "stun:stun.relay.metered.ca:80" },
 *   { urls: "turn:global.relay.metered.ca:80", username: "...", credential: "..." },
 *   { urls: "turn:global.relay.metered.ca:443", username: "...", credential: "..." },
 *   { urls: "turn:global.relay.metered.ca:443?transport=tcp", username: "...", credential: "..." },
 *   { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "...", credential: "..." }
 * ];
 */

export const TURN_CONFIG = {
  host: 'global.relay.metered.ca',
  username: '',
  credential: ''
};

export const DEFAULT_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 10
};

const STORAGE_KEY = 'lptts-turn-config';

/**
 * Returns TURN configuration from config.js file if populated, otherwise checks localStorage.
 */
export function getEffectiveTurnConfig() {
  if (Array.isArray(TURN_CONFIG) && TURN_CONFIG.length > 0) {
    return { iceServers: TURN_CONFIG, source: 'file' };
  }
  if (TURN_CONFIG && TURN_CONFIG.host && TURN_CONFIG.username && TURN_CONFIG.credential) {
    return {
      host: TURN_CONFIG.host.trim().replace(/^turn:/i, '').replace(/^stun:/i, ''),
      username: TURN_CONFIG.username.trim(),
      credential: TURN_CONFIG.credential.trim(),
      source: 'file'
    };
  }
  const stored = getStoredTurnConfig();
  if (stored) {
    return { ...stored, source: 'localStorage' };
  }
  return null;
}

/**
 * Reads user-configured TURN credentials from localStorage.
 */
export function getStoredTurnConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.iceServers || (parsed.host && parsed.username && parsed.credential))) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Saves TURN credentials to localStorage.
 */
export function saveStoredTurnConfig(data) {
  if (Array.isArray(data)) {
    const config = { iceServers: data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return config;
  }
  if (data && data.iceServers) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }
  const cleanHost = String(data?.host || '').trim().replace(/^turn:/i, '').replace(/^stun:/i, '');
  const cleanUser = String(data?.username || '').trim();
  const cleanCred = String(data?.credential || '').trim();

  if (!cleanHost || !cleanUser || !cleanCred) {
    throw new Error('Please fill in host, username, and credential.');
  }

  const config = { host: cleanHost, username: cleanUser, credential: cleanCred };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  return config;
}

/**
 * Clears stored TURN credentials from localStorage.
 */
export function clearStoredTurnConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Parses TURN configuration from a JSON file content (e.g. Metered export or custom JSON).
 */
export function parseTurnJson(jsonString) {
  const data = JSON.parse(jsonString);
  if (Array.isArray(data)) {
    return { iceServers: data };
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.iceServers)) {
      return { iceServers: data.iceServers };
    }
    if (data.host && data.username && data.credential) {
      return {
        host: data.host,
        username: data.username,
        credential: data.credential
      };
    }
  }
  throw new Error('Unrecognized TURN configuration format.');
}

/**
 * Builds the full RTCConfiguration combining base STUN and optional TURN relay servers.
 */
export function buildRtcConfig(turnConfig = null) {
  const config = turnConfig || getEffectiveTurnConfig();
  const iceServers = [...DEFAULT_RTC_CONFIG.iceServers];

  if (!config) {
    return { iceServers, iceCandidatePoolSize: 10 };
  }

  if (Array.isArray(config.iceServers)) {
    for (const s of config.iceServers) {
      if (s && s.urls) iceServers.push(s);
    }
  } else if (config.host) {
    const host = config.host;
    iceServers.push(
      { urls: `stun:stun.${host}:80` },
      { urls: `stun:${host}:80` },
      {
        urls: [
          `turn:${host}:80`,
          `turn:${host}:80?transport=tcp`,
          `turn:${host}:443`,
          `turn:${host}:443?transport=tcp`,
          `turns:${host}:443?transport=tcp`
        ],
        username: config.username,
        credential: config.credential
      }
    );
  }

  return {
    iceServers,
    iceCandidatePoolSize: 10
  };
}

export const RTC_CONFIG = buildRtcConfig();
