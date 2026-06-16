// Dev launcher: runs vite + electron concurrently
// - 启动前先清掉 5173 端口的残留进程（上次窗口没关干净）
// - vite / electron 跟随父进程退出，孤儿进程自动死掉
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

const PORT = 5173;

// 在 Windows 上用 taskkill /T /F 杀掉整个进程树（防止 electron GPU/utility 子进程残留）
function killTree(pid) {
  if (!isWin) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
    return;
  }
  try {
    execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
  } catch {
    // 进程可能已经死了，忽略
  }
}

// 杀掉占用 PORT 的进程（Windows 用 netstat + taskkill）
function killPort(port) {
  if (!isWin) {
    try {
      spawn('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' });
    } catch {}
    return;
  }
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    const pids = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/\s(\d+)\s*$/);
      if (m) pids.add(Number(m[1]));
    }
    for (const pid of pids) {
      if (pid === process.pid) continue;
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log(`[cleanup] killed pid ${pid} (was holding port ${port})`);
      } catch {}
    }
  } catch {
    // netstat 没找到匹配行就忽略
  }
}

const children = [];

function run(name, cmd, args, color, extraEnv = {}) {
  console.log(`[${name}] spawning: ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '1', ...extraEnv },
    detached: false,
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  child.stdout?.on('data', (b) =>
    process.stdout.write(prefix + b.toString().replace(/\n(?!$)/g, '\n' + prefix))
  );
  child.stderr?.on('data', (b) =>
    process.stderr.write(prefix + b.toString().replace(/\n(?!$)/g, '\n' + prefix))
  );
  child.on('exit', (code, signal) => {
    console.log(prefix + `exited code=${code} signal=${signal}`);
    // 任何子进程退出，杀掉另一个再让自己退出（关 Electron 窗口时也能彻底清理）
    for (const c of children) {
      if (c !== child && !c.killed) {
        try { killTree(c.pid); } catch {}
      }
    }
    // 用 exitCode 而非 process.exit，避免 process.exit 的同步延迟
    process.exitCode = code ?? (signal ? 1 : 0);
    // 给 SIGKILL 一点时间传播
    setTimeout(() => process.exit(process.exitCode), 100);
  });
  return child;
}

// 1) 先清掉残留的 5173
console.log(`[cleanup] checking port ${PORT}...`);
killPort(PORT);

// 2) 启动 vite
const npx = isWin ? 'npx.cmd' : 'npx';
const vite = run('vite', npx, ['vite'], '36');
children.push(vite);

// 3) 等 vite 就绪后启动 electron
setTimeout(() => {
  const candidates = [
    path.join(root, 'node_modules', '.pnpm', 'electron@32.3.3', 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ];
  const electronExe = candidates.find((p) => fs.existsSync(p));
  if (!electronExe) {
    console.error('[electron] ERROR: electron.exe not found');
    process.exit(1);
  }
  console.log(`[electron] using: ${electronExe}`);
  console.log(`[electron] loading http://localhost:${PORT}`);
  // 必须设 ELECTRON_RENDERER_URL，主进程靠它判断走 dev URL 还是本地 file
  const e = run('electron', electronExe, [root], '35', {
    ELECTRON_RENDERER_URL: `http://localhost:${PORT}`,
  });
  children.push(e);
}, 3500);

// 4) 任何方式退出都干净杀子进程（用 taskkill /T /F 杀整棵树）
function shutdown(signal) {
  console.log(`\n[main] received ${signal}, killing children...`);
  for (const c of children) {
    if (!c.killed) {
      try { killTree(c.pid); } catch {}
    }
  }
  setTimeout(() => {
    killPort(PORT);
    process.exit(0);
  }, 200);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
