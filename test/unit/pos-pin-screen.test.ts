import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tapPinDigits } from '../../test/screens/pos-pin.ts';
import { readFileSync } from 'node:fs';
import { appiumLogFiltersFile } from '../../core/runner/log-filters.ts';

const keypad = new Map([...'0123456789'].map(digit => [digit, `element-${digit}`]));

test('taps the PIN pad keys in PIN order by element id', async () => {
  const tapped: string[] = [];
  await tapPinDigits('4071', keypad, async id => { tapped.push(id); });
  assert.deepEqual(tapped, ['element-4', 'element-0', 'element-7', 'element-1']);
});

test('stops before tapping when the PIN pad lacks a needed digit', async () => {
  const tapped: string[] = [];
  const partial = new Map([['1', 'element-1']]);
  await assert.rejects(tapPinDigits('12', partial, async id => { tapped.push(id); }), /missing a digit button/);
  assert.deepEqual(tapped, []);
});

test('the Appium log filter masks every PIN pad key name', () => {
  const line = '[Xcode] t = 5.87s Tap "Component.PINPad.KeyPad.DigitButton.7" Button, then DigitButton.0';
  const rules = JSON.parse(readFileSync(appiumLogFiltersFile, 'utf8')) as { pattern: string; replacer: string }[];
  const masked = rules.reduce((text, rule) => text.replace(new RegExp(rule.pattern, 'g'), rule.replacer), line);
  assert.doesNotMatch(masked, /DigitButton\.[0-9]/);
  assert.match(masked, /DigitButton\.\*/);
});
