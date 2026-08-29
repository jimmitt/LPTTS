import { GameRoom } from './game.js?v=7';
import { parseTtsDeck } from './tts.js';
import { createImageDeck } from './image-deck.js?v=2';
import { createStandardDeck } from './standard-deck.js?v=1';
import { RelaySession } from './relay.js?v=2';

const $ = (selector) => document.querySelector(selector);
const ui = {
  lobby: $('#lobby'), game: $('#game'), hostButton: $('#host-button'), name: $('#name'), status: $('#lobby-status'),
  players: $('#players'), playerCount: $('#player-count'), connections: $('#connections'), connection: $('#connection'),
  tableCards: $('#table-cards'), tableObjects: $('#table-objects'), table: $('#table'), tableSurface: $('#table-surface'), tableBoard: $('#table-board'), empty: $('#empty-table'),
  hand: $('#hand'), handCount: $('#hand-count'), file: $('#tts-file'),
  toast: $('#toast'), dialog: $('#connect-dialog'), hostPanel: $('#connect-host'), guestPanel: $('#connect-guest')
};
let role = '', playerId = '', state, room, relay;
let savedRelay;
let hoveredCard = null, hoveredObject = null, zoomHeld = false;
let pendingDealCardId = '';
let tableZoom = 1, tablePanX = 0, tablePanY = 0;
const remotePlayers = new Set();
const seenChat = new Set();
const HOST_STATE_KEY = 'lptts-host-state-v1';
const GUEST_STATE_KEY = 'lptts-guest-state-v1';

ui.name.value = readStoredName();
window.lpttsReady = true;
ui.hostButton.addEventListener('click', hostTable);
$('#resume-button').addEventListener('click', resumeSession);
$('#join-button').addEventListener('click', openJoin);
$('#join-room').addEventListener('click', joinTable);
ui.connections.addEventListener('click', showInvite);
$('#copy-room-code').addEventListener('click', () => copy($('#room-code').value, 'Table code copied'));
$('#copy-room-link').addEventListener('click', () => copy($('#room-link').value, 'Invite link copied'));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
$('#help').addEventListener('click', () => $('#help-dialog').showModal());
$('#import-button').addEventListener('click', () => role === 'host' ? ui.file.click() : toast('Only the host can import a deck', true));
$('#standard-deck-button').addEventListener('click', addStandardDeck);
$('#image-deck-button').addEventListener('click', () => role === 'host' ? $('#image-deck-dialog').showModal() : toast('Only the host can create a deck', true));
$('#image-deck-form').addEventListener('submit', createUploadedDeck);
$('#face-file').addEventListener('change', updateImageSummary);
$('#back-file').addEventListener('change', updateImageSummary);
ui.file.addEventListener('change', importDeck);
$('#table').addEventListener('pointerdown', clearSelectionFromTable);
$('#table').addEventListener('mousedown', panTable);
$('#table').addEventListener('auxclick', (event) => { if (event.button === 1) event.preventDefault(); });
$('#table').addEventListener('wheel', zoomTable, { passive: false });
$('#deal-form').addEventListener('submit', submitDeal);
$('#add-die').addEventListener('click', () => $('#dice-dialog').showModal());
$('#dice-form').addEventListener('submit', createDie);
$('#trash-object').addEventListener('click', destroySelectedObject);
$('#background-button').addEventListener('click', openBackgroundDialog);
$('#background-form').addEventListener('submit', applyBackground);
$('#remove-background').addEventListener('click', removeBackground);
$('#chat-toggle').addEventListener('click', toggleChat);
$('#chat-minimize').addEventListener('click', toggleChat);
$('#chat-form').addEventListener('submit', sendChat);
document.addEventListener('keydown', cardKeyDown);
document.addEventListener('keyup', cardKeyUp);
window.addEventListener('blur', hideCardZoom);
prepareSavedSession();
if (codeFromUrl()) openJoin();

function relayHandlers() { return { event: handleEvent, status: updateConnectionStatus }; }

async function hostTable() {
  ui.status.textContent = 'Opening table…';
  ui.hostButton.disabled = true;
  try {
    saveName();
    relay = await RelaySession.create(cleanName(), relayHandlers());
    role = 'host'; playerId = relay.participantId;
    room = new GameRoom(relay.code); room.join(playerId, cleanName());
    enterGame(); updateHost(); relay.start();
    toast(`Table ${relay.code} is ready`);
  } catch (error) {
    ui.status.textContent = `Could not open the table: ${error.message}`;
    ui.hostButton.disabled = false;
  }
}

