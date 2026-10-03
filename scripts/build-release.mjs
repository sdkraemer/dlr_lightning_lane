import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, options, tagName, run, dockerPath, sha256, releasePath } from './release-common.mjs';

try {
  const args = options(process.argv.slice(2), ['--tag', '--platform', '--help']);
  if (args['--help']) {
    console.log('npm run release:build -- [--tag release-name] [--platform linux/amd64|linux/arm64]');
  } else {
    const tag = tagName(args['--tag'] ?? new Date().toISOString().replace(/[:.]/g, '-'));
    const platform = args['--platform'] ?? 'linux/amd64';
    if (!['linux/amd64', 'linux/arm64'].includes(platform)) throw new Error('Unsupported platform');
    const dir = releasePath('releases/' + tag);
    if (existsSync(dir)) throw new Error('Release directory already exists; use a new tag: ' + dir);
    const docker = dockerPath();
    run(docker, ['info', '--format', '{{.OSType}}']);
    run(process.execPath, ['--test', ...readdirSync(join(root, 'tests')).filter(f => /\.test\.(ts|mjs)$/.test(f)).map(f => join(root, 'tests', f))]);
    run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
    for (const service of ['web', 'worker']) {
      run(docker, ['buildx', 'build', '--platform', platform, '--load', '-f', 'deploy/Dockerfile.' + service, '-t', 'dlr-' + service + ':' + tag, '.']);
    }
    mkdirSync(dir, { recursive: true });
    run(docker, ['image', 'save', '-o', join(dir, 'images.tar'), 'dlr-web:' + tag, 'dlr-worker:' + tag]);
    // Pin production images. Keep the source Compose file convenient for local builds.
    const compose = readFileSync(join(root, 'compose.yaml'), 'utf8')
      .replaceAll('${IMAGE_TAG:-local}', tag)
      .replace(/    build:\r?\n      context: \.\r?\n      dockerfile: deploy\/Dockerfile\.(web|worker)\r?\n/g, '');
    if (compose.includes('    build:') || compose.includes('IMAGE_TAG')) throw new Error('Unexpected Compose build/image configuration');
    writeFileSync(join(dir, 'compose.yaml'), compose);
    for (const [source, target] of [['deploy/Caddyfile', 'Caddyfile'], ['deploy/apply-release.sh', 'apply-release.sh']]) {
      writeFileSync(join(dir, target), readFileSync(join(root, source), 'utf8').replaceAll('\r\n', '\n'));
    }
    writeFileSync(join(dir, 'release.json'), JSON.stringify({ tag, platform, builtAt: new Date().toISOString() }, null, 2) + '\n');
    const names = ['images.tar', 'compose.yaml', 'Caddyfile', 'apply-release.sh', 'release.json'];
    const sums = await Promise.all(names.map(async name => (await sha256(join(dir, name))) + '  ' + name));
    writeFileSync(join(dir, 'SHA256SUMS'), sums.join('\n') + '\n');
    console.log('Release ready: ' + dir + '\nIncludes current working-tree changes; no .env or database is bundled.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
