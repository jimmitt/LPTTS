// Browser-side TTS parser; imports never leave the host's device.
export function parseTtsDeck(input, options = {}) {
  const save = typeof input === 'string' ? JSON.parse(input) : input;
  const cards = [];
  let hasLocalArtwork = false;
  const safe = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  const walk = (state, inherited = {}) => {
    if (!state || typeof state !== 'object') return;
    const decks = { ...inherited, ...(state.CustomDeck || {}) };
    if (state.Name === 'Card' || state.Name === 'CardCustom') {
      const cardId = Number(state.CardID || 0), deckId = Math.floor(cardId / 100), index = cardId % 100;
      const custom = decks[deckId] || {};
      if (/^file:/i.test(custom.FaceURL || '') || /^file:/i.test(custom.BackURL || '')) hasLocalArtwork = true;
      let metadata;
      if (typeof state.GMNotes === 'string' && state.GMNotes.trim()) {
        try {
          const notes = JSON.parse(state.GMNotes);
          metadata = notes?.legendaryProfiles || notes?.metadata || notes;
        } catch { /* GMNotes may contain ordinary text; leave metadata absent. */ }
      } else if (state.metadata && typeof state.metadata === 'object') metadata = state.metadata;
      cards.push({ id: newId(), cardId, name: String(state.Nickname || `Card ${index + 1}`).slice(0,120), description: String(state.Description || '').slice(0,500), face:safe(custom.FaceURL), back:safe(custom.BackURL), sheet:{index,width:Number(custom.NumWidth)||1,height:Number(custom.NumHeight)||1,uniqueBack:Boolean(custom.UniqueBack)}, ...(metadata ? { metadata } : {}) });
      return;
    }
    for (const child of state.ContainedObjects || []) walk(child, decks);
  };
  if (Array.isArray(save?.ObjectStates)) for (const state of save.ObjectStates) walk(state);
  else if (save?.Name) walk(save);
  if (!cards.length) throw new Error('No cards found in that TTS file.');
  if (hasLocalArtwork && !options.allowLocalArtwork) throw new Error('This TTS object uses local file paths. Use “Create image deck” and select its front and back images.');
  return cards;
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