function openJoin() {
  saveName(); ui.hostPanel.hidden = true; ui.guestPanel.hidden = false;
  $('#connect-title').textContent = 'Join a table';
  $('#join-code').value = codeFromUrl();
  $('#connect-status').textContent = 'Enter the six-character table code from the host.';
  ui.dialog.showModal();
}

async function joinTable() {
  const button = $('#join-room'); button.disabled = true;
  $('#connect-status').textContent = 'Joining table…';
  try {
    saveName();
    relay = await RelaySession.join($('#join-code').value, cleanName(), relayHandlers());
    role = 'guest'; playerId = relay.participantId; state = undefined;
    ui.dialog.close(); enterGame(); relay.start();
  } catch (error) { $('#connect-status').textContent = error.message; }
  finally { button.disabled = false; }
}

function showInvite() {
  if (role !== 'host') return toast(`Table code: ${relay?.code || state?.code || ''}`);
  ui.hostPanel.hidden = false; ui.guestPanel.hidden = true;
  $('#connect-title').textContent = 'Invite players';
  $('#room-code').value = relay.code;
  $('#room-link').value = `${location.origin}${location.pathname}?room=${relay.code}`;
  $('#connect-status').textContent = 'Share the table code or link. Up to seven players can join.';
  if (!ui.dialog.open) ui.dialog.showModal();
}

async function handleEvent(event) {
  const data = event.data || {};
  if (event.type === 'shutdown') { endTable(data.message || 'This table was closed by an administrator.'); return; }
  if (event.type === 'chat') { addChat({ ...data, eventId: event.id }); return; }
  if (role === 'host') {
    if (event.type === 'join') {
      if (!room.players.has(data.id)) room.join(data.id, data.name);
      remotePlayers.add(data.id); updateHost();
      if (ui.dialog.open && !ui.hostPanel.hidden) ui.dialog.close();
      toast(`${data.name} joined`);
    } else if (event.type === 'action') applyHostAction(event.sender, data.action, data.body || {});
    else if (event.type === 'leave') { room.leave(event.sender); remotePlayers.delete(event.sender); updateHost(); }
    return;
  }
  if (event.type === 'welcome') playerId = data.playerId || playerId;
  if (event.type === 'state') { state = data.state; saveGuestState(); render(); }
  if (event.type === 'error') toast(data.message || 'The host rejected that action.', true);
}

function updateConnectionStatus(status, error) {
  if (ui.game.hidden) return;
  if (status === 'connected') ui.connection.textContent = role === 'host' ? 'Relay online · hosting' : 'Relay online';
  if (status === 'reconnecting') ui.connection.textContent = 'Reconnecting…';
  if (status === 'expired') { ui.connection.textContent = 'Table expired'; toast(error?.message || 'This table expired.', true); }
}

function action(type, body = {}) {
  if (role === 'host') applyHostAction(playerId, type, body);
  else if (relay) relay.send({ type: 'action', target: 'host', data: { action: type, body } }).catch(networkError);
  else toast('Not connected to the host', true);
}

function applyHostAction(actor, type, body) {
  try {
    if (type === 'draw') room.draw(actor);
    else if (type === 'shuffle') room.shuffle(actor);
    else if (type === 'play') room.play(actor, body.cardId, body.x, body.y, body.targetId || null);
    else if (type === 'take') room.take(actor, body.cardId);
    else if (type === 'flip') room.flip(body.cardId, actor);
    else if (type === 'flipStack') room.flipStack(body.cardId, actor);
    else if (type === 'hand') room.handToggle(actor, body.cardId);
    else if (type === 'move') room.move(actor, body.cardId, body.x, body.y);
    else if (type === 'moveTop') room.moveTop(actor, body.cardId, body.x, body.y);
    else if (type === 'select') room.select(actor, body.cardId || null, body.scope || 'top');
    else if (type === 'stack') room.stack(actor, body.sourceId, body.targetId);
    else if (type === 'stackTop') room.stackTop(actor, body.sourceId, body.targetId);
    else if (type === 'shuffleStack') room.shuffleStack(actor, body.cardId);
    else if (type === 'dealStack') room.dealStack(actor, body.cardId, body.countEach, body.destination, body.faceUp);
    else if (type === 'createDie') room.createDie(actor, body.sides, body.color);
    else if (type === 'moveObject') room.moveObject(actor, body.objectId, body.x, body.y);
    else if (type === 'rollDie') room.rollDie(actor, body.objectId);
    else if (type === 'destroy') room.destroy(actor, body.objectId, body.scope || 'top');
    else if (type === 'background') {
      if (actor !== playerId) throw new Error('Only the host can change the table background.');
      room.setBackground(actor, body.url);
    }
    else throw new Error('Unknown action.');
    updateHost();
  } catch (error) {
    if (actor === playerId) toast(error.message, true);
    else relay.send({ type: 'error', target: actor, data: { message: error.message } }).catch(networkError);
  }
}

