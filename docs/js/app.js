import { GameRoom } from './game.js';
import { parseTtsDeck } from './tts.js';
import { createImageDeck } from './image-deck.js';
import { getEffectiveTurnConfig, getStoredTurnConfig, saveStoredTurnConfig, clearStoredTurnConfig, parseTurnJson, buildRtcConfig } from './config.js';

const $ = (selector) => document.querySelector(selector);
const ui = { lobby:$('#lobby'), game:$('#game'), form:$('#join-form'), hostButton:$('#host-button'), name:$('#name'), status:$('#lobby-status'), players:$('#players'), playerCount:$('#player-count'), connections:$('#connections'), connection:$('#connection'), tableCards:$('#table-cards'), empty:$('#empty-table'), deck:$('#deck'), deckCount:$('.deck-count'), deckLabel:$('#deck-label'), shuffle:$('#shuffle'), hand:$('#hand'), handCount:$('#hand-count'), file:$('#tts-file'), toast:$('#toast'), dialog:$('#connect-dialog'), hostPanel:$('#connect-host'), guestPanel:$('#connect-guest'), connectStatus:$('#connect-status') };
let role = '', playerId = '', state, room, hostPending, guestPeer, guestChannel;
const peers = new Map();
const receivedAssets = new Map();
const assetParts = new Map();

ui.name.value = readStoredName();
window.lpttsReady = true;
ui.form.addEventListener('submit', (event) => { event.preventDefault(); hostTable(); });
ui.hostButton.addEventListener('click', hostTable);
$('#join-button').addEventListener('click', () => openJoin());
$('#lobby-settings')?.addEventListener('click', openSettings);
$('#game-settings')?.addEventListener('click', openSettings);
$('#settings-form')?.addEventListener('submit', saveSettings);
$('#setting-clear-button')?.addEventListener('click', clearSettings);
$('#turn-file-button')?.addEventListener('click', () => $('#turn-file-input').click());
$('#turn-file-input')?.addEventListener('change', loadTurnFile);
ui.connections.addEventListener('click', () => role === 'host' ? createOffer() : toast('Only the host can add players'));
$('#copy-offer')?.addEventListener('click', () => copy($('#offer-code').value, 'Offer code copied'));
$('#copy-answer')?.addEventListener('click', () => copy($('#guest-answer').value, 'Answer code copied'));
$('#copy-offer-input')?.addEventListener('click', () => copy($('#join-offer').value, 'Offer code copied'));
$('#copy-answer-input')?.addEventListener('click', () => copy($('#answer-code').value, 'Answer code copied'));
$('#paste-offer')?.addEventListener('click', () => pasteInto($('#join-offer'), 'Offer code pasted'));
$('#paste-answer')?.addEventListener('click', () => pasteInto($('#answer-code'), 'Answer code pasted'));
$('#offer-code')?.addEventListener('click', () => { if ($('#offer-code').value) copy($('#offer-code').value, 'Offer code copied'); });
$('#guest-answer')?.addEventListener('click', () => { if ($('#guest-answer').value) copy($('#guest-answer').value, 'Answer code copied'); });
$('#make-answer').addEventListener('click', makeAnswer);
$('#accept-answer').addEventListener('click', acceptAnswer);
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

function openSettings() {
  const current = getEffectiveTurnConfig();
  let host = current?.host || '', username = current?.username || '', credential = current?.credential || '';
  if (Array.isArray(current?.iceServers)) {
    const turn = current.iceServers.find(s => s.username && s.credential);
    if (turn) {
      username = turn.username;
      credential = turn.credential;
      const url = Array.isArray(turn.urls) ? turn.urls[0] : turn.urls;
      host = url.replace(/^turn(s)?:/i, '').replace(/^stun:/i, '').split(':')[0].split('?')[0];
    }
  }
  $('#setting-turn-host').value = host;
  $('#setting-turn-user').value = username;
  $('#setting-turn-cred').value = credential;
  $('#settings-status').textContent = '';
  
  const sourceEl = $('#settings-source');
  if (sourceEl) {
    if (current?.source === 'file') {
      sourceEl.textContent = '✓ Active: Loaded automatically from docs/js/config.js';
    } else if (current?.source === 'localStorage') {
      sourceEl.textContent = '✓ Active: Loaded from browser local storage';
    } else {
      sourceEl.textContent = 'Active: Using direct P2P (STUN)';
    }
  }
  $('#settings-dialog').showModal();
}

