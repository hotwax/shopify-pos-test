import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setCredentialKeyForTesting } from '../../core/storage/credential-key.ts';
import { autoConnectSavedOmsConnections, forgetOmsCredential, listSavedOmsConnections, readOmsCredential, saveOmsCredential } from '../../core/storage/credentials.ts';

// A fixed key stands in for the Keychain so the suite never touches the real one.
const testKey = Buffer.alloc(32, 7);

async function root(): Promise<string> {
  setCredentialKeyForTesting(testKey);
  return mkdtemp(join(tmpdir(), 'ios-testing-credentials-'));
}

function storePath(dir: string): string { return join(dir, '.runtime', 'oms-credentials.json'); }

test('a saved password round-trips and never appears in the file on disk', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'Test-Maarg', username: 'codex.aditya', password: 'correct horse battery staple' });

  const raw = await readFile(storePath(dir), 'utf8');
  assert.doesNotMatch(raw, /correct horse battery staple/, 'the password must never be written in the clear');
  assert.match(raw, /codex\.aditya/, 'the username stays readable so connections can be listed without unlocking');

  const restored = await readOmsCredential(dir, 'test-maarg::codex.aditya');
  assert.equal(restored?.password, 'correct horse battery staple');
  assert.equal(restored?.instanceName, 'test-maarg', 'the instance name is normalized on save');
});

test('the credential file is owner-only', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'a', password: 'b' });

  const mode = (await stat(storePath(dir))).mode & 0o777;
  assert.equal(mode, 0o600, 'a credential file must not be group or world readable');
});

test('many connections are kept side by side and listed without secrets', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'one' });
  await saveOmsCredential(dir, { instanceName: 'dev-oms', username: 'grace', password: 'two' });
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'grace', password: 'three' });

  const saved = await listSavedOmsConnections(dir);
  assert.equal(saved.length, 3, 'the same instance can hold more than one user');
  assert.deepEqual(saved.map(entry => entry.id), ['dev-oms::grace', 'test-maarg::ada', 'test-maarg::grace']);
  assert.doesNotMatch(JSON.stringify(saved), /one|two|three|iv|authTag|secret/);

  assert.equal((await readOmsCredential(dir, 'test-maarg::grace'))?.password, 'three');
});

test('saving the same instance and user again replaces the password rather than duplicating it', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'old' });
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'new' });

  assert.equal((await listSavedOmsConnections(dir)).length, 1);
  assert.equal((await readOmsCredential(dir, 'test-maarg::ada'))?.password, 'new');
});

test('a record re-pointed at another instance or user fails to decrypt', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'secret' });

  const file = JSON.parse(await readFile(storePath(dir), 'utf8'));
  file.entries[0].instanceName = 'prod-oms';
  const { writeFile } = await import('node:fs/promises');
  await writeFile(storePath(dir), JSON.stringify(file));

  await assert.rejects(() => readOmsCredential(dir, 'test-maarg::ada').then(value => value ?? Promise.reject(new Error('missing'))));
});

test('a tampered ciphertext is rejected instead of returning partial bytes', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'secret' });

  const file = JSON.parse(await readFile(storePath(dir), 'utf8'));
  const flipped = Buffer.from(file.entries[0].secret, 'base64');
  flipped[0] ^= 0xff;
  file.entries[0].secret = flipped.toString('base64');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(storePath(dir), JSON.stringify(file));

  await assert.rejects(() => readOmsCredential(dir, 'test-maarg::ada'));
});

test('a different key cannot read a stored password', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'secret' });

  setCredentialKeyForTesting(Buffer.alloc(32, 9));
  await assert.rejects(() => readOmsCredential(dir, 'test-maarg::ada'));
  setCredentialKeyForTesting(testKey);
});

test('each save uses a fresh nonce, so the same password does not produce the same ciphertext', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'same' });
  const first = JSON.parse(await readFile(storePath(dir), 'utf8')).entries[0];
  await saveOmsCredential(dir, { instanceName: 'dev-oms', username: 'ada', password: 'same' });
  const entries = JSON.parse(await readFile(storePath(dir), 'utf8')).entries;
  const second = entries.find((entry: { instanceName: string }) => entry.instanceName === 'dev-oms');

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.secret, second.secret);
});

test('forgetting a connection removes it and reports whether anything was removed', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'secret' });

  assert.equal(await forgetOmsCredential(dir, 'test-maarg::ada'), true);
  assert.equal(await forgetOmsCredential(dir, 'test-maarg::ada'), false);
  assert.deepEqual(await listSavedOmsConnections(dir), []);
  assert.equal(await readOmsCredential(dir, 'test-maarg::ada'), null);
});

test('an invalid instance name, empty username or empty password is refused', async () => {
  const dir = await root();
  await assert.rejects(() => saveOmsCredential(dir, { instanceName: 'bad_name', username: 'ada', password: 'x' }), /instance name/i);
  await assert.rejects(() => saveOmsCredential(dir, { instanceName: 'test-maarg', username: '  ', password: 'x' }), /username/i);
  await assert.rejects(() => saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: '' }), /password/i);
});

test('a missing or corrupt store reads as empty rather than throwing', async () => {
  const dir = await root();
  assert.deepEqual(await listSavedOmsConnections(dir), []);

  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'secret' });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(storePath(dir), 'not json');
  assert.deepEqual(await listSavedOmsConnections(dir), []);
});

test('auto-connect signs in to saved connections and reports failures without leaking secrets', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'p4ssw0rd-one' });
  await saveOmsCredential(dir, { instanceName: 'dev-oms', username: 'grace', password: 'p4ssw0rd-two' });
  await saveOmsCredential(dir, { instanceName: 'old-oms', username: 'bob', password: 'p4ssw0rd-old', autoConnect: false });

  const seen: { instanceName: string; username: string }[] = [];
  const result = await autoConnectSavedOmsConnections(dir, {
    addConnection: ({ instanceName }) => ({ id: `conn-${instanceName}` }),
    login: async (connectionId, credentials) => {
      seen.push({ instanceName: connectionId, username: credentials.username });
      if (credentials.username === 'grace') throw new Error('The OMS rejected the password.');
    },
  });

  assert.deepEqual(result.connected, ['test-maarg::ada']);
  assert.deepEqual(result.failed.map(entry => entry.id), ['dev-oms::grace']);
  assert.equal(seen.length, 2, 'the manual-only connection must not be signed in automatically');
  assert.doesNotMatch(JSON.stringify(result), /p4ssw0rd/, 'a failure reason must never carry the password');
});

test('auto-connect degrades to nothing when the key store is unavailable', async () => {
  const dir = await root();
  await saveOmsCredential(dir, { instanceName: 'test-maarg', username: 'ada', password: 'secret' });
  setCredentialKeyForTesting(Buffer.alloc(32, 9));

  const result = await autoConnectSavedOmsConnections(dir, {
    addConnection: ({ instanceName }) => ({ id: `conn-${instanceName}` }),
    login: async () => undefined,
  });

  assert.deepEqual(result.connected, [], 'an unreadable password must not be silently skipped as success');
  assert.equal(result.failed.length, 1);
  setCredentialKeyForTesting(testKey);
});
