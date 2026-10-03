import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { options, tagName, shellQuote, sha256, root } from '../scripts/release-common.mjs';

test('release arguments reject ambiguous options and unsafe image tags', () => {
  assert.throws(() => options(['--host'], ['--host']), /Missing/);
  assert.throws(() => options(['--host', 'one', '--host', 'two'], ['--host']), /duplicate/);
  assert.throws(() => options(['--unknown'], ['--host']), /Unknown/);
  for (const tag of ['../latest', '-bad', 'tag;command', '']) assert.throws(() => tagName(tag));
  assert.equal(tagName('2026-10-03-01'), '2026-10-03-01');
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});

test('deployment dry-run checks the bundle without SSH and rejects tampering', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dlr-release-test-'));
  try {
    const names = ['images.tar', 'compose.yaml', 'Caddyfile', 'apply-release.sh', 'release.json'];
    for (const name of names) writeFileSync(join(dir, name), name === 'release.json' ? JSON.stringify({ tag: 'test-release' }) : 'fixture');
    writeFileSync(join(dir, 'SHA256SUMS'), (await Promise.all(names.map(async name => (await sha256(join(dir, name))) + '  ' + name))).join('\n') + '\n');
    const args = [join(root, 'scripts/deploy-release.mjs'), '--release', dir, '--project', 'existing-project', '--dry-run'];
    const invoke = (extra = []) => spawnSync(process.execPath, [...args, ...extra], {encoding: 'utf8'});
    const valid = invoke();
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).project, 'existing-project');
    assert.equal(invoke(['--path', '/root/../other']).status, 1);
    assert.equal(invoke(['--host', '-oProxyCommand=evil']).status, 1);
    writeFileSync(join(dir, 'compose.yaml'), 'changed');
    const corrupt = invoke();
    assert.equal(corrupt.status, 1);
    assert.match(corrupt.stderr, /checksum mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