function updateHost() {
  state = room.viewFor(playerId); render(); saveHostState();
  relay.snapshot(room.viewFor(null)).catch(networkError);
  for (const id of remotePlayers) {
    if (!room.players.has(id)) continue;
    relay.send([
      { type: 'welcome', target: id, data: { playerId: id } },
      { type: 'state', target: id, data: { state: room.viewFor(id) } }
    ]).catch(networkError);
  }
}

async function importDeck() {
  try { const cards = parseTtsDeck(await ui.file.files[0].text()); room.importDeck(cards, playerId); updateHost(); toast(`Placed a ${cards.length}-card stack`); }
  catch (error) { toast(error.message, true); }
  finally { ui.file.value = ''; }
}

async function createUploadedDeck(event) {
  event.preventDefault();
  const status = $('#image-deck-status'); status.textContent = 'Preparing images…';
  try {
    const faceFile = $('#face-file').files[0], backFile = $('#back-file').files[0];
    if (!faceFile || !backFile) throw new Error('Choose both front and back images.');
    if (faceFile.size > 12 * 1024 * 1024 || backFile.size > 12 * 1024 * 1024) throw new Error('Each image must be 12 MB or smaller.');
    const upload = async (file, label) => {
      const result = await relay.upload(file, (progress, attempt) => { status.textContent = `Uploading ${label}… ${Math.round(progress * 100)}%${attempt > 1 ? ` (retry ${attempt})` : ''}`; });
      return result.url;
    };
    const face = await upload(faceFile, 'card faces');
    const back = await upload(backFile, 'card back');
    const cards = createImageDeck({ name: $('#deck-name').value, face, back, columns: $('#deck-columns').value, rows: $('#deck-rows').value, count: $('#deck-card-count').value });
    room.importDeck(cards, playerId); updateHost(); $('#image-deck-dialog').close(); status.textContent = ''; toast(`Placed a ${cards.length}-card stack`);
  } catch (error) { status.textContent = error.message; }
}

function addStandardDeck() {
  if (role !== 'host') return toast('Only the host can add a deck', true);
  room.importDeck(createStandardDeck(), playerId); updateHost(); toast('Placed a standard 52-card deck');
}

async function updateImageSummary() {
  const face = $('#face-file').files[0], back = $('#back-file').files[0], parts = [];
  if (face) { const size = await imageDimensions(face); parts.push(`Front: ${size.width}×${size.height}px · ${fileSize(face.size)}`); }
  if (back) { const size = await imageDimensions(back); parts.push(`Back: ${size.width}×${size.height}px · ${fileSize(back.size)}`); }
  $('#image-summary').textContent = parts.join(' | ') || 'Choose the front and back images.';
}

function render() {
  if (!state) return;
  const shareLabel = role === 'host' ? `Share table ${state.code}` : `Table code ${state.code}`;
  ui.connections.title = shareLabel; ui.connections.setAttribute('aria-label', shareLabel);
  ui.playerCount.textContent = state.players.length;
  ui.players.replaceChildren(...state.players.map((player) => {
    const row = document.createElement('div'); row.className = 'player-row';
    const backs = Array.from({ length: Math.min(player.handCount, 5) }, () => '<i></i>').join('');
    row.innerHTML = `<span class="avatar" style="background:${player.color}">${escapeHtml(initials(player.name))}</span><span class="player-name">${escapeHtml(player.name)}${player.id === playerId ? ' (you)' : ''}</span><span class="player-cards">${backs}<small>${player.handCount}</small></span>`;
    return row;
  }));
  const me = state.players.find((player) => player.id === playerId);
  ui.handCount.textContent = me?.handCount || 0;
  ui.hand.replaceChildren(...(me?.hand || []).map(handCard));
  ui.tableBoard.style.backgroundImage = state.background ? `url("${cssUrl(state.background)}")` : '';
  ui.tableBoard.hidden = !state.background;
  ui.tableCards.replaceChildren(...state.table.map(tableCard));
  ui.tableObjects.replaceChildren(...(state.objects || []).map(tableObject));
  ui.empty.hidden = state.table.length > 0 || (state.objects || []).length > 0;
  const selected = ownSelection(), trash = $('#trash-object'); trash.disabled = !selected.objectId;
  trash.title = selected.scope === 'stack' ? 'Delete selected stack' : 'Delete selected object'; trash.setAttribute('aria-label', trash.title);
}