function saveSettings(event) {
  event.preventDefault();
  try {
    saveStoredTurnConfig({
      host: $('#setting-turn-host').value,
      username: $('#setting-turn-user').value,
      credential: $('#setting-turn-cred').value
    });
    $('#settings-dialog').close();
    toast('Relay settings saved');
  } catch (error) {
    $('#settings-status').textContent = error.message;
  }
}

async function loadTurnFile() {
  const fileInput = $('#turn-file-input');
  const file = fileInput?.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const config = parseTurnJson(text);
    let host = config.host || '', username = config.username || '', credential = config.credential || '';
    if (Array.isArray(config.iceServers)) {
      const turn = config.iceServers.find(s => s.username && s.credential);
      if (turn) {
        username = turn.username;
        credential = turn.credential;
        const url = Array.isArray(turn.urls) ? turn.urls[0] : turn.urls;
        host = url.replace(/^turn(s)?:/i, '').replace(/^stun:/i, '').split(':')[0].split('?')[0];
      }
    }
    $('#setting-turn-host').value = host;
    $('#setting-turn-user').value = username;
    $('#setting-turn-cred').value = credential;
    saveStoredTurnConfig(config);
    $('#settings-status').textContent = '';
    const sourceEl = $('#settings-source');
    if (sourceEl) sourceEl.textContent = `✓ Loaded from ${file.name}`;
    toast(`Loaded TURN settings from ${file.name}`);
  } catch (error) {
    $('#settings-status').textContent = `Could not load file: ${error.message}`;
  } finally {
    fileInput.value = '';
  }
}

function clearSettings() {
  clearStoredTurnConfig();
  $('#setting-turn-host').value = '';
  $('#setting-turn-user').value = '';
  $('#setting-turn-cred').value = '';
  $('#settings-status').textContent = '';
  const sourceEl = $('#settings-source');
  if (sourceEl) sourceEl.textContent = 'Active: Using direct P2P (STUN)';
  $('#settings-dialog').close();
  toast('Relay settings cleared');
}

function hostTable() {
  ui.status.textContent = 'Opening table…';
  ui.hostButton.disabled = true;
  try {
    saveName(); role = 'host'; playerId = newId();
    room = new GameRoom(randomCode()); room.join(playerId, ui.name.value); updateHost(); enterGame();
  } catch (error) {
    role = ''; ui.hostButton.disabled = false; ui.status.textContent = `Could not open the table: ${error.message || 'unsupported browser feature'}`;
    console.error('LPTTS host startup failed', error);
  }
}

function openJoin() {
  saveName(); role = 'guest'; ui.hostPanel.hidden = true; ui.guestPanel.hidden = false;
  $('#connect-title').textContent = 'Join a table'; $('#answer-result').hidden = true; ui.connectStatus.textContent = '';
  ui.dialog.showModal();
}

async function createOffer() {
  try {
    if (peers.size >= 7) return toast('This table is full', true);
    resetDialog(true); hostPending?.peer.close();
    const turnConfig = getEffectiveTurnConfig();
    const peer = new RTCPeerConnection(buildRtcConfig(turnConfig));
    const channel = peer.createDataChannel('lptts', { ordered: true });
    const id = newId(); hostPending = { peer, channel, id };
    wireHostPeer(hostPending); await peer.setLocalDescription(await peer.createOffer()); await iceComplete(peer);
    $('#offer-code').value = await encode({ v:1, type:'offer', id, sdp:peer.localDescription, turn:turnConfig });
    ui.dialog.showModal();
  } catch (error) { toast(`Could not create an offer: ${error.message}`, true); }
}

