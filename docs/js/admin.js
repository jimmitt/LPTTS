const API = 'https://api.msyumyum.com/lptts.php';
const TOKEN_KEY = 'lptts-admin-token';
const $ = (selector) => document.querySelector(selector);
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let refreshTimer = 0, observeTimer = 0, observedCode = '';

$('#login-form').addEventListener('submit', login);
$('#refresh').addEventListener('click', loadRooms);
$('#sign-out').addEventListener('click', signOut);
$('#close-observer').addEventListener('click', closeObserver);
$('#observer').addEventListener('close', () => { clearInterval(observeTimer); observedCode = ''; });
if (token) openDashboard();

async function api(op, extra = {}) {
  const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, adminToken: token, ...extra }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.message || `Server returned ${response.status}.`);
  return data;
}

async function login(event) {
  event.preventDefault(); token = $('#admin-token').value.trim(); $('#login-error').textContent = '';
  try { await api('admin_list'); sessionStorage.setItem(TOKEN_KEY, token); openDashboard(); }
  catch (error) { token = ''; $('#login-error').textContent = error.message; }
}

function openDashboard() {
  $('#login').hidden = true; $('#dashboard').hidden = false; $('#sign-out').hidden = false;
  loadRooms(); clearInterval(refreshTimer); refreshTimer = setInterval(loadRooms, 10000);
}

function signOut() {
  clearInterval(refreshTimer); closeObserver(); token = ''; sessionStorage.removeItem(TOKEN_KEY); $('#admin-token').value = '';
  $('#dashboard').hidden = true; $('#sign-out').hidden = true; $('#login').hidden = false;
}

async function loadRooms() {
  try {
    const data = await api('admin_list'); renderRooms(data.rooms || []); $('#dashboard-error').textContent = '';
    $('#updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    $('#dashboard-error').textContent = error.message;
    if (/authentication/i.test(error.message)) signOut();
  }
}

function renderRooms(rooms) {
  $('#table-total').textContent = rooms.length;
  $('#active-total').textContent = rooms.filter((room) => room.active).length;
  $('#player-total').textContent = rooms.reduce((sum, room) => sum + room.activePlayerCount, 0);
  $('#empty').hidden = rooms.length > 0;
  $('#rooms').replaceChildren(...rooms.map((room) => {
    const row = document.createElement('tr');
    const code = cell(room.code, 'code');
    const status = document.createElement('td'), pill = document.createElement('span'); pill.className = `pill${room.active ? ' active' : ''}`; pill.textContent = room.active ? 'Active' : 'Idle'; status.append(pill);
    const players = cell(`${room.activePlayerCount} active / ${room.playerCount} total`);
    const created = cell(formatDate(room.createdAt));
    const activity = cell(relativeTime(room.lastActivity));
    const actionCell = document.createElement('td'), actions = document.createElement('div'); actions.className = 'actions';
    const observe = button('Observe', () => observeRoom(room.code));
    const remove = button('Delete', () => deleteRoom(room.code), 'delete');
    actions.append(observe, remove); actionCell.append(actions); row.append(code, status, players, created, activity, actionCell); return row;
  }));
}

async function observeRoom(code) {
  observedCode = code; $('#observe-code').textContent = code; $('#observer').showModal();
  await loadObservation(); clearInterval(observeTimer); observeTimer = setInterval(loadObservation, 2000);
}

async function loadObservation() {
  if (!observedCode) return;
  try {
    const data = await api('admin_observe', { code: observedCode }); renderObservation(data);
  } catch (error) { $('#observe-status').textContent = error.message; if (/not found/i.test(error.message)) closeObserver(); }
}

function renderObservation(data) {
  const room = data.room;
  $('#observe-status').textContent = `${room.activePlayerCount} active / ${room.playerCount} players`;
  $('#observe-updated').textContent = data.snapshotUpdatedAt ? `Snapshot ${relativeTime(data.snapshotUpdatedAt)}` : 'No snapshot received';
  $('#observe-players').replaceChildren(...room.players.map((player) => {
    const el = document.createElement('div'); el.className = 'observe-player';
    const name = document.createElement('strong'); name.textContent = player.name;
    const meta = document.createElement('span'); meta.textContent = `${player.role} · ${player.active ? 'active now' : `seen ${relativeTime(player.lastSeen)}`}`;
    el.append(name, meta); return el;
  }));
  const state = data.state; $('#no-snapshot').hidden = Boolean(state);
  $('#observe-cards').replaceChildren(...(state?.table || []).map(observeCard));
  const deck = $('#observe-deck'); deck.hidden = !state?.deckCount; $('#observe-deck-count').textContent = state?.deckCount || '';
  deck.style.backgroundImage = state?.deckBack ? `url("${cssUrl(state.deckBack)}")` : '';
}

function observeCard(card) {
  const el = document.createElement('div'); el.className = 'observe-card'; el.style.left = `${card.x}%`; el.style.top = `${card.y}%`; el.style.transform = `translate(-50%,-50%) rotate(${Number(card.rotation) || 0}deg)`;
  if (card.faceUp !== false && card.face) {
    const face = document.createElement('div'); face.className = 'observe-card-face';
    const { index = 0, width = 1, height = 1 } = card.sheet || {};
    face.style.backgroundImage = `url("${cssUrl(card.face)}")`; face.style.backgroundSize = `${width * 100}% ${height * 100}%`; face.style.backgroundPosition = `${width > 1 ? (index % width) / (width - 1) * 100 : 0}% ${height > 1 ? Math.floor(index / width) / (height - 1) * 100 : 0}%`; el.append(face);
    const name = document.createElement('span'); name.className = 'observe-card-name'; name.textContent = card.name || ''; el.append(name);
  } else {
    const back = document.createElement('div'); back.className = 'observe-card-back'; if (card.back) back.style.backgroundImage = `url("${cssUrl(card.back)}")`; el.append(back);
  }
  return el;
}

async function deleteRoom(code) {
  if (!confirm(`Delete table ${code} and disconnect all of its players? This cannot be undone.`)) return;
  try { await api('admin_delete', { code }); toast(`Table ${code} deleted`); if (observedCode === code) closeObserver(); await loadRooms(); }
  catch (error) { toast(error.message, true); }
}

function closeObserver() { clearInterval(observeTimer); observedCode = ''; if ($('#observer').open) $('#observer').close(); }
function cell(value, className = '') { const el = document.createElement('td'); el.textContent = value; el.className = className; return el; }
function button(label, action, className = '') { const el = document.createElement('button'); el.textContent = label; el.className = className; el.addEventListener('click', action); return el; }
function formatDate(seconds) { return new Date(seconds * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function relativeTime(seconds) { const age = Math.max(0, Math.floor(Date.now() / 1000) - seconds); if (age < 10) return 'just now'; if (age < 60) return `${age}s ago`; if (age < 3600) return `${Math.floor(age / 60)}m ago`; return `${Math.floor(age / 3600)}h ago`; }
function cssUrl(value) { return String(value || '').replace(/["\\\n\r]/g, (char) => `\\${char}`); }
let toastTimer; function toast(message, bad = false) { const el = $('#toast'); el.textContent = message; el.style.background = bad ? '#8f302d' : ''; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