function handCard(card) {
  const faceUp = card.faceUp !== false, el = cardElement(card, faceUp);
  el.title = 'Drag to table · H play in front · Z zoom · F flip';
  el.dataset.cardId = card.id; applyCardSelection(el, card.id);
  bindCardKeys(el, card, faceUp, 'hand');
  el.addEventListener('pointerdown', (event) => dragFromHand(event, el, card));
  el.addEventListener('dblclick', () => action('play', { cardId: card.id, x: 45 + Math.random() * 10, y: 42 + Math.random() * 8 }));
  return el;
}

function tableCard(card, index) {
  const el = cardElement(card, card.faceUp);
  el.classList.add('table-card'); el.style.left = `${card.x}%`; el.style.top = `${card.y}%`; el.style.zIndex = index + 1;
  el.style.transform = `translate(-50%,-50%) rotate(${card.rotation || 0}deg)`;
  el.dataset.cardId = card.id; applyCardSelection(el, card.id);
  const count = 1 + (card.stack?.length || 0);
  el.title = count > 1 ? `${count}-card stack · Left-drag top · Right-drag stack · S shuffle · D deal · H take top · Shift+F align` : 'Drag onto another card to stack · H take · Z zoom · F flip';
  if (count > 1) { el.classList.add('card-stack'); const badge = document.createElement('span'); badge.className = 'stack-count'; badge.textContent = count; el.append(badge); }
  bindCardKeys(el, card, card.faceUp, 'table');
  el.addEventListener('dblclick', () => action('flip', { cardId: card.id }));
  el.addEventListener('contextmenu', (event) => event.preventDefault());
  el.addEventListener('pointerdown', (event) => dragTableCard(event, el, card));
  return el;
}

function tableObject(object, index) {
  if (object.type !== 'die') return document.createDocumentFragment();
  const el = document.createElement('div'); el.className = 'table-object die';
  el.dataset.objectId = object.id; el.style.left = `${object.x}%`; el.style.top = `${object.y}%`; el.style.zIndex = 1000 + index;
  el.style.transform = `translate(-50%,-50%) rotate(${object.rotation || 0}deg)`; el.style.background = object.color;
  el.style.color = contrastColor(object.color); el.title = `D${object.sides} · Hover and press S to roll`;
  const value = document.createElement('strong'); value.textContent = object.value;
  const sides = document.createElement('small'); sides.textContent = `D${object.sides}`;
  el.append(value, sides); applyCardSelection(el, object.id);
  el.addEventListener('pointerenter', () => { hoveredObject = { element: el, object }; });
  el.addEventListener('pointerleave', () => { if (hoveredObject?.element === el) hoveredObject = null; });
  el.addEventListener('pointerdown', (event) => dragTableObject(event, el, object));
  return el;
}

