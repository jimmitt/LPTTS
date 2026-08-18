// Browser-side TTS parser; imports never leave the host's device.
export function parseTtsDeck(input) {
  const save = typeof input === 'string' ? JSON.parse(input) : input;
  const cards = [];
  const safe = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  const walk = (state, inherited = {}) => {
    if (!state || typeof state !== 'object') return;
    const decks = { ...inherited, ...(state.CustomDeck || {}) };
    if (state.Name === 'Card' || state.Name === 'CardCustom') {
      const cardId = Number(state.CardID || 0), deckId = Math.floor(cardId / 100), index = cardId % 100;
      const custom = decks[deckId] || {};
      cards.push({ id: crypto.randomUUID(), name: String(state.Nickname || `Card ${index + 1}`).slice(0,120), description: String(state.Description || '').slice(0,500), face:safe(custom.FaceURL), back:safe(custom.BackURL), sheet:{index,width:Number(custom.NumWidth)||1,height:Number(custom.NumHeight)||1,uniqueBack:Boolean(custom.UniqueBack)} });
      return;
    }
    for (const child of state.ContainedObjects || []) walk(child, decks);
  };
  for (const state of save?.ObjectStates || []) walk(state);
  if (!cards.length) throw new Error('No cards found in that TTS file.');
  return cards;
}
