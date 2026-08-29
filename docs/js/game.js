const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ab6d6', '#c77dff', '#f28482'];

export class GameRoom {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.table = [];
    this.deck = [];
    this.selections = new Map();
    this.selectionScopes = new Map();
    this.selectionGroups = new Map();
    this.objects = [];
    this.background = '';
    this.currentTurn = '';
  }

  static restore(data) {
    if (!data || !Array.isArray(data.players) || !Array.isArray(data.table) || !Array.isArray(data.deck)) {
      throw new Error('Saved table data is invalid.');
    }
    const room = new GameRoom(String(data.code || ''));
    room.players = new Map(data.players.map((player) => [player.id, player]));
    room.table = data.table;
    room.deck = [];
    if (data.deck.length) room.table.push(makePile(data.deck.map((card) => ({ ...card, owner: null, faceUp: false })), { x: 78, y: 72, rotation: 0 }));
    room.selections = new Map(Array.isArray(data.selections) ? data.selections : []);
    room.selectionScopes = new Map(Array.isArray(data.selectionScopes) ? data.selectionScopes : []);
    room.selectionGroups = new Map(Array.isArray(data.selectionGroups) ? data.selectionGroups.map(([id, ids]) => [id, Array.isArray(ids) ? ids : []]) : []);
    room.objects = Array.isArray(data.objects) ? data.objects : [];
    room.background = typeof data.background === 'string' ? data.background : '';
    room.currentTurn = room.players.has(data.currentTurn) ? data.currentTurn : (room.players.keys().next().value || '');
    return room;
  }

  serialize() {
    return { code: this.code, players: [...this.players.values()], table: this.table, deck: this.deck, selections: [...this.selections], selectionScopes: [...this.selectionScopes], selectionGroups: [...this.selectionGroups], objects: this.objects, background: this.background, currentTurn: this.currentTurn };
  }

  join(id, name) {
    if (this.players.size >= 8) throw new Error('This room is full.');
    this.players.set(id, {
      id,
      name: String(name || 'Player').trim().slice(0, 24) || 'Player',
      color: COLORS[this.players.size % COLORS.length],
      hand: []
    });
    if (!this.currentTurn) this.currentTurn = id;
  }

  leave(id) {
    const order = [...this.players.keys()], leavingTurn = this.currentTurn === id, index = order.indexOf(id);
    this.players.delete(id); this.selections.delete(id); this.selectionScopes.delete(id); this.selectionGroups.delete(id);
    if (leavingTurn) {
      this.currentTurn = '';
      for (let step = 1; step <= order.length; step += 1) {
        const candidate = order[(index + step) % order.length];
        if (this.players.has(candidate)) { this.currentTurn = candidate; break; }
      }
    }
  }

  importDeck(cards, playerId = null) {
    if (cards.length > 1000) throw new Error('Decks are limited to 1,000 cards.');
    if (!cards.length) throw new Error('A deck needs at least one card.');
    if (playerId && !this.players.has(playerId)) throw new Error('Player not found.');
    const offset = this.table.length % 5;
    const pile = makePile(cards.map((card) => ({ ...card, owner: null, faceUp: false })), { x: 68 + offset * 3, y: 62 + offset * 2, rotation: 0 });
    this.table.push(pile);
    if (playerId) this.select(playerId, pile.id, 'stack');
    return pile;
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
    this.select(playerId, card.id, targetId ? 'stack' : 'top');
    if (targetId) this.stack(playerId, card.id, targetId);
  }

  move(playerId, cardId, x, y) {
    const card = this.table.find((item) => item.id === cardId);
    if (!card) throw new Error('Card not found.');
    card.x = clamp(x); card.y = clamp(y);
    this.select(playerId, cardId, card.stack?.length ? 'stack' : 'top');
  }

  moveTop(playerId, cardId, x, y) {
    const index = this.table.findIndex((card) => card.id === cardId);
    if (index < 0) throw new Error('Card not found.');
    const pile = this.table[index];
    if (!pile.stack?.length) return this.move(playerId, cardId, x, y);
    const card = this.removeTopCard(index);
    this.table.push({ ...card, x: clamp(x), y: clamp(y), rotation: pile.rotation || 0 });
    this.select(playerId, card.id, 'top');
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

  flipStack(cardId, playerId) {
    const card = this.table.find((item) => item.id === cardId);
    if (!card) throw new Error('Stack is no longer on the table.');
    if (!card.stack?.length) return this.flip(cardId, playerId);
    card.faceUp = !card.faceUp;
    card.stack.forEach((stackedCard) => { stackedCard.faceUp = card.faceUp; });
    this.select(playerId, cardId, 'stack');
  }

  handToggle(playerId, cardId) {
    if (this.table.some(({ id }) => id === cardId)) return this.take(playerId, cardId);
    const player = this.players.get(playerId), handCard = player?.hand.find(({ id }) => id === cardId);
    if (!handCard) throw new Error('Card is no longer available.');
    const players = [...this.players.keys()], playerIndex = players.indexOf(playerId);
    const position = frontPosition(playerIndex, players.length, this.table.length);
    this.play(playerId, cardId, position.x, position.y);
  }

  select(playerId, cardId, scope = 'top') {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    this.selections.delete(playerId); this.selectionScopes.delete(playerId); this.selectionGroups.delete(playerId);
    if (!cardId) return;
    const ownHand = this.players.get(playerId).hand;
    const tableItem = this.table.find(({ id }) => id === cardId);
    const exists = tableItem || this.objects.some(({ id }) => id === cardId) || ownHand.some(({ id }) => id === cardId);
    if (!exists) throw new Error('Object is no longer available.');
    const selectionScope = scope === 'stack' && tableItem?.stack?.length ? 'stack' : 'top';
    for (const [otherPlayer, selectedCard] of this.selections) {
      if (selectedCard === cardId) { this.selections.delete(otherPlayer); this.selectionScopes.delete(otherPlayer); }
    }
    for (const [otherPlayer, selectedIds] of this.selectionGroups) {
      if (otherPlayer !== playerId && selectedIds.includes(cardId)) this.removeFromSelectionGroup(otherPlayer, new Set([cardId]));
    }
    this.selections.set(playerId, cardId); this.selectionScopes.set(playerId, selectionScope);
  }

  selectMany(playerId, objectIds) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const available = new Set([...this.table.map(({ id }) => id), ...this.objects.map(({ id }) => id)]);
    const ids = [...new Set(Array.isArray(objectIds) ? objectIds : [])].filter((id) => available.has(id)).slice(0, 500);
    this.selections.delete(playerId); this.selectionScopes.delete(playerId); this.selectionGroups.delete(playerId);
    if (!ids.length) return;
    const claimed = new Set(ids);
    for (const [otherPlayer, selectedId] of this.selections) {
      if (otherPlayer !== playerId && claimed.has(selectedId)) { this.selections.delete(otherPlayer); this.selectionScopes.delete(otherPlayer); }
    }
    for (const otherPlayer of this.selectionGroups.keys()) if (otherPlayer !== playerId) this.removeFromSelectionGroup(otherPlayer, claimed);
    this.selections.set(playerId, ids[0]); this.selectionScopes.set(playerId, 'top');
    if (ids.length > 1) this.selectionGroups.set(playerId, ids);
  }

  removeFromSelectionGroup(playerId, removedIds) {
    const remaining = (this.selectionGroups.get(playerId) || []).filter((id) => !removedIds.has(id));
    if (remaining.length > 1) this.selectionGroups.set(playerId, remaining);
    else this.selectionGroups.delete(playerId);
    if (!remaining.length) { this.selections.delete(playerId); this.selectionScopes.delete(playerId); }
    else if (!remaining.includes(this.selections.get(playerId))) this.selections.set(playerId, remaining[0]);
  }

  nextTurn(playerId) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    if (this.currentTurn !== playerId) throw new Error('Only the current player can end the turn.');
    const order = [...this.players.keys()], index = order.indexOf(playerId);
    this.currentTurn = order[(index + 1) % order.length];
    this.select(playerId, null);
    return this.currentTurn;
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

  moveObject(playerId, objectId, x, y, roll = false) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const object = this.objects.find(({ id }) => id === objectId);
    if (!object) throw new Error('Object is no longer on the table.');
    object.x = clamp(x); object.y = clamp(y);
    if (roll && object.type === 'die') this.randomizeDie(object);
    this.select(playerId, objectId);
  }

  rollDie(playerId, objectId) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const die = this.objects.find(({ id, type }) => id === objectId && type === 'die');
    if (!die) throw new Error('Die is no longer on the table.');
    this.randomizeDie(die);
    this.select(playerId, objectId);
    return die.value;
  }

  rollDice(playerId, objectIds) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const ids = new Set(Array.isArray(objectIds) ? objectIds : []), dice = this.objects.filter(({ id, type }) => type === 'die' && ids.has(id));
    if (!dice.length) throw new Error('Select at least one die.');
    dice.forEach((die) => this.randomizeDie(die));
    const current = this.selectionGroups.get(playerId) || [], rolledIds = dice.map(({ id }) => id);
    if (!rolledIds.every((id) => current.includes(id))) this.selectMany(playerId, rolledIds);
  }

  moveSelection(playerId, anchorId, x, y, rollDice = false, objectIds = []) {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    let ids = this.selectionGroups.get(playerId) || [];
    if ((ids.length < 2 || !ids.includes(anchorId)) && objectIds.length > 1) { this.selectMany(playerId, objectIds); ids = this.selectionGroups.get(playerId) || []; }
    if (ids.length < 2 || !ids.includes(anchorId)) throw new Error('That group is no longer selected.');
    const items = [...this.table, ...this.objects], anchor = items.find(({ id }) => id === anchorId);
    if (!anchor) throw new Error('Selected object is no longer on the table.');
    const dx = clamp(x) - anchor.x, dy = clamp(y) - anchor.y, selected = new Set(ids);
    this.table.forEach((card) => { if (selected.has(card.id)) { card.x = clamp(card.x + dx); card.y = clamp(card.y + dy); } });
    this.objects.forEach((object) => {
      if (!selected.has(object.id)) return;
      object.x = clamp(object.x + dx); object.y = clamp(object.y + dy);
      if (rollDice && object.type === 'die') this.randomizeDie(object);
    });
  }

  randomizeDie(die) {
    die.value = randomRoll(die.sides); die.rotation = Math.floor(Math.random() * 31) - 15;
  }

  destroy(playerId, objectId, scope = 'top') {
    if (!this.players.has(playerId)) throw new Error('Player not found.');
    const objectIndex = this.objects.findIndex(({ id }) => id === objectId);
    if (objectIndex >= 0) {
      this.objects.splice(objectIndex, 1); this.clearSelectionsFor(new Set([objectId])); return;
    }
    const tableIndex = this.table.findIndex(({ id }) => id === objectId);
    if (tableIndex >= 0) {
      const pile = this.table[tableIndex];
      if (scope === 'stack' || !pile.stack?.length) {
        const ids = new Set(pileCards(pile).map(({ id }) => id));
        this.table.splice(tableIndex, 1); this.clearSelectionsFor(ids); return;
      }
      const removed = this.removeTopCard(tableIndex); this.clearSelectionsFor(new Set([removed.id])); return;
    }
    const player = this.players.get(playerId), handIndex = player?.hand.findIndex(({ id }) => id === objectId) ?? -1;
    if (handIndex >= 0) {
      player.hand.splice(handIndex, 1); this.clearSelectionsFor(new Set([objectId])); return;
    }
    throw new Error('Object is no longer available.');
  }

  clearSelectionsFor(ids) {
    for (const [selectedPlayer, selectedId] of this.selections) {
      if (ids.has(selectedId)) { this.selections.delete(selectedPlayer); this.selectionScopes.delete(selectedPlayer); }
    }
    for (const playerId of this.selectionGroups.keys()) this.removeFromSelectionGroup(playerId, ids);
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
    this.select(playerId, pile.id, 'stack');
  }

  stackTop(playerId, sourceId, targetId) {
    if (sourceId === targetId) throw new Error('Choose a different card to make a stack.');
    const sourceIndex = this.table.findIndex((card) => card.id === sourceId);
    if (sourceIndex < 0 || !this.table.some((card) => card.id === targetId)) throw new Error('Card is no longer on the table.');
    const source = this.table[sourceIndex];
    if (!source.stack?.length) {
      this.stack(playerId, sourceId, targetId); this.select(playerId, sourceId, 'top'); return;
    }
    const card = this.removeTopCard(sourceIndex);
    this.table.push({ ...card, x: source.x, y: source.y, rotation: source.rotation || 0 });
    this.stack(playerId, card.id, targetId); this.select(playerId, card.id, 'top');
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
    this.select(playerId, this.table[index].id, 'stack');
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
    this.select(playerId, cards.length ? this.table[index].id : null, 'stack');
  }

  spreadStack(playerId, cardId, direction, spacing) {
    const index = this.table.findIndex((card) => card.id === cardId);
    if (index < 0) throw new Error('Stack is no longer on the table.');
    const current = this.table[index], cards = pileCards(current);
    if (cards.length < 2) throw new Error('This card is not a stack.');
    if (!['vertical', 'horizontal'].includes(direction)) throw new Error('Choose a valid stack layout.');
    const requested = Math.max(.25, Math.min(20, Number(spacing) || 3));
    const axis = direction === 'vertical' ? 'y' : 'x', availablePositive = 97 - current[axis], availableNegative = current[axis] - 3;
    const sign = availablePositive >= availableNegative ? 1 : -1;
    const step = Math.min(requested, Math.max(0.25, Math.max(availablePositive, availableNegative) / (cards.length - 1)));
    const laidOut = cards.map((card, cardIndex) => makePile([card], {
      x: direction === 'horizontal' ? clamp(current.x + sign * step * cardIndex) : current.x,
      y: direction === 'vertical' ? clamp(current.y + sign * step * cardIndex) : current.y,
      rotation: current.rotation || 0
    }));
    this.table.splice(index, 1, ...laidOut);
    this.select(playerId, laidOut[laidOut.length - 1].id, 'top');
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
      selectionScopes: [...this.selectionScopes],
      selectionGroups: [...this.selectionGroups],
      objects: this.objects,
      background: this.background,
      currentTurn: this.currentTurn,
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
function frontPosition(playerIndex, playerCount, tableCount) {
  const position = dealPosition(playerIndex, playerCount, 0, 1);
  position.x = clamp(position.x + ((tableCount % 5) - 2) * 3);
  return position;
}
