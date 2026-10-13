// Pilha de Resumos — versão web (iPad / navegador).
// Implementa a mesma API que o preload.js do Electron expõe em window.pilha,
// guardando tudo no IndexedDB do navegador. Nada sai do aparelho.
(function () {
  if (window.pilha) return; // no Electron o preload já definiu a API

  const EXTENSOES = ['pdf', 'docx', 'png', 'jpg', 'jpeg', 'webp'];
  const MIMES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

  // ---------- IndexedDB ----------
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((res, rej) => {
        const req = indexedDB.open('pilha-de-resumos', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('estado')) d.createObjectStore('estado');
          if (!d.objectStoreNames.contains('arquivos')) d.createObjectStore('arquivos');
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    }
    return dbPromise;
  }
  async function op(store, modo, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(store, modo);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Sem espaço ou operação cancelada'));
    });
  }
  const get = (store, k) => op(store, 'readonly', (s) => s.get(k));
  const put = (store, k, v) => op(store, 'readwrite', (s) => s.put(v, k));
  const del = (store, k) => op(store, 'readwrite', (s) => s.delete(k));

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

  // pede ao navegador para não apagar os dados quando faltar espaço
  let pediuPersistencia = false;
  function pedirPersistencia() {
    if (pediuPersistencia) return;
    pediuPersistencia = true;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* ok */ }
  }

  function extensao(nome) {
    const m = /\.([a-z0-9]+)$/i.exec(nome);
    return m ? m[1].toLowerCase() : '';
  }
  function nomeSeguro(nome) {
    return nome.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120);
  }

  async function importarArquivos(pastaId, files) {
    pedirPersistencia();
    const itens = [];
    const ignorados = [];
    for (const f of files) {
      const ext = extensao(f.name);
      if (!EXTENSOES.includes(ext)) { ignorados.push(f.name); continue; }
      const base = f.name.replace(/\.[^.]+$/, '');
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const rel = `${pastaId}/${id}-${nomeSeguro(base)}.${ext}`;
      await put('arquivos', rel, await f.arrayBuffer());
      itens.push({ id, titulo: base, arquivo: rel, tipo: ext });
    }
    return { itens, ignorados };
  }

  // abre o seletor de arquivos do sistema (no iPad: app Arquivos, Fotos, câmera)
  function escolher(multiplo, aceitar) {
    return new Promise((res) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = multiplo;
      input.accept = aceitar;
      input.style.display = 'none';
      document.body.append(input);
      let feito = false;
      const fim = (files) => { if (feito) return; feito = true; input.remove(); res(files); };
      input.addEventListener('change', () => fim([...input.files]));
      // alguns navegadores avisam "cancel" antes de entregar os arquivos; espera um pouco antes de desistir
      input.addEventListener('cancel', () => setTimeout(() => fim([]), 2000));
      input.click();
    });
  }
  const ACEITAR = '.pdf,.docx,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp';

  function hojeDaUrl() {
    try {
      const h = new URLSearchParams(location.search).get('hoje');
      return /^\d{4}-\d{2}-\d{2}$/.test(h || '') ? h : null;
    } catch { return null; }
  }

  window.pilha = {
    plataforma: 'web',

    async carregar() {
      let estado = await get('estado', 'pilha');
      if (!estado) { estado = estadoInicial(); await put('estado', 'pilha', estado); }
      return { estado, pastaDados: 'Neste aparelho (armazenamento do navegador)', hoje: hojeDaUrl() };
    },
    async salvar(estado) {
      await put('estado', 'pilha', JSON.parse(JSON.stringify(estado)));
      return true;
    },

    async escolherArquivos(pastaId) {
      const files = await escolher(true, ACEITAR);
      return importarArquivos(pastaId, files);
    },
    importar: (pastaId, files) => importarArquivos(pastaId, files),
    caminhoDe: (file) => file, // na web os arquivos arrastados já são o próprio File

    async ler(rel) {
      const buf = await get('arquivos', rel);
      if (!buf) throw new Error('Arquivo não encontrado neste aparelho');
      return buf;
    },
    async gravar(rel, buf) { await put('arquivos', rel, buf); return true; },
    async abrir(rel) {
      // abre o arquivo numa nova aba (no iPad, PDF abre no visualizador do Safari)
      const janela = window.open('', '_blank');
      const buf = await window.pilha.ler(rel);
      const url = URL.createObjectURL(new Blob([buf], { type: MIMES[extensao(rel)] || 'application/octet-stream' }));
      if (janela) janela.location.href = url; else location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return '';
    },
    async apagar(rel) { await del('arquivos', rel); return true; },
    async substituir(rel) {
      const ext = extensao(rel);
      const [f] = await escolher(false, `.${ext},${MIMES[ext] || ''}`);
      if (!f) return false;
      if (extensao(f.name) !== ext) throw new Error(`Escolha um arquivo .${ext}, igual ao original.`);
      await put('arquivos', rel, await f.arrayBuffer());
      return true;
    },

    // backup: o app gera/lê o zip; aqui só entregamos e recebemos o arquivo
    async salvarArquivo(nome, blob) {
      const arquivo = new File([blob], nome, { type: 'application/zip' });
      // no iPad, a folha de compartilhamento permite "Salvar em Arquivos"/iCloud
      if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
        try { await navigator.share({ files: [arquivo], title: nome }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nome;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return true;
    },
    async escolherBackup() {
      const [f] = await escolher(false, '.zip,application/zip');
      return f ? f.arrayBuffer() : null;
    },
  };
})();
