import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameRoom } from './game.js';
import { parseTtsDeck } from './tts.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const rooms = new Map();
const clients = new Map();
const port = Number(process.env.PORT) || 8080;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size });
    let path = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (!path.startsWith(root)) return json(res, 403, { error: 'Forbidden' });
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-cache' });
    res.end(body);
  } catch { json(res, 404, { error: 'Not found' }); }
});

const wss = new WebSocketServer({ server, maxPayload: 5 * 1024 * 1024 });
wss.on('connection', (socket) => {
  const id = crypto.randomUUID();
  socket.on('message', (raw) => {
    try { handle(socket, id, JSON.parse(raw.toString())); }
    catch (error) { send(socket, { type: 'error', message: error.message || 'Invalid request.' }); }
  });
  socket.on('close', () => disconnect(id));
});

function handle(socket, id, message) {
  if (!message || typeof message.type !== 'string') throw new Error('Invalid message.');
  if (message.type === 'join') {
    disconnect(id);
    const code = String(message.code || randomCode()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (code.length < 4) throw new Error('Room codes must be at least four characters.');
    const room = rooms.get(code) || new GameRoom(code);
    rooms.set(code, room); room.join(id, message.name); clients.set(id, { socket, room });
    send(socket, { type: 'joined', playerId: id, code }); broadcast(room); return;
  }
  const entry = clients.get(id);
  if (!entry) throw new Error('Join a room first.');
  const { room } = entry;
  if (message.type === 'import') room.importDeck(parseTtsDeck(message.data));
  else if (message.type === 'shuffle') room.shuffle();
  else if (message.type === 'draw') room.draw(id);
  else if (message.type === 'play') room.play(id, message.cardId, message.x, message.y);
  else if (message.type === 'move') room.move(id, message.cardId, message.x, message.y);
  else if (message.type === 'take') room.take(id, message.cardId);
  else if (message.type === 'flip') room.flip(message.cardId);
  else throw new Error('Unknown action.');
  broadcast(room);
}

function broadcast(room) {
  for (const [playerId, player] of room.players) {
    const socket = clients.get(playerId)?.socket;
    if (socket?.readyState === 1) send(socket, { type: 'state', state: room.viewFor(playerId) });
  }
}
function disconnect(id) {
  const entry = clients.get(id); if (!entry) return;
  entry.room.leave(id); clients.delete(id); broadcast(entry.room);
  if (!entry.room.players.size) rooms.delete(entry.room.code);
}
function send(socket, value) { socket.send(JSON.stringify(value)); }
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function randomCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

server.listen(port, () => console.log(`LPTTS listening on http://localhost:${port}`));
