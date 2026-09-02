import { parseTtsDeck } from './tts.js';
const decoder = new TextDecoder();

export async function importDeckZip(file) {
  if (!file || file.size > 50 * 1024 * 1024) throw new Error('ZIP package must be 50 MB or smaller.');
  const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
  const json = entries.find((e) => /\.json$/i.test(e.name));
  const images = entries.filter((e) => /\.(png|jpe?g|webp)$/i.test(e.name));
  if (!json || images.length < 2) throw new Error('ZIP must contain deck JSON, a front image, and a back image.');
  const face = images.find((e) => /(^|\/)(front|faces?|face-sheet|cards?)[^/]*\.(png|jpe?g|webp)$/i.test(e.name)) || images[0];
  const back = images.find((e) => /(^|\/)(back|backs?|card-back)[^/]*\.(png|jpe?g|webp)$/i.test(e.name) && e !== face) || images.find((e) => e !== face);
  const cards = parseTtsDeck(JSON.parse(decoder.decode(await json.data())), { allowLocalArtwork: true });
  const faceUrl = await dataUrl(face), backUrl = await dataUrl(back);
  return cards.map((card) => ({ ...card, face: faceUrl, back: backUrl }));
}
async function dataUrl(entry) { const type = /\.png$/i.test(entry.name) ? 'image/png' : /\.webp$/i.test(entry.name) ? 'image/webp' : 'image/jpeg'; const bytes = await entry.data(); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return `data:${type};base64,${btoa(binary)}`; }
async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = find(bytes, 0x06054b50, Math.max(0, bytes.length - 0x10016));
  if (end < 0) throw new Error('That file is not a valid ZIP package.');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true), entries = [];
  for (let pos = offset; pos < offset + size && entries.length < count;) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP directory is corrupt.');
    const method = view.getUint16(pos + 10, true), compressed = view.getUint32(pos + 20, true), nameLength = view.getUint16(pos + 28, true), extraLength = view.getUint16(pos + 30, true), commentLength = view.getUint16(pos + 32, true), local = view.getUint32(pos + 42, true), name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength; if (!name || name.endsWith('/')) continue;
    const localName = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true), start = local + 30 + localName + localExtra, raw = bytes.slice(start, start + compressed);
    entries.push({ name, async data() { if (method === 0) return raw; if (method !== 8) throw new Error(`Unsupported ZIP compression for ${name}.`); const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(stream).arrayBuffer()); } });
  }
  return entries;
}
function find(bytes, signature, start) { for (let i = bytes.length - 4; i >= start; i -= 1) if (new DataView(bytes.buffer, bytes.byteOffset + i, 4).getUint32(0, true) === signature) return i; return -1; }
