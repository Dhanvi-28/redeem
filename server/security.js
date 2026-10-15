import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function identityCrypto(keyHex) {
  if (!/^[a-f0-9]{64}$/i.test(keyHex || '')) throw new Error('IDENTITY_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  const key = Buffer.from(keyHex, 'hex');
  return {
    encrypt(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map(x => x.toString('base64')).join('.');
    },
    decrypt(value) {
      const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    },
  };
}
