import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTtsDeck } from '../docs/js/tts.js';

test('imports cards from a TTS deck sheet', () => {
  const cards = parseTtsDeck({ObjectStates:[{Name:'Deck',CustomDeck:{1:{FaceURL:'https://example.com/face.jpg',BackURL:'https://example.com/back.jpg',NumWidth:10,NumHeight:7}},ContainedObjects:[{Name:'Card',CardID:100,Nickname:'Ace'},{Name:'Card',CardID:101,Nickname:'Two'}]}]});
  assert.equal(cards.length,2); assert.equal(cards[1].sheet.index,1); assert.equal(cards[0].sheet.width,10); assert.equal(cards[0].name,'Ace');
});
test('rejects files with no cards',()=>assert.throws(()=>parseTtsDeck({ObjectStates:[]}),/No cards/));
test('drops unsafe image URL schemes',()=>{const [card]=parseTtsDeck({ObjectStates:[{Name:'Card',CardID:100,CustomDeck:{1:{FaceURL:'javascript:alert(1)'}}}]});assert.equal(card.face,'');});
test('recognizes direct TTS saved objects and explains local artwork',()=>assert.throws(()=>parseTtsDeck({Name:'DeckCustom',CustomDeck:{1:{FaceURL:'file:///faces.jpg',BackURL:'file:///back.jpg'}},ContainedObjects:[{Name:'CardCustom',CardID:100}]}),/Create image deck/));
