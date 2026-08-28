import { chromium } from '/home/james/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { createStaticServer } from './server.js';

const RELAY_URL = 'https://api.msyumyum.com/lptts.php';

function createMockRelay() {
  const rooms = new Map(), participants = new Map();
  let nextEvent = 1, nextParticipant = 1;
  const token = () => `test-token-${nextParticipant}-${'x'.repeat(24)}`;
  const addEvent = (room, sender, type, data, target = null) => {
    const event = { id: nextEvent++, sender, type, data, createdAt: Date.now(), target };
    room.events.push(event);
    return event;
  };
  return async (route) => {
    const body = route.request().postDataJSON();
    let result;
    if (body.op === 'create') {
      const code = 'ROOM42', id = `player-${nextParticipant++}`, auth = token();
      const room = { code, hostId: id, events: [] };
      rooms.set(code, room); participants.set(auth, { id, room, name: body.name, role: 'host' });
      result = { ok: true, code, participantId: id, token: auth, cursor: 0 };
    } else if (body.op === 'join') {
      const room = rooms.get(body.code), id = `player-${nextParticipant++}`, auth = token();
      if (!room) result = { ok: false, message: 'Table code was not found.' };
      else {
        participants.set(auth, { id, room, name: body.name, role: 'guest' });
        const event = addEvent(room, id, 'join', { id, name: body.name }, room.hostId);
        result = { ok: true, code: room.code, participantId: id, token: auth, cursor: event.id };
      }
    } else {
      const participant = participants.get(body.token);
      if (!participant) result = { ok: false, message: 'Session is not authorized.' };
      else if (body.op === 'send') {
        for (const message of body.messages) {
          const target = message.target === 'host' ? participant.room.hostId : (message.target || null);
          const data = message.type === 'chat' ? { ...message.data, name: participant.name } : message.data;
          addEvent(participant.room, participant.id, message.type, data, target);
        }
        result = { ok: true };
      } else if (body.op === 'poll') {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const events = participant.room.events.filter((event) => event.id > body.since && (!event.target || event.target === participant.id)).map(({ target, ...event }) => event);
        result = { ok: true, events, cursor: events.at(-1)?.id || body.since };
      } else result = { ok: false, message: 'Unsupported test operation.' };
    }
    await route.fulfill({ status: result.ok ? 200 : 403, contentType: 'application/json', body: JSON.stringify(result) });
  };
}

async function runConnectionTest() {
  const server = await createStaticServer();
  const browser = await chromium.launch({ headless: true });
  const relay = createMockRelay();
  try {
    const hostContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const guestContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await hostContext.route(RELAY_URL, relay);
    await guestContext.route(RELAY_URL, relay);
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    for (const [name, page] of [['host', host], ['guest', guest]]) {
      page.on('pageerror', (error) => console.error(`${name} page error:`, error));
      await page.goto(server.url);
    }

    await host.fill('#name', 'Alice');
    await host.click('#host-button');
    await host.waitForSelector('#connect-dialog[open]');
    const code = await host.inputValue('#room-code');
    if (code !== 'ROOM42') throw new Error(`Unexpected room code: ${code}`);

    await guest.fill('#name', 'Bob');
    await guest.click('#join-button');
    await guest.fill('#join-code', code);
    await guest.click('#join-room');
    await host.waitForFunction(() => document.querySelector('#player-count')?.textContent === '2');
    await guest.waitForFunction(() => document.querySelector('#player-count')?.textContent === '2');

    await host.click('#chat-toggle');
    await guest.click('#chat-toggle');
    await host.fill('#chat-input', 'Welcome to the table');
    await host.click('#chat-form button');
    await guest.waitForFunction(() => document.querySelector('#chat-messages')?.textContent.includes('Welcome to the table'));
    await guest.click('#chat-minimize');
    await host.fill('#chat-input', 'Second message');
    await host.click('#chat-form button');
    await guest.waitForSelector('#chat-toggle.unread');

    const deck = { ObjectStates: [{ Name: 'DeckCustom', Nickname: 'Test deck', CustomDeck: { 1: { FaceURL: 'https://example.com/faces.jpg', BackURL: 'https://example.com/back.jpg', NumWidth: 1, NumHeight: 1 } }, DeckIDs: [100], ContainedObjects: [{ Name: 'CardCustom', Nickname: 'Ace', CardID: 100 }] }] };
    await host.setInputFiles('#tts-file', { name: 'deck.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(deck)) });
    await host.waitForFunction(() => document.querySelector('#deck-label')?.textContent === '1 cards');
    await guest.waitForFunction(() => document.querySelector('#deck-label')?.textContent === '1 cards');
    await guest.click('#deck');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '1');
    await guest.hover('#hand .card');
    await guest.keyboard.down('z');
    await guest.waitForSelector('#card-zoom:not([hidden]) .zoom-preview');
    await guest.keyboard.up('z');
    await guest.waitForFunction(() => document.querySelector('#card-zoom')?.hidden);
    await guest.press('#hand .card', 'f');
    await guest.waitForSelector('#hand .card-back');

    await guest.reload();
    await guest.waitForSelector('#lobby:not([hidden])');
    await guest.waitForSelector('#resume-button:not([hidden])');
    await guest.click('#resume-button');
    await guest.waitForSelector('#game:not([hidden])');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '1');
    console.log('E2E passed: room join, private state, Z zoom, F flip, chat, action relay, and resume');
    await hostContext.close(); await guestContext.close();
  } finally {
    await browser.close(); await server.close();
  }
}

runConnectionTest().catch((error) => { console.error(error); process.exit(1); });
