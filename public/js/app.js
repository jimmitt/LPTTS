import { parseTtsDeck } from './tts.js';

const $ = (selector) => document.querySelector(selector);
const ui = { lobby:$('#lobby'), game:$('#game'), form:$('#join-form'), name:$('#name'), room:$('#room'), server:$('#server-url'), status:$('#lobby-status'), players:$('#players'), playerCount:$('#player-count'), roomCode:$('#copy-room'), connection:$('#connection'), tableCards:$('#table-cards'), empty:$('#empty-table'), deck:$('#deck'), deckCount:$('.deck-count'), deckLabel:$('#deck-label'), shuffle:$('#shuffle'), hand:$('#hand'), handCount:$('#hand-count'), file:$('#tts-file'), toast:$('#toast') };
let socket, playerId = 'local', state, offline = false;
let local = { code:'DEMO', deckCount:0, deckBack:'', deck:[], table:[], players:[{id:'local',name:'You',color:'#e76f51',handCount:0,hand:[]},{id:'guest',name:'Guest preview',color:'#2a9d8f',handCount:3}] };

ui.name.value = localStorage.getItem('lptts-name') || '';
const params = new URLSearchParams(location.search);
ui.room.value = params.get('room') || '';
ui.server.value = params.get('server') || localStorage.getItem('lptts-server') || (location.protocol === 'http:' && location.hostname === 'localhost' ? `ws://${location.host}` : '');

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const server = ui.server.value.trim();
  if (!server) return setStatus('Add a WebSocket server URL, or try the offline table.');
  localStorage.setItem('lptts-name', ui.name.value); localStorage.setItem('lptts-server', server);
  connect(server);
});
$('#demo-button').addEventListener('click', () => startOffline());
$('#import-button').addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', async () => {
  try { const text = await ui.file.files[0].text(); if (offline) { local.deck = parseTtsDeck(text); local.deckCount=local.deck.length; local.deckBack=local.deck.at(-1)?.back||''; updateLocal(); } else send('import',{data:text}); toast(`Imported ${offline ? local.deck.length : 'the'} cards`); }
  catch (error) { toast(error.message, true); } finally { ui.file.value=''; }
});
ui.deck.addEventListener('click', () => action('draw'));
ui.shuffle.addEventListener('click', () => action('shuffle'));
ui.roomCode.addEventListener('click', async () => { const url = new URL(location.href); url.searchParams.set('room',state.code); if (!offline && ui.server.value) url.searchParams.set('server',ui.server.value); await navigator.clipboard?.writeText(url.href); toast('Invite link copied'); });
$('#help').addEventListener('click', () => $('#help-dialog').showModal());
$('.dialog-close').addEventListener('click', () => $('#help-dialog').close());

function connect(url) {
  setStatus('Connecting…');
  try { socket = new WebSocket(url); } catch { return setStatus('That server URL is not valid.'); }
  const timeout = setTimeout(() => { if (socket.readyState !== 1) { socket.close(); setStatus('The server did not respond. Check its URL.'); } }, 7000);
  socket.addEventListener('open', () => { clearTimeout(timeout); socket.send(JSON.stringify({type:'join',name:ui.name.value,code:ui.room.value})); });
  socket.addEventListener('message', ({data}) => { const message=JSON.parse(data); if(message.type==='joined'){playerId=message.playerId; enterGame();} if(message.type==='state'){state=message.state;render();} if(message.type==='error')toast(message.message,true); });
  socket.addEventListener('close', () => { if(!offline){ui.connection.textContent='Disconnected'; setStatus('Connection closed.');} });
  socket.addEventListener('error', () => setStatus('Could not reach that WebSocket server.'));
}
function startOffline(){ offline=true; local.players[0].name=ui.name.value.trim()||'You'; state=local; enterGame(); updateLocal(); }
function enterGame(){ ui.lobby.hidden=true; ui.game.hidden=false; ui.connection.textContent=offline?'Offline demo':'Connected'; }
function send(type, body={}) { if(socket?.readyState===1) socket.send(JSON.stringify({type,...body})); }
function action(type,body={}) {
  if(!offline) return send(type,body);
  const me=local.players[0];
  if(type==='draw'){const card=local.deck.pop();if(!card)return toast('The deck is empty',true);me.hand.push({...card,owner:'local'});}
  if(type==='shuffle') for(let i=local.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[local.deck[i],local.deck[j]]=[local.deck[j],local.deck[i]];}
  if(type==='play'){const i=me.hand.findIndex(c=>c.id===body.cardId);if(i>=0){const [card]=me.hand.splice(i,1);local.table.push({...card,x:body.x||50,y:body.y||45,faceUp:true,rotation:0});}}
  if(type==='take'){const i=local.table.findIndex(c=>c.id===body.cardId);if(i>=0)me.hand.push(local.table.splice(i,1)[0]);}
  if(type==='flip'){const card=local.table.find(c=>c.id===body.cardId);if(card)card.faceUp=!card.faceUp;}
  if(type==='move'){const card=local.table.find(c=>c.id===body.cardId);if(card){card.x=body.x;card.y=body.y;}}
  updateLocal();
}
function updateLocal(){local.deckCount=local.deck.length;local.deckBack=local.deck.at(-1)?.back||'';local.players[0].handCount=local.players[0].hand.length;state=local;render();}

