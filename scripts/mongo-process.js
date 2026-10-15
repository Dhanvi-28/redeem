import { spawn } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
export async function startMongo({ directory, port, replicaSet }) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is occupied. Stop your previous EcoSync database process or choose a different port; no existing database was modified.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  mkdirSync(directory, { recursive: true });
  const defaultPath = 'C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe';
  const binary = process.env.MONGOD_PATH || (existsSync(defaultPath) ? defaultPath : 'mongod');
  const child = spawn(binary, ['--dbpath', directory, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', replicaSet, '--logpath', join(directory, 'mongod.log')], { windowsHide: true, stdio: 'ignore' });
  let spawnError; child.on('error', error => { spawnError = error; });
  const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
  let connected = false;
  for (let i = 0; i < 80; i++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`mongod exited with code ${child.exitCode}. Check ${join(directory, 'mongod.log')}`);
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 500 });
    try {
      await client.connect();
      try { await client.db('admin').command({ replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host: `127.0.0.1:${port}` }] } }); } catch (e) { if (e.code !== 23) throw e; }
      const hello = await client.db('admin').command({ hello: 1 });
      if (hello.isWritablePrimary) { connected = true; break; }
    } catch (e) { if (i === 79) { child.kill(); throw e; } }
    finally { await client.close(); }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!connected) { child.kill(); throw new Error('MongoDB did not become primary.'); }
  return { child, uri: `mongodb://127.0.0.1:${port}/ecosync?replicaSet=${replicaSet}` };
}
