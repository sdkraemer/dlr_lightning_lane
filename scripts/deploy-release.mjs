import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { options, tagName, run, shellQuote, sha256, releasePath } from './release-common.mjs';

try {
  const args = options(process.argv.slice(2), ['--release', '--host', '--path', '--project', '--identity', '--port', '--dry-run', '--help']);
  if (args['--help']) {
    console.log('npm run release:deploy -- --release releases/TAG --project EXISTING_PROJECT [--host root@209.38.73.15] [--path /root/dlr-lightning-lane] [--identity KEY] [--port 22] [--dry-run]');
  } else {
    if (!args['--release'] || !args['--project']) throw new Error('--release and --project are required. Find the existing project with docker compose ls on the droplet.');
    const host = args['--host'] ?? 'root@209.38.73.15';
    const path = args['--path'] ?? '/root/dlr-lightning-lane';
    const project = args['--project'];
    const port = args['--port'] ?? '22';
    if (!/^(?:[a-zA-Z0-9_-]+@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) throw new Error('Invalid SSH host');
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').includes('..') || path === '/') throw new Error('Use an absolute remote application path without spaces or ..');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Invalid Compose project');
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid SSH port');
    const dir = releasePath(args['--release']);
    const metadata = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
    const tag = tagName(metadata.tag);
    const names = ['images.tar', 'compose.yaml', 'Caddyfile', 'apply-release.sh', 'release.json'];
    const expected = (await Promise.all(names.map(async name => (await sha256(join(dir, name))) + '  ' + name))).join('\n') + '\n';
    if (readFileSync(join(dir, 'SHA256SUMS'), 'utf8') !== expected) throw new Error('Release checksum mismatch; rebuild the release.');
    const destination = path + '/.deploy/releases/' + tag;
    const sshOptions = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', ...(args['--identity'] ? ['-i', args['--identity']] : [])];
    if (args['--dry-run']) {
      console.log(JSON.stringify({ release: dir, host, path, project, tag, destination, steps: ['Verify SSH and existing deployment', 'Upload and verify release', 'Load images and validate config', 'Stop web/worker, back up SQLite, migrate', 'Restart and check web/worker/Caddy'] }, null, 2));
    } else {
      run('ssh', [...sshOptions, '-p', port, host, 'test -f ' + shellQuote(path + '/.env') + ' && test -f ' + shellQuote(path + '/compose.yaml') + ' && mkdir -p ' + shellQuote(path + '/.deploy/releases') + ' && mkdir ' + shellQuote(destination)]);
      run('scp', [...sshOptions, '-P', port, ...names.concat('SHA256SUMS').map(name => join(dir, name)), host + ':' + destination + '/']);
      run('ssh', [...sshOptions, '-p', port, host, 'cd ' + shellQuote(destination) + ' && sha256sum --check SHA256SUMS && bash ./apply-release.sh ' + [path, project, tag].map(shellQuote).join(' ')]);
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
