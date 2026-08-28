import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../docs/js/game.js';

const card=()=>({id:crypto.randomUUID(),name:'Secret',face:'https://example.com/f.jpg',back:'https://example.com/b.jpg',sheet:{index:0,width:1,height:1}});
test('never exposes another player hand',()=>{const room=new GameRoom('TEST');room.join('a','Alice');room.join('b','Bob');room.importDeck([card()]);room.draw('a');assert.equal(room.viewFor('a').players[0].hand.length,1);assert.equal(room.viewFor('b').players[0].hand,undefined);assert.equal(room.viewFor('b').players[0].handCount,1);});
test('moves cards between private hand and public table',()=>{const room=new GameRoom('TEST');room.join('a','Alice');room.importDeck([card()]);room.draw('a');const id=room.players.get('a').hand[0].id;room.play('a',id,20,30);assert.equal(room.table[0].id,id);assert.equal(room.players.get('a').hand.length,0);room.take('a',id);assert.equal(room.table.length,0);assert.equal(room.players.get('a').hand.length,1);});
test('restores the authoritative room after a host refresh',()=>{const room=new GameRoom('TEST');room.join('a','Alice');room.join('b','Bob');room.importDeck([card()]);room.draw('b');const restored=GameRoom.restore(JSON.parse(JSON.stringify(room.serialize())));assert.deepEqual(restored.viewFor('b'),room.viewFor('b'));assert.equal(restored.players instanceof Map,true);});