function dragFromHand(event, el, card) {
  if (event.button !== 0) return;
  event.preventDefault(); markLocalSelection(el); el.setPointerCapture(event.pointerId);
  const start = { x: event.clientX, y: event.clientY };
  const table = $('#table');
  let dragging = false, ghost, stackTarget;
  const move = (e) => {
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!dragging) {
      dragging = true; hoveredCard = null; hideCardZoom();
      ghost = el.cloneNode(true); ghost.classList.add('drag-ghost'); document.body.append(ghost);
    }
    ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`;
    table.classList.toggle('drop-target', pointInside(table, e.clientX, e.clientY));
    stackTarget?.classList.remove('stack-target'); stackTarget = findStackTarget(e.clientX, e.clientY);
    stackTarget?.classList.add('stack-target');
  };
  const finish = (e, cancelled = false) => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
    table.classList.remove('drop-target'); stackTarget?.classList.remove('stack-target'); ghost?.remove();
    if (cancelled) { render(); return; }
    if (dragging && pointInside(table, e.clientX, e.clientY)) {
      const position = tablePosition(e.clientX, e.clientY);
      action('play', { cardId: card.id, ...position, targetId: stackTarget?.dataset.cardId || null });
    } else if (!dragging) action('select', { cardId: card.id });
  };
  const up = (e) => finish(e);
  const cancel = (e) => finish(e, true);
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true }); el.addEventListener('pointercancel', cancel, { once: true });
}

function dragTableCard(event, el, card) {
  if (![0, 2].includes(event.button)) return;
  const wholeStack = event.button === 2 && Boolean(card.stack?.length), scope = wholeStack ? 'stack' : 'top';
  event.preventDefault(); markLocalSelection(el, scope); el.setPointerCapture(event.pointerId);
  const handPanel = $('.hand-panel');
  const start = { x: event.clientX, y: event.clientY };
  let dragging = false, stackTarget, ghost;
  const move = (e) => {
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
    dragging = true;
    const position = tablePosition(e.clientX, e.clientY); el.dataset.x = position.x; el.dataset.y = position.y;
    if (!wholeStack && card.stack?.length) {
      if (!ghost) { ghost = el.cloneNode(true); ghost.classList.remove('card-stack', 'selected-stack'); ghost.querySelector('.stack-count')?.remove(); ghost.classList.add('drag-ghost'); document.body.append(ghost); }
      ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`;
    } else { el.style.left = `${position.x}%`; el.style.top = `${position.y}%`; }
    handPanel.classList.toggle('drop-target', !wholeStack && pointInside(handPanel, e.clientX, e.clientY));
    stackTarget?.classList.remove('stack-target'); stackTarget = findStackTarget(e.clientX, e.clientY, el);
    stackTarget?.classList.add('stack-target');
  };
  const finish = (e, cancelled = false) => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
    handPanel.classList.remove('drop-target'); stackTarget?.classList.remove('stack-target'); ghost?.remove();
    if (cancelled) { render(); return; }
    if (!dragging) action('select', { cardId: card.id, scope });
    else if (!wholeStack && pointInside(handPanel, e.clientX, e.clientY)) action('take', { cardId: card.id });
    else if (stackTarget) action(wholeStack ? 'stack' : 'stackTop', { sourceId: card.id, targetId: stackTarget.dataset.cardId });
    else action(wholeStack ? 'move' : 'moveTop', { cardId: card.id, x: Number(el.dataset.x) || card.x, y: Number(el.dataset.y) || card.y });
  };
  const up = (e) => finish(e);
  const cancel = (e) => finish(e, true);
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true }); el.addEventListener('pointercancel', cancel, { once: true });
}

function dragTableObject(event, el, object) {
  if (event.button !== 0) return;
  event.preventDefault(); markLocalSelection(el); el.setPointerCapture(event.pointerId);
  const start = { x: event.clientX, y: event.clientY };
  let dragging = false;
  const move = (e) => {
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
    dragging = true; hoveredObject = null;
    const position = tablePosition(e.clientX, e.clientY);
    el.style.left = `${position.x}%`; el.style.top = `${position.y}%`; el.dataset.x = position.x; el.dataset.y = position.y;
  };
  const finish = (e, cancelled = false) => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
    if (cancelled) { render(); return; }
    if (dragging) action('moveObject', { objectId: object.id, x: Number(el.dataset.x) || object.x, y: Number(el.dataset.y) || object.y });
    else action('select', { cardId: object.id });
  };
  const up = (e) => finish(e), cancel = (e) => finish(e, true);
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true }); el.addEventListener('pointercancel', cancel, { once: true });
}

function findStackTarget(x, y, source = null) {
  for (const node of document.elementsFromPoint(x, y)) {
    const card = node.closest?.('.table-card');
    if (card && card !== source && !source?.contains(node)) return card;
  }
  return null;
}

function tablePosition(clientX, clientY) {
  const box = ui.tableSurface.getBoundingClientRect();
  return {
    x: Math.max(3, Math.min(97, (clientX - box.left) / box.width * 100)),
    y: Math.max(3, Math.min(97, (clientY - box.top) / box.height * 100))
  };
}

function zoomTable(event) {
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  tableZoom = Math.max(0.6, Math.min(2, Math.round((tableZoom + direction * 0.1) * 10) / 10));
  applyTableTransform();
  ui.table.setAttribute('aria-label', `Shared playing area, zoom ${Math.round(tableZoom * 100)} percent`);
}

function panTable(event) {
  if (event.button !== 1) return;
  event.preventDefault(); event.stopPropagation(); ui.table.classList.add('panning');
  const start = { x: event.clientX, y: event.clientY, panX: tablePanX, panY: tablePanY };
  const move = (e) => {
    if (!(e.buttons & 4)) return finish();
    e.preventDefault();
    const box = ui.table.getBoundingClientRect(), maxX = box.width * .75, maxY = box.height * .75;
    tablePanX = Math.max(-maxX, Math.min(maxX, start.panX + e.clientX - start.x));
    tablePanY = Math.max(-maxY, Math.min(maxY, start.panY + e.clientY - start.y));
    applyTableTransform();
  };
  const finish = () => {
    ui.table.classList.remove('panning'); window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', finish, true); window.removeEventListener('blur', finish);
  };
  window.addEventListener('mousemove', move, { capture: true, passive: false });
  window.addEventListener('mouseup', finish, { capture: true, once: true });
  window.addEventListener('blur', finish, { once: true });
}

