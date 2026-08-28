import { GameRoom } from './game.js?v=2';
import { parseTtsDeck } from './tts.js';
import { createImageDeck } from './image-deck.js?v=2';
import { RelaySession } from './relay.js?v=2';

const $ = (selector) => document.querySelector(selector);
const ui = {
  lobby: $('#lobby'), game: $('#game'), hostButton: $('#host-button'), name: $('#name'), status: $('#lobby-status'),
  players: $('#players'), playerCount: $('#player-count'), connections: $('#connections'), connection: $('#connection'),
  tableCards: $('#table-cards'), empty: $('#empty-table'), deck: $('#deck'), deckCount: $('.deck-count'),
  deckLabel: $('#deck-label'), shuffle: $('#shuffle'), hand: $('#hand'), handCount: $('#hand-count'), file: $('#tts-file'),
  toast: $('#toast'), dialog: $('#connect-dialog'), hostPanel: $('#connect-host'), guestPanel: $('#connect-guest')
};
let role = '', playerId = '', state, room, relay;
let savedRelay;
let hoveredCard = null, zoomHeld = false;
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
$('#image-deck-button').addEventListener('click', () => role === 'host' ? $('#image-deck-dialog').showModal() : toast('Only the host can create a deck', true));
$('#image-deck-form').addEventListener('submit', createUploadedDeck);
$('#face-file').addEventListener('change', updateImageSummary);
$('#back-file').addEventListener('change', updateImageSummary);
ui.file.addEventListener('change', importDeck);
ui.deck.addEventListener('click', () => action('draw'));
ui.shuffle.addEventListener('click', () => action('shuffle'));
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
    enterGame(); updateHost(); relay.start(); showInvite();
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
    else if (type === 'shuffle') room.shuffle();
    else if (type === 'play') room.play(actor, body.cardId, body.x, body.y);
    else if (type === 'take') room.take(actor, body.cardId);
    else if (type === 'flip') room.flip(body.cardId, actor);
    else if (type === 'move') room.move(actor, body.cardId, body.x, body.y);
    else throw new Error('Unknown action.');
    updateHost();
  } catch (error) {
    if (actor === playerId) toast(error.message, true);
    else relay.send({ type: 'error', target: actor, data: { message: error.message } }).catch(networkError);
  }
}

function updateHost() {
  state = room.viewFor(playerId); render(); saveHostState();
  for (const id of remotePlayers) {
    if (!room.players.has(id)) continue;
    relay.send([
      { type: 'welcome', target: id, data: { playerId: id } },
      { type: 'state', target: id, data: { state: room.viewFor(id) } }
    ]).catch(networkError);
  }
}

async function importDeck() {
  try { const cards = parseTtsDeck(await ui.file.files[0].text()); room.importDeck(cards); updateHost(); toast(`Imported ${cards.length} cards`); }
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
    room.importDeck(cards); updateHost(); $('#image-deck-dialog').close(); status.textContent = ''; toast(`Created ${cards.length} cards`);
  } catch (error) { status.textContent = error.message; }
}

async function updateImageSummary() {
  const face = $('#face-file').files[0], back = $('#back-file').files[0], parts = [];
  if (face) { const size = await imageDimensions(face); parts.push(`Front: ${size.width}×${size.height}px · ${fileSize(face.size)}`); }
  if (back) { const size = await imageDimensions(back); parts.push(`Back: ${size.width}×${size.height}px · ${fileSize(back.size)}`); }
  $('#image-summary').textContent = parts.join(' | ') || 'Choose the front and back images.';
}

function render() {
  if (!state) return;
  ui.connections.textContent = role === 'host' ? `${state.code} · + PLAYER` : state.code;
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
  ui.deckCount.textContent = state.deckCount;
  ui.deckLabel.textContent = state.deckCount ? `${state.deckCount} cards` : 'No deck';
  ui.deck.disabled = !state.deckCount; ui.shuffle.disabled = !state.deckCount;
  ui.deck.style.backgroundImage = state.deckBack ? `url("${cssUrl(state.deckBack)}")` : '';
  ui.tableCards.replaceChildren(...state.table.map(tableCard)); ui.empty.hidden = state.table.length > 0;
}

