import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageDeck } from '../docs/js/image-deck.js';

const image = 'data:image/jpeg;base64,YQ==';

test('creates the requested number of cards from an image grid', () => {
  const cards = createImageDeck({ name:'Legendary Profiles', face:image, back:image, columns:7, rows:7, count:43 });
  assert.equal(cards.length,43);
  assert.deepEqual(cards[42].sheet,{index:42,width:7,height:7,uniqueBack:false});
  assert.equal(cards[0].name,'Legendary Profiles 1');
});

test('rejects a card count larger than the grid', () => {
  assert.throws(()=>createImageDeck({face:image,back:image,columns:2,rows:2,count:5}),/cannot exceed/);
});
