import { spawn } from 'node:child_process';

// Own each process tree so Next.js subprocesses also stop when this runner exits.
export function runServices(commands, env = process.env) {
  let stopping = false;
  let exitCode = 0;
  let forceTimer;
  const children = [];
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    for (const child of children) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', error => {
          console.error(`Could not stop process tree ${child.pid}: ${error.message}`);
          child.kill();
        });
        killer.on('exit', code => {
          if (code && child.exitCode === null && child.signalCode === null) {
            console.error(`Could not stop process tree ${child.pid}; stopping its parent process.`);
            child.kill();
          }
        });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    }
    if (process.platform !== 'win32') {
      forceTimer = setTimeout(() => {
        for (const child of children) {
          if (!child.pid) continue;
          try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        }
      }, 10000);
      forceTimer.unref();
    }
  };
  const onSignal = () => stop(0);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return Promise.all(commands.map(({ name, args }) => new Promise(resolve => {
    console.log(`Starting ${name}...`);
    const child = spawn(process.execPath, args, {
      stdio: 'inherit', env, detached: process.platform !== 'win32',
    });
    children.push(child);
    child.on('error', error => {
      console.error(`${name}: ${error.message}`);
      stop(1);
    });
    child.on('close', (code) => {
      if (!stopping) {
        console.error(`${name} exited; stopping the other services.`);
        stop(code || 1);
      }
      resolve();
    });
  }))).then(() => {
    clearTimeout(forceTimer);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    return exitCode;
  });
}
