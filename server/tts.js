const safeUrl = (value) => {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

const sheetCard = (state, parentDeck = {}) => {
  const cardId = Number(state.CardID ?? 0);
  const deckId = Math.floor(cardId / 100);
  const index = cardId % 100;
  const custom = state.CustomDeck?.[deckId] ?? parentDeck?.[deckId] ?? {};
  const width = Math.max(1, Number(custom.NumWidth) || 1);
  const height = Math.max(1, Number(custom.NumHeight) || 1);
  return {
    id: crypto.randomUUID(),
    name: String(state.Nickname || state.Name || `Card ${index + 1}`).slice(0, 120),
    description: String(state.Description || '').slice(0, 500),
    face: safeUrl(custom.FaceURL),
    back: safeUrl(custom.BackURL),
    sheet: { index, width, height, uniqueBack: Boolean(custom.UniqueBack) }
  };
};

export function parseTtsDeck(input) {
  const save = typeof input === 'string' ? JSON.parse(input) : input;
  if (!save || typeof save !== 'object') throw new Error('The file is not valid JSON.');
  const cards = [];

  const walk = (state, inheritedDeck = {}) => {
    if (!state || typeof state !== 'object') return;
    const customDeck = { ...inheritedDeck, ...(state.CustomDeck || {}) };
    if (state.Name === 'Card' || state.Name === 'CardCustom') {
      cards.push(sheetCard(state, customDeck));
      return;
    }
    if (Array.isArray(state.ContainedObjects)) {
      for (const child of state.ContainedObjects) walk(child, customDeck);
    }
  };

  for (const state of save.ObjectStates || []) walk(state);
  if (!cards.length) throw new Error('No cards were found in this TTS save/object file.');
  if (cards.length > 1000) throw new Error('Decks are limited to 1,000 cards.');
  return cards;
}