async function makeAnswer() {
  try {
    const offer = await decode($('#join-offer').value, 'offer');
    guestPeer?.close();
    guestPeer = new RTCPeerConnection(buildRtcConfig(offer.turn || getEffectiveTurnConfig()));
    guestPeer.addEventListener('datachannel', ({ channel }) => { guestChannel = channel; wireGuestChannel(channel); });
    guestPeer.addEventListener('connectionstatechange', () => connectionLabel(guestPeer.connectionState));
    await guestPeer.setRemoteDescription(offer.sdp); await guestPeer.setLocalDescription(await guestPeer.createAnswer()); await iceComplete(guestPeer);
    $('#guest-answer').value = await encode({ v:1, type:'answer', id:offer.id, name:cleanName(), sdp:guestPeer.localDescription });
    $('#answer-result').hidden = false; ui.connectStatus.textContent = 'Send this answer to the host, then wait for the table to open.';
  } catch (error) { ui.connectStatus.textContent = error.message; }
}

async function acceptAnswer() {
  try {
    const answer = await decode($('#answer-code').value, 'answer');
    if (!hostPending || answer.id !== hostPending.id) throw new Error('This answer does not match the current offer.');
    hostPending.name = String(answer.name || 'Player').slice(0,24); await hostPending.peer.setRemoteDescription(answer.sdp);
    ui.connectStatus.textContent = 'Connecting… Keep this window open.';
  } catch (error) { ui.connectStatus.textContent = error.message; }
}

function wireHostPeer(entry) {
  entry.channel.addEventListener('open', () => {
    try { room.join(entry.id, entry.name); peers.set(entry.id, entry); hostPending = undefined; ui.dialog.close(); updateHost(); toast(`${entry.name} joined`); }
    catch (error) { sendChannel(entry.channel,{type:'error',message:error.message}); entry.peer.close(); }
  });
  entry.channel.addEventListener('message', ({ data }) => { try { const message=JSON.parse(data); if(message.type==='action') applyHostAction(entry.id,message.action,message.body||{}); } catch { sendChannel(entry.channel,{type:'error',message:'Invalid action.'}); } });
  entry.peer.addEventListener('connectionstatechange', () => {
    if (['failed','closed','disconnected'].includes(entry.peer.connectionState) && peers.has(entry.id)) { room.leave(entry.id); peers.delete(entry.id); updateHost(); }
  });
}

function wireGuestChannel(channel) {
  channel.addEventListener('open', () => { ui.dialog.close(); enterGame(); ui.connection.textContent='Connected to host'; });
  channel.addEventListener('message', ({data}) => { const message=JSON.parse(data); if(message.type==='welcome')playerId=message.playerId; if(message.type==='asset-begin')assetParts.set(message.id,[]); if(message.type==='asset-chunk')assetParts.get(message.id)?.push(message.data); if(message.type==='asset-end'){receivedAssets.set(message.id,(assetParts.get(message.id)||[]).join(''));assetParts.delete(message.id);} if(message.type==='state'){state=restoreAssets(message.state);render();} if(message.type==='error')toast(message.message,true); });
  channel.addEventListener('close', () => { ui.connection.textContent='Host disconnected'; toast('The host ended the connection',true); });
}

function action(type, body={}) {
  if (role === 'host') applyHostAction(playerId,type,body);
  else if (guestChannel?.readyState === 'open') sendChannel(guestChannel,{type:'action',action:type,body});
  else toast('Not connected to the host',true);
}

