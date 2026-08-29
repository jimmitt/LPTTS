const SUITS = [
  { symbol: '♣', name: 'Clubs' },
  { symbol: '♦', name: 'Diamonds' },
  { symbol: '♥', name: 'Hearts' },
  { symbol: '♠', name: 'Spades' }
];
const RANKS = [
  { symbol: 'A', name: 'Ace' }, { symbol: '2', name: '2' }, { symbol: '3', name: '3' },
  { symbol: '4', name: '4' }, { symbol: '5', name: '5' }, { symbol: '6', name: '6' },
  { symbol: '7', name: '7' }, { symbol: '8', name: '8' }, { symbol: '9', name: '9' },
  { symbol: '10', name: '10' }, { symbol: 'J', name: 'Jack' },
  { symbol: 'Q', name: 'Queen' }, { symbol: 'K', name: 'King' }
];

export function createStandardDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({
    id: newId(), name: `${rank.name} of ${suit.name}`, description: '',
    standard: { rank: rank.symbol, suit: suit.symbol }
  })));
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
