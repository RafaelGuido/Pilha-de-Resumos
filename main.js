// Pilha de Resumos — processo principal (Electron)
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const EXTENSOES = ['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.webp'];

// ---------- onde ficam os dados ----------
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function lerConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function salvarConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
function pastaDados() {
  if (process.env.PILHA_DADOS) return process.env.PILHA_DADOS;
  const cfg = lerConfig();
  return cfg.pastaDados || path.join(app.getPath('documents'), 'Pilha de Resumos');
}
function arquivoEstado(dir = pastaDados()) {
  return path.join(dir, 'pilha.json');
}

function estadoInicial() {
  return {
    versao: 1,
    pastas: [
      { id: 'resumos', nome: 'Resumos de matérias', porDia: 2, novosNoTopo: true, concluidoEm: null, ultimaSelecao: [], itens: [] },
      { id: 'questoes', nome: 'Caderno de questões', porDia: 2, novosNoTopo: true, concluidoEm: null, ultimaSelecao: [], itens: [] },
    ],
    zoom: 1,
  };
}

function carregarEstado() {
  const dir = pastaDados();
  fs.mkdirSync(dir, { recursive: true });
  const f = arquivoEstado(dir);
  if (!fs.existsSync(f)) {
    const e = estadoInicial();
    fs.writeFileSync(f, JSON.stringify(e, null, 2));
    return e;
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function salvarEstado(estado) {
  const dir = pastaDados();
  fs.mkdirSync(dir, { recursive: true });
  const f = arquivoEstado(dir);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2));
  // mantém uma cópia de segurança da versão anterior
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
  fs.renameSync(tmp, f);
  return true;
}

function nomeSeguro(nome) {
  return nome.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120);
}

// copia arquivos para a biblioteca e devolve os itens novos
function importarArquivos(pastaId, caminhos) {
  const dir = path.join(pastaDados(), pastaId);
  fs.mkdirSync(dir, { recursive: true });
  const itens = [];
  const ignorados = [];
  for (const origem of caminhos) {
    const ext = path.extname(origem).toLowerCase();
    if (!EXTENSOES.includes(ext)) { ignorados.push(path.basename(origem)); continue; }
    const base = path.basename(origem, path.extname(origem));
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const nomeArq = `${id}-${nomeSeguro(base)}${ext}`;
    fs.copyFileSync(origem, path.join(dir, nomeArq));
    itens.push({ id, titulo: base, arquivo: `${pastaId}/${nomeArq}`, tipo: ext.slice(1) });
  }
  return { itens, ignorados };
}

// ---------- IPC ----------
ipcMain.handle('estado:carregar', () => ({ estado: carregarEstado(), pastaDados: pastaDados(), hoje: process.env.PILHA_HOJE || null }));
ipcMain.handle('estado:salvar', (_e, estado) => salvarEstado(estado));

ipcMain.handle('arquivos:escolher', async (e, pastaId) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Adicionar resumos',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Resumos (PDF, Word, imagem)', extensions: EXTENSOES.map((x) => x.slice(1)) },
    ],
  });
  if (r.canceled) return { itens: [], ignorados: [] };
  return importarArquivos(pastaId, r.filePaths);
});
ipcMain.handle('arquivos:importar', (_e, pastaId, caminhos) => importarArquivos(pastaId, caminhos));

ipcMain.handle('arquivo:ler', (_e, rel) => {
  const buf = fs.readFileSync(path.join(pastaDados(), rel));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});
ipcMain.handle('arquivo:abrir', (_e, rel) => shell.openPath(path.join(pastaDados(), rel)));
ipcMain.handle('arquivo:apagar', (_e, rel) => {
  const f = path.join(pastaDados(), rel);
  const lixeira = path.join(pastaDados(), '_removidos');
  fs.mkdirSync(lixeira, { recursive: true });
  if (fs.existsSync(f)) fs.renameSync(f, path.join(lixeira, path.basename(f)));
  return true;
});
ipcMain.handle('arquivo:substituir', async (e, rel) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const ext = path.extname(rel).toLowerCase();
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolher nova versão do resumo',
    properties: ['openFile'],
    filters: [{ name: 'Mesmo formato', extensions: [ext.slice(1)] }],
  });
  if (r.canceled) return false;
  fs.copyFileSync(r.filePaths[0], path.join(pastaDados(), rel));
  return true;
});

ipcMain.handle('arquivo:gravar', (_e, rel, buf) => {
  const f = path.join(pastaDados(), rel);
  if (!path.resolve(f).startsWith(path.resolve(pastaDados()) + path.sep)) throw new Error('Caminho inválido');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(buf));
  return true;
});

// backup
ipcMain.handle('backup:salvar', async (e, nome, buf) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    title: 'Salvar backup',
    defaultPath: path.join(app.getPath('documents'), nome),
    filters: [{ name: 'Backup da pilha (zip)', extensions: ['zip'] }],
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, Buffer.from(buf));
  return true;
});
ipcMain.handle('backup:escolher', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolher backup',
    properties: ['openFile'],
    filters: [{ name: 'Backup da pilha (zip)', extensions: ['zip'] }],
  });
  if (r.canceled) return null;
  const buf = fs.readFileSync(r.filePaths[0]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('dados:abrirPasta', () => shell.openPath(pastaDados()));
ipcMain.handle('dados:mudarPasta', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Escolher onde guardar os resumos',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled) return null;
  const nova = r.filePaths[0];
  const atual = pastaDados();
  if (path.resolve(nova) === path.resolve(atual)) return nova;
  if (!fs.existsSync(arquivoEstado(nova))) {
    // leva a pilha atual para o novo lugar
    fs.cpSync(atual, nova, { recursive: true });
  }
  const cfg = lerConfig();
  cfg.pastaDados = nova;
  salvarConfig(cfg);
  return nova;
});

// ---------- janela ----------
function criarJanela() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Pilha de Resumos',
    backgroundColor: '#f4f1ea',
    icon: path.join(__dirname, 'app', 'icone.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  // abre links externos no navegador
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

app.whenReady().then(() => {
  criarJanela();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
});
app.on('window-all-closed', () => app.quit());