function handCard(card) { const faceUp = card.faceUp !== false; const el = cardElement(card, faceUp); el.title = 'Double-click to play · Z zoom · F flip'; bindCardKeys(el, card, faceUp); el.addEventListener('dblclick', () => action('play', { cardId: card.id, x: 45 + Math.random() * 10, y: 42 + Math.random() * 8 })); return el; }
function tableCard(card, index) { const el = cardElement(card, card.faceUp); el.classList.add('table-card'); el.style.left = `${card.x}%`; el.style.top = `${card.y}%`; el.style.zIndex = index + 1; el.style.transform = `translate(-50%,-50%) rotate(${card.rotation || 0}deg)`; el.title = 'Z zoom · F flip'; bindCardKeys(el, card, card.faceUp); el.addEventListener('dblclick', () => action('flip', { cardId: card.id })); el.addEventListener('contextmenu', (event) => { event.preventDefault(); action('take', { cardId: card.id }); }); el.addEventListener('pointerdown', (event) => drag(event, el, card)); return el; }
function drag(event, el, card) { event.preventDefault(); el.setPointerCapture(event.pointerId); const table = $('#table'); const move = (e) => { const box = table.getBoundingClientRect(); const x = Math.max(3, Math.min(97, (e.clientX - box.left) / box.width * 100)); const y = Math.max(3, Math.min(97, (e.clientY - box.top) / box.height * 100)); el.style.left = `${x}%`; el.style.top = `${y}%`; el.dataset.x = x; el.dataset.y = y; }; const up = () => { el.removeEventListener('pointermove', move); action('move', { cardId: card.id, x: Number(el.dataset.x) || card.x, y: Number(el.dataset.y) || card.y }); }; el.addEventListener('pointermove', move); el.addEventListener('pointerup', up, { once: true }); }
function cardElement(card, faceUp) { const el = document.createElement('div'); el.className = 'card'; if (faceUp && card.face) { const face = document.createElement('div'); face.className = 'card-face'; const { index = 0, width = 1, height = 1 } = card.sheet || {}; face.style.backgroundImage = `url("${cssUrl(card.face)}")`; face.style.backgroundSize = `${width * 100}% ${height * 100}%`; face.style.backgroundPosition = `${width > 1 ? (index % width) / (width - 1) * 100 : 0}% ${height > 1 ? Math.floor(index / width) / (height - 1) * 100 : 0}%`; el.append(face); } else { const back = document.createElement('div'); back.className = 'card-back'; if (card.back) { back.style.backgroundImage = `url("${cssUrl(card.back)}")`; back.style.backgroundSize = 'cover'; back.textContent = ''; } else back.textContent = 'LPTTS'; el.append(back); } if (faceUp) { const name = document.createElement('span'); name.className = 'card-name'; name.textContent = card.name; el.append(name); } return el; }

function bindCardKeys(element, card, faceUp) {
  element.addEventListener('pointerenter', () => {
    hoveredCard = { element, card, faceUp };
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
    const cardId = hoveredCard.card.id;
    hoveredCard = null; hideCardZoom();
    action('flip', { cardId });
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
    enterGame(); render(); relay.start();
  } catch {
    relay.clear(); relay = null; savedRelay = null; role = '';
    $('#resume-button').hidden = true;
    ui.status.textContent = 'The saved table could not be resumed.';
  }
}

function saveHostState() { try { sessionStorage.setItem(HOST_STATE_KEY, JSON.stringify(room.serialize())); } catch { /* Optional. */ } }
function saveGuestState() { try { sessionStorage.setItem(GUEST_STATE_KEY, JSON.stringify(state)); } catch { /* Optional. */ } }
function enterGame() { ui.lobby.hidden = true; ui.game.hidden = false; ui.connection.textContent = role === 'host' ? 'Relay online · hosting' : 'Joining table…'; }
function cleanName() { return ui.name.value.trim().slice(0, 24) || 'Player'; }
function readStoredName() { try { return localStorage.getItem('lptts-name') || ''; } catch { return ''; } }
function saveName() { try { localStorage.setItem('lptts-name', cleanName()); } catch { /* Optional. */ } }
function codeFromUrl() { return new URLSearchParams(location.search).get('room')?.slice(0, 6).toUpperCase() || ''; }
function networkError(error) { toast(`Relay error: ${error.message}`, true); }
function imageDimensions(file) { return new Promise((resolve, reject) => { const image = new Image(), url = URL.createObjectURL(file); image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url); }; image.onerror = () => { reject(new Error(`${file.name} is not a readable image.`)); URL.revokeObjectURL(url); }; image.src = url; }); }
function fileSize(bytes) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }
function initials(name) { return String(name || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function randomCode() { return crypto.getRandomValues(new Uint32Array(2)).join('-'); }
function cssUrl(value) { return String(value || '').replace(/["\\\n\r]/g, (char) => `\\${char}`); }
function escapeHtml(value) { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
async function copy(value, message) { try { await navigator.clipboard.writeText(value); toast(message); } catch { toast('Copy failed—select the text manually', true); } }
let toastTimer;
function toast(message, bad = false) { ui.toast.textContent = message; ui.toast.style.background = bad ? '#8f302d' : ''; ui.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600); }
