import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandardDeck } from '../docs/js/standard-deck.js';

test('creates a complete standard 52-card deck', () => {
  const cards = createStandardDeck();
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards.map(({ id }) => id)).size, 52);
  assert.equal(new Set(cards.map(({ name }) => name)).size, 52);
  assert.deepEqual(new Set(cards.map(({ standard }) => standard.suit)), new Set(['♣', '♦', '♥', '♠']));
  assert.equal(cards.some(({ name }) => name === 'Ace of Spades'), true);
  assert.equal(cards.some(({ name }) => name === 'King of Hearts'), true);
});
