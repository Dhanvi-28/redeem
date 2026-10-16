import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.CLASSIFIER_PYTHON || resolve(root, '.local/classifier-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python) && !process.env.CLASSIFIER_PYTHON) {
  console.error('Classifier Python environment is missing. Run npm run classifier:setup first.');
  process.exit(1);
}
const port = Number(process.env.CLASSIFIER_PORT || 8001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CLASSIFIER_PORT.');
const child = spawn(python, ['-m', 'uvicorn', 'classifier.service:app', '--host', process.env.CLASSIFIER_HOST || '127.0.0.1', '--port', String(port), '--limit-concurrency', '8', '--h11-max-incomplete-event-size', '8192'], {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, YOLO_CONFIG_DIR: resolve(root, '.local/ultralytics') },
});
child.on('error', error => { console.error(`Could not start classifier: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
