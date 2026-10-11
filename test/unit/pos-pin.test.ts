import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pinPadTapCoordinates } from '../support/pos-pin.ts';
const keypad = Array.from({length:10}, (_,digit) => `<XCUIElementTypeButton name="Component.PINPad.KeyPad.DigitButton.${digit}" enabled="true" visible="true" x="${digit*100}" y="100" width="80" height="60"/>`).join('');
test('POS keypad maps each digit in order into one keypad snapshot, preserving leading zeroes and repeats', () => {
  assert.deepEqual(pinPadTapCoordinates(keypad, '0012'), [{x:40,y:130},{x:40,y:130},{x:140,y:130},{x:240,y:130}]);
});
test('numeric and string POS PIN inputs use the same mapping and timing', () => {
  assert.deepEqual(pinPadTapCoordinates(keypad,1234), pinPadTapCoordinates(keypad,'1234'));
  assert.equal(pinPadTapCoordinates(keypad,'987654').length,6);
});
test('fast POS entry refuses partial, hidden or invalid keypad geometry', () => {
  assert.throws(()=>pinPadTapCoordinates(keypad.replace('DigitButton.0','OtherButton'),'1234'));
  assert.throws(()=>pinPadTapCoordinates(keypad.replace('visible="true"','visible="false"'),'1234'));
  assert.throws(()=>pinPadTapCoordinates(keypad.replace('width="80"','width="0"'),'1234'));
  assert.throws(()=>pinPadTapCoordinates(keypad,'bad'));
});