function applyHostAction(actor, type, body) {
  try {
    if(type==='draw') room.draw(actor); else if(type==='shuffle') room.shuffle(); else if(type==='play') room.play(actor,body.cardId,body.x,body.y);
    else if(type==='take') room.take(actor,body.cardId); else if(type==='flip') room.flip(body.cardId); else if(type==='move') room.move(actor,body.cardId,body.x,body.y); else throw new Error('Unknown action.');
    updateHost();
  } catch(error) { if(actor===playerId)toast(error.message,true); else sendChannel(peers.get(actor)?.channel,{type:'error',message:error.message}); }
}

function updateHost() {
  state=room.viewFor(playerId); render();
  for(const [id,entry] of peers){sendChannel(entry.channel,{type:'welcome',playerId:id});queueSnapshot(entry,room.viewFor(id));}
}

async function importDeck() {
  try { const cards=parseTtsDeck(await ui.file.files[0].text());room.importDeck(cards);updateHost();toast(`Imported ${cards.length} cards`); }
  catch(error){toast(error.message,true);} finally{ui.file.value='';}
}

async function createUploadedDeck(event) {
  event.preventDefault();
  const status = $('#image-deck-status'); status.textContent = 'Reading images…';
  try {
    const faceFile=$('#face-file').files[0], backFile=$('#back-file').files[0];
    if(!faceFile||!backFile)throw new Error('Choose both front and back images.');
    if(faceFile.size>12*1024*1024||backFile.size>12*1024*1024)throw new Error('Each image must be 12 MB or smaller.');
    const [face,back]=await Promise.all([readDataUrl(faceFile),readDataUrl(backFile)]);
    const cards=createImageDeck({name:$('#deck-name').value,face,back,columns:$('#deck-columns').value,rows:$('#deck-rows').value,count:$('#deck-card-count').value});
    room.importDeck(cards);updateHost();$('#image-deck-dialog').close();status.textContent='';toast(`Created ${cards.length} cards`);
  } catch(error){status.textContent=error.message;}
}

async function updateImageSummary() {
  const face=$('#face-file').files[0],back=$('#back-file').files[0],parts=[];
  if(face){const size=await imageDimensions(face);parts.push(`Front: ${size.width}×${size.height}px · ${fileSize(face.size)}`);}
  if(back){const size=await imageDimensions(back);parts.push(`Back: ${size.width}×${size.height}px · ${fileSize(back.size)}`);}
  $('#image-summary').textContent=parts.join(' | ')||'Choose the front and back images.';
}

function render() {
  if(!state)return; ui.connections.textContent=role==='host'?`${state.code} · + PLAYER`:state.code; ui.playerCount.textContent=state.players.length;
  ui.players.replaceChildren(...state.players.map(player=>{const row=document.createElement('div');row.className='player-row';const backs=Array.from({length:Math.min(player.handCount,5)},()=>'<i></i>').join('');row.innerHTML=`<span class="avatar" style="background:${player.color}">${escapeHtml(initials(player.name))}</span><span class="player-name">${escapeHtml(player.name)}${player.id===playerId?' (you)':''}</span><span class="player-cards">${backs}<small>${player.handCount}</small></span>`;return row;}));
  const me=state.players.find(p=>p.id===playerId);ui.handCount.textContent=me?.handCount||0;ui.hand.replaceChildren(...(me?.hand||[]).map(handCard));
  ui.deckCount.textContent=state.deckCount;ui.deckLabel.textContent=state.deckCount?`${state.deckCount} cards`:'No deck';ui.deck.disabled=!state.deckCount;ui.shuffle.disabled=!state.deckCount;
  ui.deck.style.backgroundImage=state.deckBack?`url("${cssUrl(state.deckBack)}")`:'';ui.tableCards.replaceChildren(...state.table.map(tableCard));ui.empty.hidden=state.table.length>0;
}

