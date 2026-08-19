import { GameRoom } from './game.js';
import { parseTtsDeck } from './tts.js';

const $ = (selector) => document.querySelector(selector);
const ui = { lobby:$('#lobby'), game:$('#game'), form:$('#join-form'), name:$('#name'), status:$('#lobby-status'), players:$('#players'), playerCount:$('#player-count'), connections:$('#connections'), connection:$('#connection'), tableCards:$('#table-cards'), empty:$('#empty-table'), deck:$('#deck'), deckCount:$('.deck-count'), deckLabel:$('#deck-label'), shuffle:$('#shuffle'), hand:$('#hand'), handCount:$('#hand-count'), file:$('#tts-file'), toast:$('#toast'), dialog:$('#connect-dialog'), hostPanel:$('#connect-host'), guestPanel:$('#connect-guest'), connectStatus:$('#connect-status') };
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] };
let role = '', playerId = '', state, room, hostPending, guestPeer, guestChannel;
const peers = new Map();

ui.name.value = readStoredName();
window.lpttsReady = true;
ui.form.addEventListener('submit', (event) => { event.preventDefault(); hostTable(); });
$('#join-button').addEventListener('click', () => openJoin());
ui.connections.addEventListener('click', () => role === 'host' ? createOffer() : toast('Only the host can add players'));
$('#copy-offer').addEventListener('click', () => copy($('#offer-code').value, 'Offer code copied'));
$('#copy-answer').addEventListener('click', () => copy($('#guest-answer').value, 'Answer code copied'));
$('#make-answer').addEventListener('click', makeAnswer);
$('#accept-answer').addEventListener('click', acceptAnswer);
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
$('#help').addEventListener('click', () => $('#help-dialog').showModal());
$('#import-button').addEventListener('click', () => role === 'host' ? ui.file.click() : toast('Only the host can import a deck', true));
ui.file.addEventListener('change', importDeck);
ui.deck.addEventListener('click', () => action('draw'));
ui.shuffle.addEventListener('click', () => action('shuffle'));

function hostTable() {
  try {
    saveName(); role = 'host'; playerId = newId();
    room = new GameRoom(randomCode()); room.join(playerId, ui.name.value); updateHost(); enterGame();
  } catch (error) {
    role = ''; ui.status.textContent = `Could not open the table: ${error.message || 'unsupported browser feature'}`;
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
    const peer = new RTCPeerConnection(RTC_CONFIG);
    const channel = peer.createDataChannel('lptts', { ordered: true });
    const id = newId(); hostPending = { peer, channel, id };
    wireHostPeer(hostPending); await peer.setLocalDescription(await peer.createOffer()); await iceComplete(peer);
    $('#offer-code').value = encode({ v:1, type:'offer', id, sdp:peer.localDescription });
    ui.dialog.showModal();
  } catch (error) { toast(`Could not create an offer: ${error.message}`, true); }
}

async function makeAnswer() {
  try {
    const offer = decode($('#join-offer').value, 'offer');
    guestPeer?.close(); guestPeer = new RTCPeerConnection(RTC_CONFIG);
    guestPeer.addEventListener('datachannel', ({ channel }) => { guestChannel = channel; wireGuestChannel(channel); });
    guestPeer.addEventListener('connectionstatechange', () => connectionLabel(guestPeer.connectionState));
    await guestPeer.setRemoteDescription(offer.sdp); await guestPeer.setLocalDescription(await guestPeer.createAnswer()); await iceComplete(guestPeer);
    $('#guest-answer').value = encode({ v:1, type:'answer', id:offer.id, name:cleanName(), sdp:guestPeer.localDescription });
    $('#answer-result').hidden = false; ui.connectStatus.textContent = 'Send this answer to the host, then wait for the table to open.';
  } catch (error) { ui.connectStatus.textContent = error.message; }
}

async function acceptAnswer() {
  try {
    const answer = decode($('#answer-code').value, 'answer');
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
  channel.addEventListener('message', ({data}) => { const message=JSON.parse(data); if(message.type==='welcome')playerId=message.playerId; if(message.type==='state'){state=message.state;render();} if(message.type==='error')toast(message.message,true); });
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
  for(const [id,entry] of peers){sendChannel(entry.channel,{type:'welcome',playerId:id});sendChannel(entry.channel,{type:'state',state:room.viewFor(id)});}
}

async function importDeck() {
  try { const cards=parseTtsDeck(await ui.file.files[0].text());room.importDeck(cards);updateHost();toast(`Imported ${cards.length} cards`); }
  catch(error){toast(error.message,true);} finally{ui.file.value='';}
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

function resetDialog(host){ui.hostPanel.hidden=!host;ui.guestPanel.hidden=host;$('#connect-title').textContent=host?'Add a player':'Join a table';ui.connectStatus.textContent='';$('#answer-code').value='';}
function enterGame(){ui.lobby.hidden=true;ui.game.hidden=false;ui.connection.textContent=role==='host'?'Hosting locally':'Connecting…';}
function cleanName(){return ui.name.value.trim().slice(0,24)||'Player';}
function readStoredName(){try{return localStorage.getItem('lptts-name')||'';}catch{return '';}}
function saveName(){try{localStorage.setItem('lptts-name',cleanName());}catch{/* Storage is optional. */}}
function sendChannel(channel,value){if(channel?.readyState==='open')channel.send(JSON.stringify(value));}
function connectionLabel(value){if(['failed','closed','disconnected'].includes(value))ui.connectStatus.textContent=`Connection ${value}. Create a fresh code and try again.`;}
function iceComplete(peer){if(peer.iceGatheringState==='complete')return Promise.resolve();return new Promise((resolve)=>{const timer=setTimeout(resolve,8000);peer.addEventListener('icegatheringstatechange',()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});}
function encode(value){const bytes=new TextEncoder().encode(JSON.stringify(value));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
function decode(code,type){try{const normalized=code.trim().replaceAll('-','+').replaceAll('_','/');const binary=atob(normalized);const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const value=JSON.parse(new TextDecoder().decode(bytes));if(value.v!==1||value.type!==type||!value.sdp)throw 0;return value;}catch{throw new Error(`That is not a valid ${type} code.`);}}
function copy(value,message){if(!value)return;navigator.clipboard.writeText(value).then(()=>toast(message)).catch(()=>toast('Select and copy the code manually',true));}
function toast(message,error=false){ui.toast.textContent=message;ui.toast.style.background=error?'#8f3434':'';ui.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>ui.toast.classList.remove('show'),2600);}
function randomCode(){return Math.random().toString(36).slice(2,7).toUpperCase();}
function newId(){if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();const bytes=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');}
function initials(name){return name.split(/\s+/).map(v=>v[0]).join('').slice(0,2).toUpperCase();}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function cssUrl(value){return String(value).replace(/["\\\n\r]/g,'');}
