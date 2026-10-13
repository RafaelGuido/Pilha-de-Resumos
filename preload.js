const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pilha', {
  carregar: () => ipcRenderer.invoke('estado:carregar'),
  salvar: (estado) => ipcRenderer.invoke('estado:salvar', estado),
  escolherArquivos: (pastaId) => ipcRenderer.invoke('arquivos:escolher', pastaId),
  importar: (pastaId, caminhos) => ipcRenderer.invoke('arquivos:importar', pastaId, caminhos),
  caminhoDe: (file) => webUtils.getPathForFile(file),
  ler: (rel) => ipcRenderer.invoke('arquivo:ler', rel),
  abrir: (rel) => ipcRenderer.invoke('arquivo:abrir', rel),
  apagar: (rel) => ipcRenderer.invoke('arquivo:apagar', rel),
  substituir: (rel) => ipcRenderer.invoke('arquivo:substituir', rel),
  abrirPastaDados: () => ipcRenderer.invoke('dados:abrirPasta'),
  mudarPastaDados: () => ipcRenderer.invoke('dados:mudarPasta'),
});
