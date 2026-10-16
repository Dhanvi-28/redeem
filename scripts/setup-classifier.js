import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const venv = resolve(root, '.local/classifier-venv');
const python = process.env.CLASSIFIER_PYTHON || resolve(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `${command} exited with code ${result.status}`);
    process.exit(1);
  }
}
if (!process.env.CLASSIFIER_PYTHON && !existsSync(python)) {
  mkdirSync(resolve(root, '.local'), { recursive: true });
  run(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-m', 'venv', venv]);
}
run(python, ['-m', 'pip', 'install', '-r', 'classifier/requirements.txt']);
// Configure only empty / absent entries; retain existing remote classifier settings.
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  let content = readFileSync(envPath, 'utf8');
  const port = process.env.CLASSIFIER_PORT || '8001';
  for (const [name, value] of Object.entries({ AI_MODEL_ENDPOINT: `http://127.0.0.1:${port}/predict`, AI_HEALTH_ENDPOINT: `http://127.0.0.1:${port}/health` })) {
    const line = new RegExp(`^${name}=(.*)$`, 'm');
    const match = content.match(line);
    if (!match) content += `\n${name}=${value}\n`;
    else if (!match[1].trim()) content = content.replace(line, `${name}=${value}`);
  }
  writeFileSync(envPath, content);
}
console.log('Classifier dependencies installed. Run npm run classifier, then restart EcoSync.');
