import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setCredentialKeyForTesting } from '../../core/storage/credential-key.ts';
import { forgetPosPin, readPosPin, savePosPin, savedPosPin } from '../../core/storage/pos-pin.ts';

const testKey = Buffer.alloc(32, 9);
const ipad = '00008103-0000000000000001';
const otherIpad = '00008103-0000000000000002';

async function root(): Promise<string> {
  setCredentialKeyForTesting(testKey);
  return mkdtemp(join(tmpdir(), 'ios-testing-pos-pin-'));
}

function storePath(dir: string): string { return join(dir, '.runtime', 'pos-pins.json'); }

test('a saved PIN round-trips and never appears in the file on disk', async () => {
  const dir = await root();
  await savePosPin(dir, ipad, '482913');
  assert.doesNotMatch(await readFile(storePath(dir), 'utf8'), /482913/);
  assert.equal(await readPosPin(dir, ipad), '482913');
});

test('the PIN file is owner-only', async () => {
  const dir = await root();
  await savePosPin(dir, ipad, '4829');
  assert.equal((await stat(storePath(dir))).mode & 0o777, 0o600);
});

test('the saved view tells the page a PIN exists without returning it', async () => {
  const dir = await root();
  assert.equal(await savedPosPin(dir, ipad), null);
  await savePosPin(dir, ipad, '482913');
  const saved = await savedPosPin(dir, ipad);
  assert.equal(saved?.udid, ipad);
  assert.ok(saved?.updatedAt);
  assert.doesNotMatch(JSON.stringify(saved), /482913/);
});

test('accepts only a Shopify POS PIN of 4 to 6 digits for an exact iPad UDID', async () => {
  const dir = await root();
  await assert.rejects(savePosPin(dir, ipad, '123'), /4 to 6 digits/);
  await assert.rejects(savePosPin(dir, ipad, '1234567'), /4 to 6 digits/);
  await assert.rejects(savePosPin(dir, ipad, '12a4'), /4 to 6 digits/);
  await assert.rejects(savePosPin(dir, 'auto', '1234'), /iPad/);
});

test('each iPad keeps its own PIN, and saving again replaces it', async () => {
  const dir = await root();
  await savePosPin(dir, ipad, '1111');
  await savePosPin(dir, otherIpad, '2222');
  await savePosPin(dir, ipad, '3333');
  assert.equal(await readPosPin(dir, ipad), '3333');
  assert.equal(await readPosPin(dir, otherIpad), '2222');
});

test('a PIN record moved to another iPad does not decrypt', async () => {
  const dir = await root();
  await savePosPin(dir, ipad, '482913');
  const file = JSON.parse(await readFile(storePath(dir), 'utf8')) as { entries: { udid: string }[] };
  file.entries[0]!.udid = otherIpad;
  await writeFile(storePath(dir), JSON.stringify(file));
  await assert.rejects(readPosPin(dir, otherIpad));
});

test('forgetting a PIN removes it', async () => {
  const dir = await root();
  await savePosPin(dir, ipad, '482913');
  assert.equal(await forgetPosPin(dir, ipad), true);
  assert.equal(await readPosPin(dir, ipad), null);
  assert.equal(await forgetPosPin(dir, ipad), false);
});