function render(){
  if(!state)return; ui.roomCode.textContent=state.code; ui.playerCount.textContent=state.players.length;
  ui.players.replaceChildren(...state.players.map(player=>{const row=document.createElement('div');row.className='player-row';const backs=Array.from({length:Math.min(player.handCount,5)},()=>'<i></i>').join('');row.innerHTML=`<span class="avatar" style="background:${player.color}">${escapeHtml(initials(player.name))}</span><span class="player-name">${escapeHtml(player.name)}${player.id===playerId?' (you)':''}</span><span class="player-cards">${backs}<small>${player.handCount}</small></span>`;return row;}));
  const me=state.players.find(p=>p.id===playerId);ui.handCount.textContent=me?.handCount||0;ui.hand.replaceChildren(...(me?.hand||[]).map(handCard));
  ui.deckCount.textContent=state.deckCount;ui.deckLabel.textContent=state.deckCount?`${state.deckCount} cards`:'No deck';ui.deck.disabled=!state.deckCount;ui.shuffle.disabled=!state.deckCount;
  if(state.deckBack) ui.deck.style.backgroundImage=`url("${cssUrl(state.deckBack)}")`; else ui.deck.style.backgroundImage='';
  ui.tableCards.replaceChildren(...state.table.map(tableCard));ui.empty.hidden=state.table.length>0;
}
function handCard(card){const el=cardElement(card,true);el.title='Double-click to play';el.addEventListener('dblclick',()=>action('play',{cardId:card.id,x:45+Math.random()*10,y:42+Math.random()*8}));return el;}
function tableCard(card,index){const el=cardElement(card,card.faceUp);el.classList.add('table-card');el.style.left=`${card.x}%`;el.style.top=`${card.y}%`;el.style.zIndex=index+1;el.style.transform=`translate(-50%,-50%) rotate(${card.rotation||0}deg)`;el.addEventListener('dblclick',()=>action('flip',{cardId:card.id}));el.addEventListener('contextmenu',(e)=>{e.preventDefault();action('take',{cardId:card.id});});el.addEventListener('pointerdown',(event)=>drag(event,el,card));return el;}
function drag(event,el,card){event.preventDefault();el.setPointerCapture(event.pointerId);const table=$('#table');const move=(e)=>{const box=table.getBoundingClientRect();const x=Math.max(3,Math.min(97,(e.clientX-box.left)/box.width*100));const y=Math.max(3,Math.min(97,(e.clientY-box.top)/box.height*100));el.style.left=`${x}%`;el.style.top=`${y}%`;el.dataset.x=x;el.dataset.y=y;};const up=()=>{el.removeEventListener('pointermove',move);action('move',{cardId:card.id,x:Number(el.dataset.x)||card.x,y:Number(el.dataset.y)||card.y});};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up,{once:true});}
function cardElement(card,faceUp){const el=document.createElement('div');el.className='card';if(faceUp&&card.face){const face=document.createElement('div');face.className='card-face';const {index=0,width=1,height=1}=card.sheet||{};face.style.backgroundImage=`url("${cssUrl(card.face)}")`;face.style.backgroundSize=`${width*100}% ${height*100}%`;face.style.backgroundPosition=`${width>1?(index%width)/(width-1)*100:0}% ${height>1?Math.floor(index/width)/(height-1)*100:0}%`;el.append(face);}else{const back=document.createElement('div');back.className='card-back';if(card.back){back.style.backgroundImage=`url("${cssUrl(card.back)}")`;back.style.backgroundSize='cover';back.textContent='';}else back.textContent='LPTTS';el.append(back);}if(faceUp){const name=document.createElement('span');name.className='card-name';name.textContent=card.name;el.append(name);}return el;}
function toast(message,error=false){ui.toast.textContent=message;ui.toast.style.background=error?'#8f3434':'';ui.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>ui.toast.classList.remove('show'),2600);}
function setStatus(message){ui.status.textContent=message;}
function initials(name){return name.split(/\s+/).map(v=>v[0]).join('').slice(0,2).toUpperCase();}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function cssUrl(value){return String(value).replace(/["\\\n\r]/g,'');}