function handCard(card){const el=cardElement(card,true);el.title='Double-click to play';el.addEventListener('dblclick',()=>action('play',{cardId:card.id,x:45+Math.random()*10,y:42+Math.random()*8}));return el;}
function tableCard(card,index){const el=cardElement(card,card.faceUp);el.classList.add('table-card');el.style.left=`${card.x}%`;el.style.top=`${card.y}%`;el.style.zIndex=index+1;el.style.transform=`translate(-50%,-50%) rotate(${card.rotation||0}deg)`;el.addEventListener('dblclick',()=>action('flip',{cardId:card.id}));el.addEventListener('contextmenu',(e)=>{e.preventDefault();action('take',{cardId:card.id});});el.addEventListener('pointerdown',(event)=>drag(event,el,card));return el;}
function drag(event,el,card){event.preventDefault();el.setPointerCapture(event.pointerId);const table=$('#table');const move=(e)=>{const box=table.getBoundingClientRect();const x=Math.max(3,Math.min(97,(e.clientX-box.left)/box.width*100));const y=Math.max(3,Math.min(97,(e.clientY-box.top)/box.height*100));el.style.left=`${x}%`;el.style.top=`${y}%`;el.dataset.x=x;el.dataset.y=y;};const up=()=>{el.removeEventListener('pointermove',move);action('move',{cardId:card.id,x:Number(el.dataset.x)||card.x,y:Number(el.dataset.y)||card.y});};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up,{once:true});}
function cardElement(card,faceUp){const el=document.createElement('div');el.className='card';if(faceUp&&card.face){const face=document.createElement('div');face.className='card-face';const {index=0,width=1,height=1}=card.sheet||{};face.style.backgroundImage=`url("${cssUrl(card.face)}")`;face.style.backgroundSize=`${width*100}% ${height*100}%`;face.style.backgroundPosition=`${width>1?(index%width)/(width-1)*100:0}% ${height>1?Math.floor(index/width)/(height-1)*100:0}%`;el.append(face);}else{const back=document.createElement('div');back.className='card-back';if(card.back){back.style.backgroundImage=`url("${cssUrl(card.back)}")`;back.style.backgroundSize='cover';back.textContent='';}else back.textContent='LPTTS';el.append(back);}if(faceUp){const name=document.createElement('span');name.className='card-name';name.textContent=card.name;el.append(name);}return el;}

