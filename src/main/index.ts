import { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import log from 'electron-log';
import { formatTxtWithLlm, type LlmConfig } from './api/llm';
import { loadSettings, saveSettings, type PersistedSettings } from './settings-store';
import { markdownToDocxBuffer } from './markdown-to-docx';

// ---- logging ----
try { (log as any).initialize?.(); } catch {}
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info('LaiMarkDown 2.0 starting, isPackaged=', app.isPackaged);

// ---- safe-file protocol (local images in markdown) ----
protocol.registerSchemesAsPrivileged([
  { scheme: 'safe-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

// ---- single instance ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#fafafa',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximize-change', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximize-change', false));

  // 关键：窗口关闭时，确保主进程退出 → dev launcher 收到事件也会跟着退
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    log.error('did-fail-load', code, desc);
  });
}

function buildMenu() {
  const send = (channel: string, ...args: unknown[]) => {
    mainWindow?.webContents.send(channel, ...args);
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new') },
        { label: '打开文件...', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open-file') },
        { label: '打开文件夹...', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('menu:open-folder') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        { label: '另存为...', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:save-as') },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => send('menu:find') },
        { label: '替换', accelerator: 'CmdOrCtrl+H', click: () => send('menu:replace') },
        { label: '命令面板', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('menu:command-palette') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '仅编辑', click: () => send('menu:view-mode', 'editor') },
        { label: '仅预览', click: () => send('menu:view-mode', 'preview') },
        { label: '左右分栏', click: () => send('menu:view-mode', 'split-h') },
        { label: '上下分栏', click: () => send('menu:view-mode', 'split-v') },
        { label: '互换编辑/预览', accelerator: 'CmdOrCtrl+Alt+S', click: () => send('menu:swap-panes') },
        { type: 'separator' },
        { label: '切换侧边栏', accelerator: 'CmdOrCtrl+B', click: () => send('menu:toggle-sidebar') },
        { label: '切换主题', click: () => send('menu:toggle-theme') },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 来MarkDown',
          click: () =>
            mainWindow &&
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 来MarkDown',
              message: '来MarkDown v2.0.0',
              detail: '一款现代化的 Markdown 桌面编辑器\n基于 Electron + React + CodeMirror 6',
            }),
        },
      ],
    },
  ];
  if (isDev) {
    template.push({
      label: '开发者',
      submenu: [{ role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC handlers ----
function registerIpc() {
  ipcMain.handle('fs:read-file', async (_e, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('fs:write-file', async (_e, filePath: string, content: string) => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('fs:write-binary', async (_e, filePath: string, data: ArrayBuffer | Uint8Array) => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const buf = Buffer.from(data as ArrayBuffer);
      fs.writeFileSync(filePath, buf);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('fs:save-pasted-image', async (_e, mdFilePath: string | null, data: ArrayBuffer, ext: string) => {
    try {
      const safeExt = (ext || 'png').replace(/^\./, '').toLowerCase().slice(0, 6) || 'png';
      const ts = new Date();
      const pad = (n: number, w = 2) => String(n).padStart(w, '0');
      const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}-${pad(ts.getMilliseconds(), 3)}`;
      const fileName = `paste-${stamp}.${safeExt}`;
      const baseDir = mdFilePath
        ? path.join(path.dirname(mdFilePath), 'img')
        : path.join(app.getPath('userData'), 'unsaved', 'img');
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
      const absPath = path.join(baseDir, fileName);
      fs.writeFileSync(absPath, Buffer.from(data));
      const relPath = mdFilePath ? `img/${fileName}` : absPath.replace(/\\/g, '/');
      return { ok: true, absolutePath: absPath, relativePath: relPath, fileName };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('fs:download-image', async (_e, mdFilePath: string | null, url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || '';
      let ext = path.extname(new URL(url).pathname).replace(/^\./, '').toLowerCase();
      if (!ext) {
        if (/png/i.test(ct)) ext = 'png';
        else if (/jpeg|jpg/i.test(ct)) ext = 'jpg';
        else if (/gif/i.test(ct)) ext = 'gif';
        else if (/webp/i.test(ct)) ext = 'webp';
        else if (/svg/i.test(ct)) ext = 'svg';
        else ext = 'png';
      }
      const stamp = Date.now().toString(36);
      const base = path.basename(new URL(url).pathname).replace(/\.[^.]+$/, '').slice(0, 40) || 'remote';
      const fileName = `${base}-${stamp}.${ext}`;
      const baseDir = mdFilePath
        ? path.join(path.dirname(mdFilePath), 'img')
        : path.join(app.getPath('userData'), 'unsaved', 'img');
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
      const absPath = path.join(baseDir, fileName);
      fs.writeFileSync(absPath, buf);
      const relPath = mdFilePath ? `img/${fileName}` : absPath.replace(/\\/g, '/');
      return { ok: true, absolutePath: absPath, relativePath: relPath, fileName };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('fs:read-dir', async (_e, dirPath: string) => {
    try {
      const items = fs.readdirSync(dirPath).map((name) => {
        const full = path.join(dirPath, name);
        let isDirectory = false;
        try {
          isDirectory = fs.statSync(full).isDirectory();
        } catch {}
        return { name, path: full, isDirectory, isMarkdown: /\.(md|markdown)$/i.test(name) };
      });
      return { ok: true, items };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // 递归列出目录下所有 .md/.markdown/.txt 文件（深度限制 + 排除常见巨型目录）
  ipcMain.handle('fs:list-md-recursive', async (_e, opts: { rootDir: string; maxDepth?: number }) => {
    try {
      const { rootDir, maxDepth = 6 } = opts;
      const SKIP = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.cache', '.idea', '.vscode', '__pycache__']);
      const results: { name: string; relPath: string; absPath: string; size: number }[] = [];

      const walk = (dir: string, depth: number, relBase: string) => {
        if (depth > maxDepth) return;
        let entries: string[];
        try {
          entries = fs.readdirSync(dir);
        } catch {
          return;
        }
        for (const name of entries) {
          if (SKIP.has(name)) continue;
          // 跳过隐藏文件 / 以 . 开头的目录
          if (name.startsWith('.')) continue;
          const abs = path.join(dir, name);
          let st: fs.Stats;
          try {
            st = fs.statSync(abs);
          } catch {
            continue;
          }
          const rel = relBase ? `${relBase}/${name}` : name;
          if (st.isDirectory()) {
            walk(abs, depth + 1, rel);
          } else if (st.isFile() && /\.(md|markdown|txt)$/i.test(name)) {
            results.push({ name, relPath: rel, absPath: abs, size: st.size });
          }
        }
      };

      walk(rootDir, 0, '');
      // 按相对路径排序
      results.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-Hans-CN'));
      return { ok: true, items: results };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('dialog:open-file', async () => {
    if (!mainWindow) return { canceled: true };
    return dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
  });

  ipcMain.handle('dialog:open-folder', async () => {
    if (!mainWindow) return { canceled: true };
    return dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  });

  ipcMain.handle('dialog:save-file', async (_e, opts: { defaultPath?: string; extension?: string } = {}) => {
    if (!mainWindow) return { canceled: true };
    const ext = opts.extension || 'md';
    return dialog.showSaveDialog(mainWindow, {
      defaultPath: opts.defaultPath,
      filters: [
        { name: ext.toUpperCase(), extensions: [ext] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
  });

  ipcMain.handle('export:pdf', async (_e, opts: { html: string; savePath: string; defaultName?: string }) => {
    try {
      if (!mainWindow) return { ok: false, error: 'window not ready' };
      const w = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(opts.html);
      await w.loadURL(dataUrl);
      await new Promise((r) => setTimeout(r, 300));
      const pdfBuffer = await w.webContents.printToPDF({
        pageSize: 'A4',
        margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
        printBackground: true,
        preferCSSPageSize: true,
      });
      let target = opts.savePath;
      if (!target) {
        const r = await dialog.showSaveDialog(mainWindow, {
          defaultPath: opts.defaultName || 'export.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (r.canceled || !r.filePath) {
          w.destroy();
          return { ok: false, canceled: true };
        }
        target = r.filePath;
      }
      fs.writeFileSync(target, pdfBuffer);
      w.destroy();
      return { ok: true, path: target };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // ---- LLM 排版：把 txt 文件调 LLM API 转成 md ----
  ipcMain.handle('llm:format-txt', async (_e, payload: { filePath: string; config: LlmConfig }) => {
    const { filePath, config } = payload;
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: '文件不存在' };
      }
      // 读 txt 内容（utf-8 优先；若是 GBK 编码，提示用户先转码）
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
        // utf-8 解码失败通常会带替换字符 \ufffd，提示用户
        if (content.includes('\ufffd')) {
          return {
            ok: false,
            error: '文件可能不是 UTF-8 编码（检测到乱码字符），请先用记事本打开并"另存为 UTF-8"后再试。',
          };
        }
      } catch (e) {
        return { ok: false, error: '读取文件失败：' + (e as Error).message };
      }
      const result = await formatTxtWithLlm(config, content);
      return result;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);

  // ---- 设置持久化 ----
  ipcMain.handle('settings:load', () => {
    return loadSettings();
  });
  ipcMain.handle('settings:save', (_e, patch: PersistedSettings) => {
    return saveSettings(patch || {});
  });

  // ---- DOCX 导出 ----
  ipcMain.handle('export:docx', async (_e, opts: { markdown: string; defaultName?: string }) => {
    try {
      if (!opts || !opts.markdown) return { ok: false, error: '没有可导出的内容' };
      const r = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: opts.defaultName || 'untitled.docx',
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };

      const buf = await markdownToDocxBuffer(opts.markdown);
      fs.writeFileSync(r.filePath, buf);
      return { ok: true, path: r.filePath };
    } catch (e) {
      log.error('export:docx failed', e);
      return { ok: false, error: (e as Error).message };
    }
  });
}

// ---- error guards ----
process.on('uncaughtException', (err) => log.error('uncaughtException', err));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));

// ---- app lifecycle ----
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  // safe-file:// scheme handler
  protocol.handle('safe-file', async (request) => {
    try {
      const url = new URL(request.url);
      let p = decodeURIComponent(url.pathname);
      if (p.startsWith('/') && /^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      if (!fs.existsSync(p)) {
        log.warn('safe-file not found:', p);
        return new Response('not found', { status: 404 });
      }
      const data = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase();
      const mime =
        ext === '.png' ? 'image/png' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        ext === '.gif' ? 'image/gif' :
        ext === '.webp' ? 'image/webp' :
        ext === '.svg' ? 'image/svg+xml' :
        ext === '.bmp' ? 'image/bmp' :
        ext === '.ico' ? 'image/x-icon' :
        'application/octet-stream';
      return new Response(data, { headers: { 'content-type': mime, 'cache-control': 'no-cache' } });
    } catch (e) {
      log.error('safe-file protocol error', e);
      return new Response('not found', { status: 404 });
    }
  });

  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 关所有窗口 → 退出主进程（之前默认 macOS 不退，现在统一退出）
  app.quit();
});

// 兜底：当主进程要退出时（防止 macOS / 异常路径残留）
app.on('before-quit', () => {
  log.info('LaiMarkDown 2.0 quitting');
});
