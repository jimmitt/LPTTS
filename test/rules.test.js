import test from 'node:test';
import assert from 'node:assert/strict';
import { createHundredMilesGame, startHundredMiles, hundredMilesAction, createWarGame, startWar, warAction } from '../docs/js/rules.js';

const card = (values) => ({ metadata: { glyphs: values } });
test('100 Miles rejects self-targeting and applies selected glyph parity', () => {
  let state = createHundredMilesGame([{ id: 'a' }, { id: 'b' }], { a: [card({ circle: 4 })], b: [] });
  state = startHundredMiles(state, 'a', 'a');
  assert.throws(() => hundredMilesAction(state, { type: 'draw', playerId: 'a', glyph: 'circle', parity: 'even', effect: 'attack', targetId: 'a' }), /another player/);
  state = hundredMilesAction(state, { type: 'draw', playerId: 'a', glyph: 'circle', parity: 'even' });
  assert.equal(state.players[0].miles, 4);
});
test('War sends tied cards to both lose piles', () => {
  let state = createWarGame([{ id: 'a' }, { id: 'b' }], { a: [card({ sun: 5 })], b: [card({ sun: 5 })] });
  state = startWar(state, 'a', 'a', 'sun');
  state = warAction(state, { type: 'play', playerId: 'a', glyph: 'sun' });
  assert.equal(state.players[0].lose.length, 1); assert.equal(state.players[1].lose.length, 1);
});
