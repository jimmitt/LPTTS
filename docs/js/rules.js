// Casual, client-side rules engines for Legendary Profiles games.
// Rules operate on plain JSON-compatible state and return a new state.

const GLYPHS = ['circle', 'pentagon', 'triangle', 'square', 'moon', 'sun'];

const copy = (value) => structuredClone(value);
const glyphValue = (card, glyph) => Number(card?.metadata?.glyphs?.[glyph] ?? 0);
const nextPlayer = (state) => {
  const index = state.players.findIndex((p) => p.id === state.currentPlayerId);
  return state.players[(index + 1) % state.players.length]?.id || null;
};

export function createHundredMilesGame(players, decks = {}) {
  if (!Array.isArray(players) || players.length < 2) throw new Error('100 Miles needs at least two players.');
  return { game: 'hundred-miles', players: players.map((p) => ({ ...p, miles: 0, draw: [...(decks[p.id] || [])], discard: [], lastGlyph: null, lastValue: null, skipTurns: 0 })), currentPlayerId: null, started: false, winnerId: null };
}

export function startHundredMiles(state, hostId, firstPlayerId) {
  if (!state.players.some((p) => p.id === hostId)) throw new Error('Host is not a player.');
  if (!state.players.some((p) => p.id === firstPlayerId)) throw new Error('Choose a valid first player.');
  const next = copy(state); next.currentPlayerId = firstPlayerId; next.started = true; return next;
}

export function hundredMilesAction(state, action) {
  if (!state.started || state.winnerId) throw new Error('This game is not active.');
  const next = copy(state), player = next.players.find((p) => p.id === next.currentPlayerId);
  if (!player) throw new Error('Current player not found.');
  if (action.playerId !== player.id) throw new Error('It is not your turn.');
  if (player.skipTurns) { player.skipTurns -= 1; next.currentPlayerId = nextPlayer(next); return next; }
  if (action.type === 'draw') {
    const glyph = String(action.glyph); if (!GLYPHS.includes(glyph)) throw new Error('Choose a valid glyph.');
    if (!['even', 'odd'].includes(action.parity)) throw new Error('Choose even or odd.');
    const card = player.draw.shift(); if (!card) throw new Error('Your draw pile is empty.');
    const value = glyphValue(card, glyph), matches = value % 2 === (action.parity === 'even' ? 0 : 1);
    const repeated = player.lastGlyph === glyph && player.lastValue === value;
    player.lastGlyph = glyph; player.lastValue = value; player.discard.push(card);
    if (repeated) player.skipTurns += 1;
    if (matches) {
      if (action.effect === 'attack') {
        const target = next.players.find((p) => p.id === action.targetId);
        if (!target || target.id === player.id) throw new Error('Choose another player as the target.');
        target.miles = Math.max(0, target.miles - value);
      } else player.miles += value;
    } else player.miles = Math.max(0, player.miles - value);
    if (player.miles >= 100) next.winnerId = player.id;
  } else if (action.type === 'triple') {
    const matches = player.discard.filter((card) => glyphValue(card, action.glyph) === Number(action.value));
    if (matches.length < 3) throw new Error('You need three matching glyph/value cards.');
    const target = next.players.find((p) => p.id === action.targetId);
    if (!target || target.id === player.id) throw new Error('Choose another player as the target.');
    let removed = 0; player.discard = player.discard.filter((card) => {
      if (removed < 3 && glyphValue(card, action.glyph) === Number(action.value)) { removed += 1; return false; }
      return true;
    });
    target.skipTurns += 1; player.draw.push(...matches.slice(0, 3));
  } else if (action.type !== 'end') throw new Error('Unknown 100 Miles action.');
  if (!next.winnerId) next.currentPlayerId = nextPlayer(next);
  return next;
}

export function createWarGame(players, decks = {}, highStakes = false) {
  if (!Array.isArray(players) || players.length !== 2) throw new Error('War needs exactly two players.');
  return { game: 'war', players: players.map((p) => ({ ...p, draw: [...(decks[p.id] || [])], win: [], lose: [] })), currentPlayerId: null, nextGlyph: null, highStakes: Boolean(highStakes), started: false, winnerId: null };
}

export function startWar(state, hostId, firstPlayerId, firstGlyph) {
  if (!state.players.some((p) => p.id === hostId)) throw new Error('Host is not a player.');
  if (!state.players.some((p) => p.id === firstPlayerId)) throw new Error('Choose a valid first player.');
  if (!GLYPHS.includes(firstGlyph)) throw new Error('Choose a valid glyph.');
  const next = copy(state); next.currentPlayerId = firstPlayerId; next.nextGlyph = firstGlyph; next.started = true; return next;
}

export function warAction(state, action) {
  if (!state.started || state.winnerId) throw new Error('This game is not active.');
  if (action.playerId !== state.currentPlayerId) throw new Error('It is not your turn.');
  if (!GLYPHS.includes(action.glyph)) throw new Error('Choose a valid glyph.');
  const next = copy(state), [a, b] = next.players;
  if (!a.draw.length || !b.draw.length) { next.winnerId = a.draw.length ? a.id : b.id; return next; }
  const cards = [a.draw.shift(), b.draw.shift()], av = glyphValue(cards[0], action.glyph), bv = glyphValue(cards[1], action.glyph);
  if (av === bv) { a.lose.push(cards[0]); b.lose.push(cards[1]); }
  else { const winner = av > bv ? a : b; if (next.highStakes) winner.win.push(...cards); else { winner.win.push(cards[av > bv ? 0 : 1]); (av > bv ? b : a).lose.push(cards[av > bv ? 1 : 0]); } next.currentPlayerId = winner.id; }
  if (!a.draw.length || !b.draw.length) next.winnerId = a.win.length > b.win.length ? a.id : b.win.length > a.win.length ? b.id : null;
  if (!next.winnerId && av === bv) next.currentPlayerId = nextPlayer(next);
  next.nextGlyph = action.glyph;
  return next;
}

export { GLYPHS };
