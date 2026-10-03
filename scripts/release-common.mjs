import { spawnSync } from 'node:child_process';
import { existsSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function options(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!allowed.includes(key) || key in result) throw new Error('Unknown or duplicate argument: ' + key);
    if (key === '--help' || key === '--dry-run') result[key] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key);
      result[key] = value;
    }
  }
  return result;
}
export function tagName(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value)) throw new Error('Invalid release tag');
  return value;
}
export function shellQuote(value) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
export function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + ' failed (exit ' + result.status + ')');
  return result.stdout?.trim();
}
export function dockerPath() {
  if (process.env.DOCKER_BIN) return process.env.DOCKER_BIN;
  if (process.platform === 'win32') {
    for (const base of [process.env.LOCALAPPDATA, process.env.ProgramFiles]) {
      if (!base) continue;
      for (const part of ['Programs/DockerDesktop/resources/bin/docker.exe', 'Docker/Docker/resources/bin/docker.exe']) {
        const candidate = join(base, part);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return 'docker';
}
export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export const releasePath = (value) => resolve(root, value);
