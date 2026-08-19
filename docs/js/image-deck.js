export function createImageDeck({ name, face, back, columns, rows, count }) {
  const width = integer(columns, 'Columns', 1, 20);
  const height = integer(rows, 'Rows', 1, 20);
  const total = integer(count, 'Card count', 1, 400);
  if (total > width * height) throw new Error(`Card count cannot exceed the ${width * height} spaces in the sheet.`);
  if (!isImageData(face) || !isImageData(back)) throw new Error('Choose both front and back image files.');
  const deckName = String(name || 'Custom deck').trim().slice(0, 60) || 'Custom deck';
  return Array.from({ length: total }, (_, index) => ({
    id: newId(), name: `${deckName} ${index + 1}`, description: '', face, back,
    sheet: { index, width, height, uniqueBack: false }
  }));
}

function integer(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return number;
}

function isImageData(value) { return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/.test(value); }
function newId() { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