function applyTableTransform() { ui.tableSurface.style.transform = `translate(${tablePanX}px,${tablePanY}px) scale(${tableZoom})`; }

function pointInside(element, x, y) {
  const box = element.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}
function cardElement(card, faceUp) { const el = document.createElement('div'); el.className = 'card'; if (faceUp && card.standard) { const face = document.createElement('div'), corner = document.createElement('span'), center = document.createElement('strong'); face.className = `standard-card-face ${['♥','♦'].includes(card.standard.suit) ? 'red' : ''}`; corner.textContent = `${card.standard.rank}\n${card.standard.suit}`; center.textContent = card.standard.suit; face.append(corner, center); el.append(face); } else if (faceUp && card.face) { const face = document.createElement('div'); face.className = 'card-face'; const { index = 0, width = 1, height = 1 } = card.sheet || {}; face.style.backgroundImage = `url("${cssUrl(card.face)}")`; face.style.backgroundSize = `${width * 100}% ${height * 100}%`; face.style.backgroundPosition = `${width > 1 ? (index % width) / (width - 1) * 100 : 0}% ${height > 1 ? Math.floor(index / width) / (height - 1) * 100 : 0}%`; el.append(face); } else { const back = document.createElement('div'); back.className = 'card-back'; if (card.back) { back.style.backgroundImage = `url("${cssUrl(card.back)}")`; back.style.backgroundSize = 'cover'; back.textContent = ''; } else back.textContent = 'LPTTS'; el.append(back); } el.setAttribute('aria-label', card.name || 'Card'); return el; }

function bindCardKeys(element, card, faceUp, zone) {
  element.addEventListener('pointerenter', () => {
    hoveredCard = { element, card, faceUp, zone };
    if (zoomHeld) showCardZoom();
  });
  element.addEventListener('pointerleave', () => {
    if (hoveredCard?.element === element) hoveredCard = null;
    hideCardZoom();
  });
}

