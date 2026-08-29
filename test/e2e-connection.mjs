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

    if (await host.title() !== 'gametable.lol — Game night, anywhere') throw new Error('The gametable.lol landing title is missing.');
    const landingMetrics = await host.evaluate(() => {
      const nav = document.querySelector('.landing-nav').getBoundingClientRect(), hostButton = document.querySelector('#host-button').getBoundingClientRect(), joinButton = document.querySelector('#join-button').getBoundingClientRect();
      return { heading: document.querySelector('.landing-hero h1')?.textContent, navTop: nav.top, hostTop: hostButton.top, joinTop: joinButton.top, horizontalOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    if (!landingMetrics.heading?.includes('Your game night') || landingMetrics.navTop > 5 || landingMetrics.hostTop > 100 || landingMetrics.joinTop > 100 || landingMetrics.horizontalOverflow > 1) throw new Error(`Desktop landing layout is invalid: ${JSON.stringify(landingMetrics)}`);
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } }), mobile = await mobileContext.newPage();
    await mobile.goto(server.url);
    const mobileMetrics = await mobile.evaluate(() => ({ hostTop: document.querySelector('#host-button').getBoundingClientRect().top, joinTop: document.querySelector('#join-button').getBoundingClientRect().top, horizontalOverflow: document.documentElement.scrollWidth - innerWidth, logo: document.querySelector('.landing-logo')?.textContent.trim() }));
    if (mobileMetrics.hostTop > 90 || mobileMetrics.joinTop > 90 || mobileMetrics.horizontalOverflow > 1 || !mobileMetrics.logo.includes('gametable.lol')) throw new Error(`Mobile landing layout is invalid: ${JSON.stringify(mobileMetrics)}`);
    await mobileContext.close();

    await host.fill('#name', 'Alice');
    await host.click('#host-button');
    await host.waitForSelector('#game:not([hidden])');
    await host.click('#connections');
    await host.waitForSelector('#connect-dialog[open]');
    const code = await host.inputValue('#room-code');
    if (code !== 'ROOM42') throw new Error(`Unexpected room code: ${code}`);
    await host.click('[data-close="connect-dialog"]');

    await guest.fill('#name', 'Bob');
    await guest.click('#join-button');
    await guest.fill('#join-code', code);
    await guest.click('#join-room');
    await host.waitForFunction(() => document.querySelector('#player-count')?.textContent === '2');
    await guest.waitForFunction(() => document.querySelector('#player-count')?.textContent === '2');
    if (!await host.locator('#end-turn').isEnabled() || await guest.locator('#end-turn').isEnabled()) throw new Error('The host should have the first turn.');
    await host.click('#end-turn');
    await guest.waitForFunction(() => !document.querySelector('#end-turn')?.disabled);
    if (await guest.locator('.player-row.current-turn .player-name').textContent() !== 'Bob (you)') throw new Error('Turn indicator did not advance to the guest.');
    await guest.click('#end-turn');
    await host.waitForFunction(() => !document.querySelector('#end-turn')?.disabled);

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
    await host.waitForFunction(() => document.querySelector('.stack-count')?.textContent === '3');
    await guest.waitForFunction(() => document.querySelector('.stack-count')?.textContent === '3');
    if (await guest.locator('#deck').count()) throw new Error('The dedicated draw pile is still visible.');
    await guest.hover('#table-cards .card-stack');
    await guest.keyboard.press('h');
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
    await guest.waitForSelector('#hand .card-face');
    const handCardBox = await guest.locator('#hand .card').boundingBox();
    const tableBox = await guest.locator('#table').boundingBox();
    await guest.mouse.move(handCardBox.x + handCardBox.width / 2, handCardBox.y + handCardBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height / 2, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForSelector('#table-cards .card-face');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '0');
    await guest.waitForFunction(() => document.querySelector('#table-cards')?.children.length === 2);
    const tableCardBox = await guest.locator('#table-cards .card:not(.card-stack)').boundingBox();
    const handPanelBox = await guest.locator('.hand-panel').boundingBox();
    await guest.mouse.move(tableCardBox.x + tableCardBox.width / 2, tableCardBox.y + tableCardBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(handPanelBox.x + handPanelBox.width / 2, handPanelBox.y + handPanelBox.height / 2, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForSelector('#hand .card-face');
    await guest.waitForFunction(() => document.querySelector('#table-cards')?.children.length === 1 && document.querySelector('.stack-count')?.textContent === '2');

    const panStart = { x: tableBox.x + tableBox.width / 2, y: tableBox.y + tableBox.height / 2 };
    await guest.mouse.move(panStart.x, panStart.y);
    await guest.mouse.down({ button: 'middle' });
    await guest.mouse.move(panStart.x + 70, panStart.y + 45, { steps: 6 });
    await guest.mouse.up({ button: 'middle' });
    const tableTransform = await guest.locator('#table-surface').evaluate((surface) => surface.style.transform);
    if (!tableTransform.includes('translate(70px, 45px)')) throw new Error(`Middle-button table pan was not applied: ${tableTransform}`);

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

    await guest.locator('#table-cards .card-stack').hover();
    await guest.keyboard.press('o');
    await guest.waitForFunction(() => document.querySelector('#table-cards')?.children.length === 2 && !document.querySelector('.stack-count'));
    let layout = await guest.locator('#table-cards .card').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
    if (Math.abs(layout[0].x - layout[1].x) > 3 || layout[1].y <= layout[0].y + 15) throw new Error('First O did not fan the stack down.');
    await guest.keyboard.press('o');
    await guest.waitForTimeout(150);
    layout = await guest.locator('#table-cards .card').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
    if (Math.abs(layout[0].y - layout[1].y) > 3 || layout[1].x >= layout[0].x - 10) throw new Error('Second O did not fan the stack left.');
    await guest.keyboard.press('o');
    await guest.waitForTimeout(150);
    layout = await guest.locator('#table-cards .card').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
    if (Math.abs(layout[0].x - layout[1].x) > 3 || layout[1].y >= layout[0].y - 15) throw new Error('Third O did not fan the stack up.');
    await guest.keyboard.press('o');
    await guest.waitForTimeout(150);
    layout = await guest.locator('#table-cards .card').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
    if (Math.abs(layout[0].y - layout[1].y) > 3 || layout[1].x <= layout[0].x + 10) throw new Error('Fourth O did not fan the stack right.');
    const cascadeTop = layout[1];
    await guest.mouse.move(cascadeTop.x + cascadeTop.width / 2, cascadeTop.y + cascadeTop.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(cascadeTop.x + cascadeTop.width / 2 + 12, cascadeTop.y + cascadeTop.height / 2, { steps: 3 });
    await guest.mouse.move(cascadeTop.x + cascadeTop.width / 2, cascadeTop.y + cascadeTop.height / 2, { steps: 3 });
    await guest.mouse.up();
    await guest.waitForTimeout(150);
    if (await guest.locator('#table-cards .card').count() !== 2) throw new Error('Cards stacked with only about 80% overlap.');
    layout = await guest.locator('#table-cards .card').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()).sort((a, b) => a.y - b.y));
    await guest.mouse.move(layout[1].x + layout[1].width / 2, layout[1].y + layout[1].height / 2);
    await guest.mouse.down();
    await guest.mouse.move(layout[0].x + layout[0].width / 2, layout[0].y + layout[0].height / 2, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForFunction(() => document.querySelector('.stack-count')?.textContent === '2');

    await host.click('#standard-deck-button');
    await guest.waitForFunction(() => [...document.querySelectorAll('.stack-count')].some((badge) => badge.textContent === '52'));
    const standardStack = guest.locator('#table-cards .card-stack').filter({ hasText: '52' });
    await standardStack.hover();
    await guest.keyboard.press('h');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '2');
    const standardCard = guest.locator('#hand .card[aria-label="King of Spades"]');
    await standardCard.hover();
    await guest.keyboard.press('f');
    await standardCard.locator('.standard-card-face').waitFor();

    const importedStack = guest.locator('#table-cards .card-stack').filter({ has: guest.locator('.stack-count:text-is("2")') });
    await importedStack.hover();
    await guest.keyboard.press('o');
    await guest.waitForFunction(() => document.querySelectorAll('#table-cards .card:not(.card-stack)').length === 2);
    const fanBounds = await guest.locator('#table-cards .card:not(.card-stack)').evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
    const fanCenters = fanBounds.map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
    await guest.keyboard.down('Control');
    await guest.mouse.move(Math.min(...fanCenters.map(({ x }) => x)) - 5, Math.min(...fanCenters.map(({ y }) => y)) - 5);
    await guest.mouse.down();
    await guest.mouse.move(Math.max(...fanCenters.map(({ x }) => x)) + 5, Math.max(...fanCenters.map(({ y }) => y)) + 5, { steps: 8 });
    await guest.mouse.up();
    await guest.keyboard.up('Control');
    await guest.waitForFunction(() => document.querySelectorAll('#table-cards .card.selected-card:not(.card-stack)').length === 2);
    await guest.waitForTimeout(350);
    const groupAnchor = await guest.locator('#table-cards .card.selected-card:not(.card-stack)').last().boundingBox();
    const targetStack = guest.locator('#table-cards .card-stack');
    const targetStackBox = await targetStack.boundingBox();
    await guest.mouse.move(groupAnchor.x + groupAnchor.width / 2, groupAnchor.y + groupAnchor.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(targetStackBox.x + targetStackBox.width / 2, targetStackBox.y + targetStackBox.height / 2, { steps: 10 });
    await guest.mouse.up();
    await guest.waitForTimeout(500);
    const groupedStack = await guest.evaluate(() => ({ cards: document.querySelectorAll('#table-cards .card').length, counts: [...document.querySelectorAll('.stack-count')].map((item) => item.textContent), status: document.querySelector('#toast')?.textContent, boxes: [...document.querySelectorAll('#table-cards .card')].map((item) => ({ selected: item.classList.contains('selected-card'), stack: item.classList.contains('card-stack'), box: item.getBoundingClientRect().toJSON() })) }));
    if (groupedStack.cards !== 1 || !groupedStack.counts.includes('53')) throw new Error(`Selected card group did not join the target stack: ${JSON.stringify(groupedStack)}`);

    await host.evaluate(() => { Math.random = () => .99; });
    await host.click('#add-die');
    await host.click('#dice-form button[type="submit"]');
    await guest.waitForFunction(() => document.querySelectorAll('.die').length === 1 && document.querySelectorAll('.die-pips i.active').length === 6);
    let dieBox = await guest.locator('.die').boundingBox();
    const dieTarget = { x: tableBox.x + tableBox.width * .28, y: tableBox.y + tableBox.height * .35 };
    await guest.mouse.move(dieBox.x + dieBox.width / 2, dieBox.y + dieBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(dieTarget.x, dieTarget.y, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForTimeout(150);
    if (await guest.locator('.die-pips i.active').count() !== 6) throw new Error('Left-drag unexpectedly rolled the D6.');
    await host.evaluate(() => { Math.random = () => 0; });
    dieBox = await guest.locator('.die').boundingBox();
    await guest.mouse.move(dieBox.x + dieBox.width / 2, dieBox.y + dieBox.height / 2);
    await guest.mouse.down({ button: 'right' });
    await guest.mouse.move(dieBox.x + dieBox.width / 2 + 45, dieBox.y + dieBox.height / 2 + 10, { steps: 8 });
    await guest.mouse.up({ button: 'right' });
    await guest.waitForFunction(() => document.querySelectorAll('.die-pips i.active').length === 1);

    const singleRollPosition = await guest.locator('.die').evaluate((die) => ({ x: die.dataset.x, y: die.dataset.y }));
    await host.evaluate(() => { Math.random = () => .5; });
    await guest.locator('.die').hover();
    await guest.keyboard.press('s');
    await guest.waitForSelector('.die.rolling-in');
    const singleAnimation = await guest.locator('.die.rolling-in').evaluate((die) => ({ name: getComputedStyle(die).animationName, startX: die.style.getPropertyValue('--roll-start-x') }));
    if (singleAnimation.name !== 'die-roll-onto-table' || !singleAnimation.startX.includes('120vw')) throw new Error('Single-die S roll did not start off-screen with the table-entry animation.');
    await guest.waitForFunction(() => document.querySelectorAll('.die-pips i.active').length === 4 && !document.querySelector('.die.rolling-in'));
    const singleRollLanding = await guest.locator('.die').evaluate((die) => ({ x: die.dataset.x, y: die.dataset.y }));
    if (singleRollLanding.x !== singleRollPosition.x || singleRollLanding.y !== singleRollPosition.y) throw new Error('Animated die did not land at its original table position.');

    await host.evaluate(() => { Math.random = () => .5; });
    await host.click('#add-die');
    await host.click('#dice-form button[type="submit"]');
    await guest.waitForFunction(() => document.querySelectorAll('.die').length === 2);
    let secondDieBox = await guest.locator('.die').nth(1).boundingBox();
    const secondTarget = { x: dieTarget.x + 120, y: dieTarget.y + 15 };
    await guest.mouse.move(secondDieBox.x + secondDieBox.width / 2, secondDieBox.y + secondDieBox.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(secondTarget.x, secondTarget.y, { steps: 8 });
    await guest.mouse.up();
    await guest.waitForTimeout(150);
    const diceBounds = await guest.locator('.die').evaluateAll((dice) => dice.map((die) => die.getBoundingClientRect().toJSON()));
    const selectLeft = Math.min(...diceBounds.map(({ left }) => left)) - 12, selectTop = Math.min(...diceBounds.map(({ top }) => top)) - 12;
    const selectRight = Math.max(...diceBounds.map(({ right }) => right)) + 12, selectBottom = Math.max(...diceBounds.map(({ bottom }) => bottom)) + 12;
    await guest.keyboard.down('Control');
    await guest.mouse.move(selectLeft, selectTop);
    await guest.mouse.down();
    await guest.mouse.move(selectRight, selectBottom, { steps: 8 });
    await guest.mouse.up();
    await guest.keyboard.up('Control');
    await guest.waitForFunction(() => document.querySelectorAll('.die.selected-card').length === 2);
    await host.evaluate(() => { Math.random = () => .33; });
    await guest.keyboard.press('s');
    await guest.waitForFunction(() => document.querySelectorAll('.die.rolling-in').length === 2);
    if (!await guest.locator('.die.rolling-in').evaluateAll((dice) => dice.every((die) => getComputedStyle(die).animationName === 'die-roll-onto-table'))) throw new Error('Selected dice did not animate together.');
    await guest.waitForFunction(() => [...document.querySelectorAll('.die')].every((die) => die.querySelectorAll('.die-pips i.active').length === 2));
    await guest.waitForFunction(() => !document.querySelector('.die.rolling-in'));
    const groupBefore = await guest.locator('.die').evaluateAll((dice) => dice.map((die) => die.getBoundingClientRect().toJSON()));
    await host.evaluate(() => { Math.random = () => .66; });
    await guest.mouse.move(groupBefore[0].x + groupBefore[0].width / 2, groupBefore[0].y + groupBefore[0].height / 2);
    await guest.mouse.down({ button: 'right' });
    await guest.mouse.move(groupBefore[0].x + groupBefore[0].width / 2 + 55, groupBefore[0].y + groupBefore[0].height / 2 + 20, { steps: 8 });
    await guest.mouse.up({ button: 'right' });
    await guest.waitForFunction(() => [...document.querySelectorAll('.die')].every((die) => die.querySelectorAll('.die-pips i.active').length === 4));
    const groupAfter = await guest.locator('.die').evaluateAll((dice) => dice.map((die) => die.getBoundingClientRect().toJSON()));
    if (groupAfter.some((box, index) => Math.abs((box.x - groupBefore[index].x) - 55) > 8)) throw new Error('Right-drag did not move the selected dice together.');

    await guest.click('#trash-object');
    await guest.waitForFunction(() => document.querySelectorAll('.die').length === 0 && document.querySelector('#trash-object')?.title === 'Open trash (2)');
    await guest.click('#trash-object');
    await guest.waitForSelector('#trash-dialog[open] .trash-item');
    if (await guest.locator('#trash-dialog .trash-object-preview').count() !== 2) throw new Error('Deleted dice were not rendered graphically in the trash grid.');
    await guest.locator('#trash-dialog .trash-item').first().click();
    await guest.locator('#trash-dialog .trash-item').nth(1).click();
    if (await guest.locator('#restore-trash-selected').isDisabled()) throw new Error('Trash selection did not enable batch restore.');
    await guest.click('#restore-trash-selected');
    await guest.waitForFunction(() => document.querySelectorAll('.die').length === 2 && document.querySelector('.trash-empty'));
    await guest.click('[data-close="trash-dialog"]');

    const restoredDiceBounds = await guest.locator('.die').evaluateAll((dice) => dice.map((die) => die.getBoundingClientRect().toJSON()));
    const restoredCenters = restoredDiceBounds.map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
    await guest.keyboard.down('Control');
    await guest.mouse.move(Math.min(...restoredCenters.map(({ x }) => x)) - 5, Math.min(...restoredCenters.map(({ y }) => y)) - 5);
    await guest.mouse.down();
    await guest.mouse.move(Math.max(...restoredCenters.map(({ x }) => x)) + 5, Math.max(...restoredCenters.map(({ y }) => y)) + 5, { steps: 8 });
    await guest.mouse.up();
    await guest.keyboard.up('Control');
    await guest.waitForFunction(() => document.querySelectorAll('.die.selected-card').length === 2);
    await guest.keyboard.press('Delete');
    await guest.waitForFunction(() => document.querySelectorAll('.die').length === 0 && document.querySelector('#trash-object')?.title === 'Open trash (2)');
    await guest.click('#trash-object');
    await guest.locator('#trash-dialog .trash-item').first().click();
    await guest.locator('#trash-dialog .trash-item').nth(1).click();
    await guest.click('#restore-trash-selected');
    await guest.waitForFunction(() => document.querySelectorAll('.die').length === 2 && document.querySelector('.trash-empty'));
    await guest.click('[data-close="trash-dialog"]');

    const cardStackBox = await guest.locator('#table-cards .card-stack').boundingBox();
    await guest.mouse.click(cardStackBox.x + cardStackBox.width / 2, cardStackBox.y + cardStackBox.height / 2);
    await guest.click('#trash-object');
    await guest.waitForFunction(() => document.querySelector('.stack-count')?.textContent === '52' && document.querySelector('#trash-object')?.title === 'Open trash (1)');
    await guest.click('#trash-object');
    await guest.waitForSelector('#trash-dialog .trash-card-preview');
    await guest.click('#trash-dialog .trash-item');
    await guest.click('#restore-trash-selected');
    await guest.waitForFunction(() => document.querySelector('.stack-count')?.textContent === '52' && document.querySelectorAll('#table-cards .card').length === 2 && document.querySelector('.trash-empty'));
    await guest.click('[data-close="trash-dialog"]');

    await guest.reload();
    await guest.waitForSelector('#lobby:not([hidden])');
    await guest.waitForSelector('#resume-button:not([hidden])');
    await guest.click('#resume-button');
    await guest.waitForSelector('#game:not([hidden])');
    await guest.waitForFunction(() => document.querySelector('#hand-count')?.textContent === '2');
    console.log('E2E passed: turns, cyclic fans, group stacking/deletion, animated dice rolls, graphical trash restore, pan, chat, and resume');
    await hostContext.close(); await guestContext.close();
  } finally {
    await browser.close(); await server.close();
  }
}

runConnectionTest().catch((error) => { console.error(error); process.exit(1); });
