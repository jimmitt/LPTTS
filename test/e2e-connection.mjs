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
    await host.waitForSelector('#game:not([hidden])');
    await host.click('#connections');
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

    const deck = { ObjectStates: [{ Name: 'DeckCustom', Nickname: 'Test deck', CustomDeck: { 1: { FaceURL: 'https://example.com/faces.jpg', BackURL: 'https://example.com/back.jpg', NumWidth: 3, NumHeight: 1 } }, DeckIDs: [100, 101, 102], ContainedObjects: [{ Name: 'CardCustom', Nickname: 'Ace', CardID: 100 }, { Name: 'CardCustom', Nickname: 'King', CardID: 101 }, { Name: 'CardCustom', Nickname: 'Queen', CardID: 102 }] }] };
    await host.setInputFiles('#tts-file', { name: 'deck.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(deck)) });
    await host.waitForFunction(() => document.querySelector('#deck-label')?.textContent === '3 cards');
    await guest.waitForFunction(() => document.querySelector('#deck-label')?.textContent === '3 cards');
    await guest.click('#deck');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '1');
    await guest.hover('#hand .card');
    await guest.keyboard.down('z');
    await guest.waitForSelector('#card-zoom:not([hidden]) .zoom-preview');
    const zoomMetrics = await guest.locator('#card-zoom').evaluate((overlay) => {
      const box = overlay.querySelector('.zoom-preview').getBoundingClientRect();
      return { height: box.height, viewportHeight: innerHeight, zIndex: Number(getComputedStyle(overlay).zIndex) };
    });
    if (zoomMetrics.height < zoomMetrics.viewportHeight * 0.85 || zoomMetrics.zIndex < 1_000_000) throw new Error('Zoom preview is not large enough or above the app UI.');
    await guest.keyboard.up('z');
    await guest.waitForFunction(() => document.querySelector('#card-zoom')?.hidden);
    await guest.press('#hand .card', 'f');
    await guest.waitForSelector('#hand .card-back');
    const handCardBox = await guest.locator('#hand .card').boundingBox();
    const tableBox = await guest.locator('#table').boundingBox();
    await guest.mouse.move(handCardBox.x + handCardBox.width / 2, handCardBox.y + handCardBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height / 2, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForSelector('#table-cards .card-back');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '0');
    const tableCardBox = await guest.locator('#table-cards .card').boundingBox();
    const handPanelBox = await guest.locator('.hand-panel').boundingBox();
    await guest.mouse.move(tableCardBox.x + tableCardBox.width / 2, tableCardBox.y + tableCardBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(handPanelBox.x + handPanelBox.width / 2, handPanelBox.y + handPanelBox.height / 2, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForSelector('#hand .card-back');
    await guest.waitForFunction(() => document.querySelector('#table-cards')?.children.length === 0);

    const panStart = { x: tableBox.x + tableBox.width / 2, y: tableBox.y + tableBox.height / 2 };
    await guest.mouse.move(panStart.x, panStart.y);
    await guest.mouse.down({ button: 'middle' });
    await guest.mouse.move(panStart.x + 70, panStart.y + 45, { steps: 6 });
    await guest.mouse.up({ button: 'middle' });
    const tableTransform = await guest.locator('#table-surface').evaluate((surface) => surface.style.transform);
    if (!tableTransform.includes('translate(70px, 45px)')) throw new Error(`Middle-button table pan was not applied: ${tableTransform}`);

    await guest.click('#deck');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '2');
    await guest.click('#deck');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '3');
    const stackX = tableBox.x + tableBox.width * .42, stackY = tableBox.y + tableBox.height * .48;
    let handBox = await guest.locator('#hand .card').nth(1).boundingBox();
    await guest.mouse.move(handBox.x + handBox.width / 2, handBox.y + handBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(stackX, stackY, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForFunction(() => document.querySelector('#table-cards')?.children.length === 1);
    handBox = await guest.locator('#hand .card').nth(1).boundingBox();
    const firstCardBox = await guest.locator('#table-cards .card').boundingBox();
    await guest.mouse.move(handBox.x + handBox.width / 2, handBox.y + handBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(firstCardBox.x + firstCardBox.width / 2, firstCardBox.y + firstCardBox.height / 2, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForFunction(() => document.querySelector('.stack-count')?.textContent === '2');

    let stackBox = await guest.locator('#table-cards .card').boundingBox();
    await guest.mouse.move(stackBox.x + stackBox.width / 2, stackBox.y + stackBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(stackBox.x + stackBox.width / 2 + 150, stackBox.y + stackBox.height / 2, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForFunction(() => document.querySelector('#table-cards')?.children.length === 2 && !document.querySelector('.stack-count'));

    const separated = await guest.locator('#table-cards .card').evaluateAll((cards) => cards.map((card) => ({ id: card.dataset.cardId, x: Number(card.dataset.x), box: card.getBoundingClientRect().toJSON() })).sort((a, b) => a.x - b.x));
    const sourceCard = separated[0], movedTop = separated[1];
    await guest.mouse.move(movedTop.box.x + movedTop.box.width / 2, movedTop.box.y + movedTop.box.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(sourceCard.box.x + sourceCard.box.width / 2, sourceCard.box.y + sourceCard.box.height / 2, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForFunction(() => document.querySelector('#table-cards')?.children.length === 1 && document.querySelector('.stack-count')?.textContent === '2');

    stackBox = await guest.locator('#table-cards .card').boundingBox();
    await guest.mouse.move(stackBox.x + stackBox.width / 2, stackBox.y + stackBox.height / 2);
    await guest.mouse.down({ button: 'right' });
    await guest.mouse.move(stackBox.x + stackBox.width / 2 + 120, stackBox.y + stackBox.height / 2 + 25, { steps: 8 });
    await guest.mouse.up({ button: 'right' });
    await guest.waitForTimeout(150);
    const movedStackBox = await guest.locator('#table-cards .card').boundingBox();
    if (await guest.locator('#table-cards .card').count() !== 1 || Math.abs(movedStackBox.x - stackBox.x) < 80) throw new Error('Right-drag did not move the whole stack together.');

    await guest.reload();
    await guest.waitForSelector('#lobby:not([hidden])');
    await guest.waitForSelector('#resume-button:not([hidden])');
    await guest.click('#resume-button');
    await guest.waitForSelector('#game:not([hidden])');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '1');
    console.log('E2E passed: card zoom/flip, hand drag, stack left/right drag, table pan, chat, multiplayer state, and resume');
    await hostContext.close(); await guestContext.close();
  } finally {
    await browser.close(); await server.close();
  }
}

runConnectionTest().catch((error) => { console.error(error); process.exit(1); });