function cardKeyDown(event) {
  if (isTyping(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && hoveredCard) {
    event.preventDefault(); zoomHeld = true; showCardZoom();
  }
  if (key === 'f' && hoveredCard && !event.repeat) {
    event.preventDefault();
    const cardId = hoveredCard.card.id, flipWholeStack = event.shiftKey && hoveredCard.zone === 'table' && hoveredCard.card.stack?.length;
    hoveredCard = null; hideCardZoom();
    action(flipWholeStack ? 'flipStack' : 'flip', { cardId });
  }
  if (key === 'h' && hoveredCard && !event.repeat) {
    event.preventDefault();
    const cardId = hoveredCard.card.id; hoveredCard = null; hideCardZoom();
    action('hand', { cardId });
  }
  if (key === 's' && hoveredObject?.object.type === 'die' && !event.repeat) {
    event.preventDefault();
    const objectId = hoveredObject.object.id; hoveredObject = null;
    action('rollDie', { objectId }); return;
  }
  if (key === 's' && hoveredCard?.zone === 'table' && !event.repeat) {
    event.preventDefault();
    if (!hoveredCard.card.stack?.length) return toast('Put at least two cards in a stack first', true);
    const cardId = hoveredCard.card.id;
    hoveredCard = null; hideCardZoom();
    action('shuffleStack', { cardId });
  }
  if (key === 'd' && hoveredCard?.zone === 'table' && !event.repeat) {
    event.preventDefault();
    if (!hoveredCard.card.stack?.length) return toast('Only a stack can be dealt', true);
    openDealDialog(hoveredCard.card);
  }
}

function cardKeyUp(event) {
  if (event.key.toLowerCase() === 'z') { zoomHeld = false; hideCardZoom(); }
}

function showCardZoom() {
  if (!hoveredCard) return;
  const preview = cardElement(hoveredCard.card, hoveredCard.faceUp);
  preview.classList.add('zoom-preview');
  const overlay = $('#card-zoom');
  overlay.replaceChildren(preview); overlay.hidden = false;
}

function hideCardZoom() {
  zoomHeld = false;
  const overlay = $('#card-zoom');
  overlay.hidden = true; overlay.replaceChildren();
}

function applyCardSelection(element, cardId) {
  const selected = (state.selections || []).find(([, selectedCard]) => selectedCard === cardId);
  if (!selected) return;
  const owner = state.players.find((player) => player.id === selected[0]);
  if (!owner) return;
  const scope = (state.selectionScopes || []).find(([player]) => player === owner.id)?.[1] || 'top';
  element.classList.add('selected-card'); if (scope === 'stack') element.classList.add('selected-stack'); element.dataset.selectedBy = owner.id;
  element.style.setProperty('--selection-color', owner.color);
}

function markLocalSelection(element, scope = 'top') {
  document.querySelectorAll(`[data-selected-by="${CSS.escape(playerId)}"]`).forEach((card) => {
    card.classList.remove('selected-card', 'selected-stack'); card.removeAttribute('data-selected-by'); card.style.removeProperty('--selection-color');
  });
  const me = state?.players.find((player) => player.id === playerId);
  if (!me) return;
  element.classList.add('selected-card'); if (scope === 'stack') element.classList.add('selected-stack'); element.dataset.selectedBy = playerId;
  element.style.setProperty('--selection-color', me.color);
}

function clearSelection() {
  clearLocalSelection();
  action('select', { cardId: null });
}

function clearLocalSelection() {
  document.querySelectorAll(`[data-selected-by="${CSS.escape(playerId)}"]`).forEach((card) => {
    card.classList.remove('selected-card', 'selected-stack'); card.removeAttribute('data-selected-by'); card.style.removeProperty('--selection-color');
  });
}

function clearSelectionFromTable(event) {
  if (event.button !== 0) return;
  if (event.target.closest('.card,.table-object,.table-tools')) return;
  clearSelection();
}

function openDealDialog(card) {
  pendingDealCardId = card.id; hoveredCard = null; hideCardZoom();
  const size = 1 + (card.stack?.length || 0), players = state.players.length;
  const count = $('#deal-count'); count.max = Math.max(1, Math.floor(size / players)); count.value = Math.min(Number(count.value) || 1, Number(count.max));
  $('#deal-summary').textContent = `${size} cards in this stack · ${players} player${players === 1 ? '' : 's'}`;
  $('#deal-dialog').showModal(); count.focus(); count.select();
}

function submitDeal(event) {
  event.preventDefault();
  const cardId = pendingDealCardId; pendingDealCardId = '';
  $('#deal-dialog').close();
  action('dealStack', { cardId, countEach: Number($('#deal-count').value), destination: $('#deal-destination').value, faceUp: $('#deal-facing').value === 'up' });
}

function createDie(event) {
  event.preventDefault(); $('#dice-dialog').close(); clearLocalSelection();
  action('createDie', { sides: Number($('#die-sides').value), color: $('#die-color').value });
}

function ownSelection() {
  const objectId = (state?.selections || []).find(([id]) => id === playerId)?.[1] || '';
  const scope = (state?.selectionScopes || []).find(([id]) => id === playerId)?.[1] || 'top';
  return { objectId, scope };
}

function destroySelectedObject() {
  const { objectId, scope } = ownSelection();
  if (!objectId) return toast('Select a card, stack, or die first', true);
  action('destroy', { objectId, scope });
}

function openBackgroundDialog() {
  if (role !== 'host') return toast('Only the host can change the background', true);
  $('#background-url').value = state?.background || ''; $('#background-file').value = ''; $('#background-status').textContent = '';
  $('#background-dialog').showModal();
}

async function applyBackground(event) {
  event.preventDefault();
  const status = $('#background-status'), file = $('#background-file').files[0];
  try {
    let url = $('#background-url').value.trim();
    if (file) {
      if (file.size > 12 * 1024 * 1024) throw new Error('The background image must be 12 MB or smaller.');
      const uploaded = await relay.upload(file, (progress, attempt) => { status.textContent = `Uploading background… ${Math.round(progress * 100)}%${attempt > 1 ? ` (retry ${attempt})` : ''}`; });
      url = uploaded.url;
    }
    if (!url) throw new Error('Choose an image or enter an HTTPS image URL.');
    action('background', { url }); $('#background-dialog').close(); status.textContent = '';
  } catch (error) { status.textContent = error.message; }
}

function removeBackground() {
  if (role !== 'host') return;
  action('background', { url: '' }); $('#background-dialog').close();
}

function isTyping(target) { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable; }

async function sendChat(event) {
  event.preventDefault();
  const input = $('#chat-input'), text = input.value.trim().slice(0, 500);
  if (!text || !relay) return;
  input.value = '';
  try { await relay.send({ type: 'chat', data: { id: randomCode(), name: cleanName(), text, sentAt: Date.now() } }); }
  catch (error) { toast(`Chat failed: ${error.message}`, true); }
}

function addChat(message) {
  const id = message.id || message.eventId;
  if (seenChat.has(id)) return;
  seenChat.add(id);
  const item = document.createElement('div'); item.className = 'chat-message';
  const meta = document.createElement('strong'); meta.textContent = message.name || 'Player';
  const body = document.createElement('span'); body.textContent = message.text || '';
  item.append(meta, body);
  const list = $('#chat-messages'); list.append(item); list.scrollTop = list.scrollHeight;
  if ($('#chat-panel').classList.contains('minimized')) { $('#chat-toggle').classList.add('unread'); $('#chat-toggle').setAttribute('aria-label', 'Open chat, new message'); }
}

function toggleChat() {
  const panel = $('#chat-panel'); panel.classList.toggle('minimized');
  $('#chat-toggle').classList.remove('unread'); $('#chat-toggle').setAttribute('aria-label', 'Toggle chat');
  if (!panel.classList.contains('minimized')) $('#chat-input').focus();
}

function prepareSavedSession() {
  savedRelay = RelaySession.restore(relayHandlers());
  if (!savedRelay) return;
  const button = $('#resume-button');
  button.textContent = `Resume table ${savedRelay.code}`;
  button.hidden = false;
}

function resumeSession() {
  relay = savedRelay;
  if (!relay) return;
  try {
    role = relay.role; playerId = relay.participantId;
    if (role === 'host') {
      room = GameRoom.restore(JSON.parse(sessionStorage.getItem(HOST_STATE_KEY) || 'null'));
      for (const id of room.players.keys()) if (id !== playerId) remotePlayers.add(id);
      state = room.viewFor(playerId);
    } else state = JSON.parse(sessionStorage.getItem(GUEST_STATE_KEY) || 'null');
    enterGame(); relay.start();
    if (role === 'host') updateHost();
    else render();
  } catch {
    relay.clear(); relay = null; savedRelay = null; role = '';
    $('#resume-button').hidden = true;
    ui.status.textContent = 'The saved table could not be resumed.';
  }
}

function saveHostState() { try { sessionStorage.setItem(HOST_STATE_KEY, JSON.stringify(room.serialize())); } catch { /* Optional. */ } }
function saveGuestState() { try { sessionStorage.setItem(GUEST_STATE_KEY, JSON.stringify(state)); } catch { /* Optional. */ } }
function enterGame() { ui.lobby.hidden = true; ui.game.hidden = false; ui.connection.textContent = role === 'host' ? 'Relay online · hosting' : 'Joining table…'; }
function endTable(message) {
  relay?.stop(); relay?.clear();
  try { sessionStorage.removeItem(HOST_STATE_KEY); sessionStorage.removeItem(GUEST_STATE_KEY); } catch { /* Optional storage. */ }
  relay = null; savedRelay = null; room = null; state = null; role = ''; playerId = '';
  remotePlayers.clear(); seenChat.clear();
  ui.game.hidden = true; ui.lobby.hidden = false; ui.hostButton.disabled = false;
  $('#resume-button').hidden = true;
  if (ui.dialog.open) ui.dialog.close();
  history.replaceState({}, '', location.pathname);
  ui.status.textContent = message;
}
function cleanName() { return ui.name.value.trim().slice(0, 24) || 'Player'; }
function readStoredName() { try { return localStorage.getItem('lptts-name') || ''; } catch { return ''; } }
function saveName() { try { localStorage.setItem('lptts-name', cleanName()); } catch { /* Optional. */ } }
function codeFromUrl() { return new URLSearchParams(location.search).get('room')?.slice(0, 6).toUpperCase() || ''; }
function networkError(error) { toast(`Relay error: ${error.message}`, true); }
function imageDimensions(file) { return new Promise((resolve, reject) => { const image = new Image(), url = URL.createObjectURL(file); image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url); }; image.onerror = () => { reject(new Error(`${file.name} is not a readable image.`)); URL.revokeObjectURL(url); }; image.src = url; }); }
function fileSize(bytes) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }
function contrastColor(hex) { const value = String(hex || '').replace('#', ''); const rgb = Number.parseInt(value, 16); return (((rgb >> 16) * 299 + ((rgb >> 8) & 255) * 587 + (rgb & 255) * 114) / 1000) > 145 ? '#171b18' : '#fffdf8'; }
function initials(name) { return String(name || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function randomCode() { return crypto.getRandomValues(new Uint32Array(2)).join('-'); }
function cssUrl(value) { return String(value || '').replace(/["\\\n\r]/g, (char) => `\\${char}`); }
function escapeHtml(value) { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
async function copy(value, message) { try { await navigator.clipboard.writeText(value); toast(message); } catch { toast('Copy failed—select the text manually', true); } }
let toastTimer;
function toast(message, bad = false) { ui.toast.textContent = message; ui.toast.style.background = bad ? '#8f302d' : ''; ui.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600); }
