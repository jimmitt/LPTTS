const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ab6d6', '#c77dff', '#f28482'];

export class GameRoom {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.table = [];
    this.deck = [];
  }

  static restore(data) {
    if (!data || !Array.isArray(data.players) || !Array.isArray(data.table) || !Array.isArray(data.deck)) {
      throw new Error('Saved table data is invalid.');
    }
    const room = new GameRoom(String(data.code || ''));
    room.players = new Map(data.players.map((player) => [player.id, player]));
    room.table = data.table;
    room.deck = data.deck;
    return room;
  }

  serialize() {
    return { code: this.code, players: [...this.players.values()], table: this.table, deck: this.deck };
  }

  join(id, name) {
    if (this.players.size >= 8) throw new Error('This room is full.');
    this.players.set(id, {
      id,
      name: String(name || 'Player').trim().slice(0, 24) || 'Player',
      color: COLORS[this.players.size % COLORS.length],
      hand: []
    });
  }

  leave(id) { this.players.delete(id); }

  importDeck(cards) {
    if (cards.length > 1000) throw new Error('Decks are limited to 1,000 cards.');
    this.deck = cards.map((card) => ({ ...card, owner: null }));
  }

  shuffle() {
    for (let i = this.deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  draw(playerId) {
    const player = this.players.get(playerId);
    if (!player) throw new Error('Player not found.');
    const card = this.deck.pop();
    if (!card) throw new Error('The deck is empty.');
    player.hand.push({ ...card, owner: playerId });
  }

  play(playerId, cardId, x = 50, y = 50) {
    const player = this.players.get(playerId);
    const index = player?.hand.findIndex((card) => card.id === cardId) ?? -1;
    if (index < 0) throw new Error('That card is not in your hand.');
    const [card] = player.hand.splice(index, 1);
    this.table.push({ ...card, owner: playerId, x: clamp(x), y: clamp(y), faceUp: true, rotation: 0 });
  }

  move(playerId, cardId, x, y) {
    const card = this.table.find((item) => item.id === cardId);
    if (!card) throw new Error('Card not found.');
    card.x = clamp(x); card.y = clamp(y);
  }

  take(playerId, cardId) {
    const index = this.table.findIndex((card) => card.id === cardId);
    if (index < 0) throw new Error('Card not found.');
    const [card] = this.table.splice(index, 1);
    this.players.get(playerId)?.hand.push({ ...card, owner: playerId });
  }

  flip(cardId) {
    const card = this.table.find((item) => item.id === cardId);
    if (!card) throw new Error('Card not found.');
    card.faceUp = !card.faceUp;
  }

  viewFor(viewerId) {
    return {
      code: this.code,
      deckCount: this.deck.length,
      deckBack: this.deck.length ? this.deck[this.deck.length - 1].back || '' : '',
      table: this.table,
      players: [...this.players.values()].map((player) => ({
        id: player.id, name: player.name, color: player.color,
        handCount: player.hand.length,
        hand: player.id === viewerId ? player.hand : undefined
      }))
    };
  }
}

function clamp(value) { return Math.max(3, Math.min(97, Number(value) || 50)); }