const hostedAssets = new Map();
let assetSequence = 0;
function queueSnapshot(entry, snapshot) {
  entry.sentAssets ||= new Set();
  entry.queue ||= Promise.resolve();
  entry.queue = entry.queue.then(async () => {
    if (entry.channel.readyState !== 'open') return;
    const needed = new Map();
    const wireState = JSON.parse(JSON.stringify(snapshot, (_key, value) => {
      if (typeof value !== 'string' || !value.startsWith('data:image/')) return value;
      let id = hostedAssets.get(value);
      if (!id) { id = `image-${++assetSequence}`; hostedAssets.set(value,id); }
      if (!entry.sentAssets.has(id)) needed.set(id,value);
      return `asset://${id}`;
    }));
    for (const [id,data] of needed) {
      sendChannel(entry.channel,{type:'asset-begin',id});
      for(let offset=0;offset<data.length;offset+=48_000){await waitForBuffer(entry.channel);sendChannel(entry.channel,{type:'asset-chunk',id,data:data.slice(offset,offset+48_000)});}
      sendChannel(entry.channel,{type:'asset-end',id});entry.sentAssets.add(id);
    }
    sendChannel(entry.channel,{type:'state',state:wireState});
  }).catch((error)=>console.error('LPTTS state delivery failed',error));
}
function restoreAssets(value) { return JSON.parse(JSON.stringify(value),(_key,item)=>typeof item==='string'&&item.startsWith('asset://')?(receivedAssets.get(item.slice(8))||''):item); }
function waitForBuffer(channel){if(channel.bufferedAmount<512_000)return Promise.resolve();channel.bufferedAmountLowThreshold=256_000;return new Promise(resolve=>{const done=()=>{channel.removeEventListener('bufferedamountlow',done);channel.removeEventListener('close',done);resolve();};channel.addEventListener('bufferedamountlow',done,{once:true});channel.addEventListener('close',done,{once:true});});}
function readDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error(`Could not read ${file.name}.`));reader.readAsDataURL(file);});}
function imageDimensions(file){return new Promise((resolve,reject)=>{const image=new Image(),url=URL.createObjectURL(file);image.onload=()=>{resolve({width:image.naturalWidth,height:image.naturalHeight});URL.revokeObjectURL(url);};image.onerror=()=>{reject(new Error(`${file.name} is not a readable image.`));URL.revokeObjectURL(url);};image.src=url;});}
function fileSize(bytes){return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.ceil(bytes/1024)} KB`;}

function resetDialog(host){ui.hostPanel.hidden=!host;ui.guestPanel.hidden=host;$('#connect-title').textContent=host?'Add a player':'Join a table';ui.connectStatus.textContent='';$('#answer-code').value='';}
function enterGame(){ui.lobby.hidden=true;ui.game.hidden=false;ui.connection.textContent=role==='host'?'Hosting locally':'Connecting…';}
function cleanName(){return ui.name.value.trim().slice(0,24)||'Player';}
function readStoredName(){try{return localStorage.getItem('lptts-name')||'';}catch{return '';}}
function saveName(){try{localStorage.setItem('lptts-name',cleanName());}catch{/* Storage is optional. */}}
function sendChannel(channel,value){if(channel?.readyState==='open')channel.send(JSON.stringify(value));}
function connectionLabel(value){if(['failed','closed','disconnected'].includes(value))ui.connectStatus.textContent=`Connection ${value}. Create a fresh code and try again.`;}
function iceComplete(peer){if(peer.iceGatheringState==='complete')return Promise.resolve();return new Promise((resolve)=>{const timer=setTimeout(resolve,8000);peer.addEventListener('icegatheringstatechange',()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});}
function compactSdp(sdp) {
  const ufrag = sdp.match(/a=ice-ufrag:(.+)/)?.[1]?.trim() || '';
  const pwd = sdp.match(/a=ice-pwd:(.+)/)?.[1]?.trim() || '';
  const fp = (sdp.match(/a=fingerprint:sha-256\s+(.+)/)?.[1]?.trim() || '').replaceAll(':', '');
  const candidates = [];
  const candRegex = /a=candidate:(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+typ\s+(\S+)(?:\s+raddr\s+(\S+)\s+rport\s+(\d+))?/g;
  let m;
  while ((m = candRegex.exec(sdp)) !== null) {
    candidates.push([
      m[5], // ip
      Number(m[6]), // port
      m[7] === 'host' ? 0 : m[7] === 'srflx' ? 1 : 2, // typ
      m[8] || '', // raddr
      Number(m[9]) || 0, // rport
      m[3] === 'tcp' ? 1 : 0 // transport (0=udp, 1=tcp)
    ]);
  }
  return { ufrag, pwd, fp, candidates };
}

function expandSdp(ufrag, pwd, fp, candidates, type) {
  const formattedFp = fp.includes(':') ? fp : (fp.match(/.{1,2}/g)?.join(':') || fp);
  const sessionId = Math.floor(Math.random() * 1e9);
  let sdp = [
    'v=0',
    'o=- ' + sessionId + ' 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:' + ufrag,
    'a=ice-pwd:' + pwd,
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 ' + formattedFp,
    'a=setup:' + (type === 'offer' ? 'actpass' : 'active'),
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144'
  ];
  for (let i = 0; i < candidates.length; i++) {
    const [ip, port, typ, raddr, rport, transport] = candidates[i];
    const typeStr = typ === 0 ? 'host' : typ === 1 ? 'srflx' : 'relay';
    const transStr = transport === 1 ? 'tcp' : 'udp';
    const priority = typ === 0 ? 2113937151 : typ === 1 ? 1677729535 : 33562367;
    let line = 'a=candidate:' + (i + 1) + ' 1 ' + transStr + ' ' + priority + ' ' + ip + ' ' + port + ' typ ' + typeStr;
    if (raddr && rport) line += ' raddr ' + raddr + ' rport ' + rport;
    line += ' generation 0';
    sdp.push(line);
  }
  return sdp.join('\r\n') + '\r\n';
}

async function encode(value) {
  let payload;
  if (value.type === 'offer' && value.sdp?.sdp) {
    const c = compactSdp(value.sdp.sdp);
    payload = [2, 'O', value.id, c.ufrag, c.pwd, c.fp, c.candidates, value.turn || null];
  } else if (value.type === 'answer' && value.sdp?.sdp) {
    const c = compactSdp(value.sdp.sdp);
    payload = [2, 'A', value.id, value.name || '', c.ufrag, c.pwd, c.fp, c.candidates];
  } else {
    payload = value;
  }

  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    let binary = '';
    for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  } catch {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }
}

async function decode(code, type) {
  try {
    const normalized = code.trim().replaceAll('-', '+').replaceAll('_', '/');
    const pad = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(pad);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    let parsed;
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const decompressed = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      parsed = JSON.parse(new TextDecoder().decode(decompressed));
    } catch {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    }

    if (Array.isArray(parsed) && parsed[0] === 2) {
      if (parsed[1] === 'O' && type === 'offer') {
        const [v, t, id, ufrag, pwd, fp, candidates, turn] = parsed;
        return {
          v: 1,
          type: 'offer',
          id,
          sdp: { type: 'offer', sdp: expandSdp(ufrag, pwd, fp, candidates, 'offer') },
          turn: turn || undefined
        };
      }
      if (parsed[1] === 'A' && type === 'answer') {
        const [v, t, id, name, ufrag, pwd, fp, candidates] = parsed;
        return {
          v: 1,
          type: 'answer',
          id,
          name,
          sdp: { type: 'answer', sdp: expandSdp(ufrag, pwd, fp, candidates, 'answer') }
        };
      }
    }

    if (parsed.v === 1 && parsed.type === type && parsed.sdp) {
      return parsed;
    }
    throw 0;
  } catch {
    throw new Error(`That is not a valid ${type} code.`);
  }
}

function copy(value, message = 'Code copied to clipboard') {
  if (!value || !value.trim()) return toast('Nothing to copy', true);
  const text = value.trim();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast(message))
      .catch(() => fallbackCopy(text, message));
  } else {
    fallbackCopy(text, message);
  }
}

function fallbackCopy(value, message) {
  try {
    const temp = document.createElement('textarea');
    temp.value = value;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    toast(message);
  } catch {
    toast('Select and copy the code manually', true);
  }
}

async function pasteInto(element, message = 'Pasted from clipboard') {
  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        element.value = text.trim();
        toast(message);
        return;
      }
    }
  } catch {
    /* Browser clipboard read blocked or unavailable */
  }
  element.focus();
  element.select();
  toast('Ready to paste');
}

function toast(message, error = false) {
  ui.toast.textContent = message;
  ui.toast.style.background = error ? '#8f3434' : '#171b18';

  const openDialog = document.querySelector('dialog[open]');
  if (openDialog && ui.toast.parentElement !== openDialog) {
    openDialog.appendChild(ui.toast);
  } else if (!openDialog && ui.toast.parentElement !== document.body) {
    document.body.appendChild(ui.toast);
  }

  ui.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.remove('show'), 2600);
}
function randomCode(){return Math.random().toString(36).slice(2,7).toUpperCase();}
function newId(){if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();const bytes=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');}
function initials(name){return name.split(/\s+/).map(v=>v[0]).join('').slice(0,2).toUpperCase();}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function cssUrl(value){return String(value).replace(/["\\\n\r]/g,'');}
