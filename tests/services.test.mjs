import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('service runner propagates failures and terminates its sibling process', { timeout: 20000 }, async () => {
  const runner = new URL('../scripts/services.mjs', import.meta.url).href;
  const code = `
    import { runServices } from ${JSON.stringify(runner)};
    process.exitCode = await runServices([
      { name: 'long-lived', args: ['-e', 'setInterval(() => {}, 1000)'] },
      { name: 'failure', args: ['-e', 'setTimeout(() => process.exit(7), 300)'] },
    ]);
  `;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject);
    child.on('close', status => resolve({ status, output }));
  });
  assert.equal(result.status, 7, result.output);
  assert.match(result.output, /failure exited; stopping the other services/);
});
