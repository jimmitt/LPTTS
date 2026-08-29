const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ab6d6', '#c77dff', '#f28482'];

export class GameRoom {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.table = [];
    this.deck = [];
    this.selections = new Map();
    this.objects = [];
    this.background = '';
  }

  static restore(data) {
    if (!data || !Array.isArray(data.players) || !Array.isArray(data.table) || !Array.isArray(data.deck)) {
      throw new Error('Saved table data is invalid.');
    }
    const room = new GameRoom(String(data.code || ''));
    room.players = new Map(data.players.map((player) => [player.id, player]));
    room.table = data.table;
    room.deck = data.deck;
    room.selections = new Map(Array.isArray(data.selections) ? data.selections : []);
    room.objects = Array.isArray(data.objects) ? data.objects : [];
    room.background = typeof data.background === 'string' ? data.background : '';
    return room;
  }

  serialize() {
    return { code: this.code, players: [...this.players.values()], table: this.table, deck: this.deck, selections: [...this.selections], objects: this.objects, background: this.background };
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

  leave(id) { this.players.delete(id); this.selections.delete(id); }

  importDeck(cards) {
    if (cards.length > 1000) throw new Error('Decks are limited to 1,000 cards.');
    this.deck = cards.map((card) => ({ ...card, owner: null }));
    this.selections.clear();
  }

  shuffle(playerId = null) {
    for (let i = this.deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
    if (playerId) this.select(playerId, null);
  }

  draw(playerId) {
    const player = this.players.get(playerId);
    if (!player) throw new Error('Player not found.');
    const card = this.deck.pop();
    if (!card) throw new Error('The deck is empty.');
    player.hand.push({ ...card, owner: playerId });
    this.select(playerId, null);
  }

  play(playerId, cardId, x = 50, y = 50, targetId = null) {
    const player = this.players.get(playerId);
    const index = player?.hand.findIndex((card) => card.id === cardId) ?? -1;
    if (index < 0) throw new Error('That card is not in your hand.');
    if (targetId && !this.table.some((card) => card.id === targetId)) throw new Error('Stack target is no longer on the table.');
    const [card] = player.hand.splice(index, 1);
    this.table.push({ ...card, owner: playerId, x: clamp(x), y: clamp(y), faceUp: card.faceUp !== false, rotation: 0 });
    this.select(playerId, card.id);
    if (targetId) this.stack(playerId, card.id, targetId);
  }

  move(playerId, cardId, x, y) {
    const card = this.table.find((item) => item.id === cardId);
    if (!card) throw new Error('Card not found.');
    card.x = clamp(x); card.y = clamp(y);
    this.select(playerId, cardId);
  }

  take(playerId, cardId) {
    const index = this.table.findIndex((card) => card.id === cardId);
    if (index < 0) throw new Error('Card not found.');
    const player = this.players.get(playerId);
    if (!player) throw new Error('Player not found.');
    const card = this.removeTopCard(index);
    player.hand.push({ ...card, owner: playerId });
    this.select(playerId, card.id);
  }

  flip(cardId, playerId = null) {
    const card = this.table.find((item) => item.id === cardId);
    if (card) {
      card.faceUp = !card.faceUp;
      if (playerId) this.select(playerId, cardId);
      return;
    }
    const handCard = playerId ? this.players.get(playerId)?.hand.find((item) => item.id === cardId) : null;
    if (!handCard) throw new Error('Card not found.');
    handCard.faceUp = handCard.faceUp === false;
    this.select(playerId, cardId);
  }

  select(playerId, cardId) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    this.selections.delete(playerId);
    if (!cardId) return;
    const ownHand = this.players.get(playerId).hand;
    const exists = this.table.some(({ id }) => id === cardId) || this.objects.some(({ id }) => id === cardId) || ownHand.some(({ id }) => id === cardId);
    if (!exists) throw new Error('Object is no longer available.');
    for (const [otherPlayer, selectedCard] of this.selections) {
      if (selectedCard === cardId) this.selections.delete(otherPlayer);
    }
    this.selections.set(playerId, cardId);
  }

  setBackground(playerId, url) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const value = String(url || '').trim();
    if (value && (!/^https:\/\//i.test(value) || value.length > 2048)) throw new Error('Use a valid HTTPS background image URL.');
    this.background = value;
    this.select(playerId, null);
  }

  createDie(playerId, sides = 6, color = '#f4f0e6') {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const allowedSides = [4, 6, 8, 10, 12, 20, 100], sideCount = Number(sides);
    if (!allowedSides.includes(sideCount)) throw new Error('Choose a supported die size.');
    const dieColor = /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : '#f4f0e6';
    const die = {
      id: crypto.randomUUID(), type: 'die', sides: sideCount,
      value: randomRoll(sideCount), color: dieColor,
      x: clamp(68 + Math.random() * 10), y: clamp(67 + Math.random() * 8),
      rotation: Math.floor(Math.random() * 25) - 12, owner: playerId
    };
    this.objects.push(die); this.select(playerId, die.id);
    return die;
  }

  moveObject(playerId, objectId, x, y) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const object = this.objects.find(({ id }) => id === objectId);
    if (!object) throw new Error('Object is no longer on the table.');
    object.x = clamp(x); object.y = clamp(y); this.select(playerId, objectId);
  }

  rollDie(playerId, objectId) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const die = this.objects.find(({ id, type }) => id === objectId && type === 'die');
    if (!die) throw new Error('Die is no longer on the table.');
    die.value = randomRoll(die.sides); die.rotation = Math.floor(Math.random() * 31) - 15;
    this.select(playerId, objectId);
    return die.value;
  }

  destroy(playerId, objectId) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const objectIndex = this.objects.findIndex(({ id }) => id === objectId);
    if (objectIndex >= 0) {
      this.objects.splice(objectIndex, 1); this.clearSelectionsFor(new Set([objectId])); return;
    }
    const tableIndex = this.table.findIndex(({ id }) => id === objectId);
    if (tableIndex >= 0) {
      const ids = new Set(pileCards(this.table[tableIndex]).map(({ id }) => id));
      this.table.splice(tableIndex, 1); this.clearSelectionsFor(ids); return;
    }
    const player = this.players.get(playerId), handIndex = player?.hand.findIndex(({ id }) => id === objectId) ?? -1;
    if (handIndex >= 0) {
      player.hand.splice(handIndex, 1); this.clearSelectionsFor(new Set([objectId])); return;
    }
    throw new Error('Object is no longer available.');
  }

  clearSelectionsFor(ids) {
    for (const [selectedPlayer, selectedId] of this.selections) {
      if (ids.has(selectedId)) this.selections.delete(selectedPlayer);
    }
  }

  stack(playerId, sourceId, targetId) {
    if (sourceId === targetId) throw new Error('Choose a different card to make a stack.');
    const sourceIndex = this.table.findIndex((card) => card.id === sourceId);
    const targetIndex = this.table.findIndex((card) => card.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) throw new Error('Card is no longer on the table.');
    const source = this.table[sourceIndex], target = this.table[targetIndex];
    const cards = [...pileCards(target), ...pileCards(source)];
    const nextTable = this.table.filter((_, index) => index !== sourceIndex && index !== targetIndex);
    const pile = makePile(cards, { x: target.x, y: target.y, rotation: target.rotation || 0 });
    nextTable.push(pile); this.table = nextTable;
    this.select(playerId, pile.id);
  }

  shuffleStack(playerId, cardId) {
    const index = this.table.findIndex((card) => card.id === cardId);
    if (index < 0) throw new Error('Stack is no longer on the table.');
    const current = this.table[index], cards = pileCards(current);
    if (cards.length < 2) throw new Error('This card is not a stack.');
    for (let i = cards.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    this.table[index] = makePile(cards, { x: current.x, y: current.y, rotation: current.rotation || 0 });
    this.select(playerId, this.table[index].id);
  }

  dealStack(playerId, cardId, countEach, destination, faceUp) {
    const index = this.table.findIndex((card) => card.id === cardId);
    if (index < 0) throw new Error('Stack is no longer on the table.');
    const current = this.table[index], cards = pileCards(current);
    if (cards.length < 2) throw new Error('This card is not a stack.');
    const count = Number(countEach);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Enter a valid number of cards per player.');
    if (!['hand', 'table'].includes(destination)) throw new Error('Choose where to deal the cards.');
    const players = [...this.players.values()];
    if (cards.length < count * players.length) throw new Error(`The stack needs ${count * players.length} cards to complete that deal.`);
    const dealtToTable = [];
    for (let round = 0; round < count; round += 1) {
      players.forEach((player, playerIndex) => {
        const card = cards.pop(); card.faceUp = Boolean(faceUp); card.owner = player.id;
        if (destination === 'hand') player.hand.push(card);
        else dealtToTable.push(makePile([card], dealPosition(playerIndex, players.length, round, count)));
      });
    }
    if (cards.length) this.table[index] = makePile(cards, { x: current.x, y: current.y, rotation: current.rotation || 0 });
    else this.table.splice(index, 1);
    this.table.push(...dealtToTable);
    this.select(playerId, cards.length ? this.table[index].id : null);
  }

  removeTopCard(index) {
    const current = this.table[index], cards = pileCards(current), card = cards.pop();
    if (cards.length) this.table[index] = makePile(cards, { x: current.x, y: current.y, rotation: current.rotation || 0 });
    else this.table.splice(index, 1);
    return card;
  }

  viewFor(viewerId) {
    return {
      code: this.code,
      deckCount: this.deck.length,
      deckBack: this.deck.length ? this.deck[this.deck.length - 1].back || '' : '',
      table: this.table,
      selections: [...this.selections],
      objects: this.objects,
      background: this.background,
      players: [...this.players.values()].map((player) => ({
        id: player.id, name: player.name, color: player.color,
        handCount: player.hand.length,
        hand: player.id === viewerId ? player.hand : undefined
      }))
    };
  }
}

function clamp(value) { return Math.max(3, Math.min(97, Number(value) || 50)); }
function randomRoll(sides) { return Math.floor(Math.random() * sides) + 1; }
function pileCards(card) { return [...(card.stack || []).map(cleanCard), cleanCard(card)]; }
function cleanCard(card) { const { stack, x, y, rotation, ...clean } = card; return clean; }
function makePile(cards, position) { const top = { ...cards[cards.length - 1], ...position }; if (cards.length > 1) top.stack = cards.slice(0, -1).map(cleanCard); return top; }
function dealPosition(playerIndex, playerCount, round, count) {
  const angle = Math.PI / 2 + (Math.PI * 2 * playerIndex / playerCount);
  const spread = (round - (count - 1) / 2) * 4;
  return { x: clamp(50 + Math.cos(angle) * 34 + spread), y: clamp(50 + Math.sin(angle) * 32), rotation: 0 };
}
