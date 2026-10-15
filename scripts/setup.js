import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) { console.log('.env already exists; no changes made.'); }
else {
  const example = readFileSync('.env.example', 'utf8');
  writeFileSync('.env', example.replace(/^IDENTITY_ENCRYPTION_KEY=$/m, `IDENTITY_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`));
  console.log('Created .env with a local identity encryption key. Back it up securely and keep it stable.');
}
