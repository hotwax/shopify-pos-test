import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

export interface Sealed {
  iv: string;
  authTag: string;
  secret: string;
}

const algorithm = 'aes-256-gcm';

export function seal(key: Buffer, text: string, associatedData: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(associatedData);
  const secret = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), secret: secret.toString('base64') };
}

export function unseal(key: Buffer, sealed: Sealed, associatedData: Buffer): string {
  const decipher = createDecipheriv(algorithm, key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(associatedData);
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.secret, 'base64')), decipher.final()]).toString('utf8');
}

export async function writeOwnerOnlyJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}
