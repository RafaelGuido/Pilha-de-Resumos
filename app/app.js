// Pilha de Resumos — interface
import * as pdfjsLib from './vendor/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = window.pilha;

let estado = null;
let pastaDados = '';
let hojeFixo = null;
const ui = { pastaId: null, aba: 'hoje' };
const CORES = ['#b9a3ec', '#f2cf4a', '#8fd0a8', '#7cc6e8', '#f2a07b', '#e58fb4'];
const LARGURA_BASE = 760;

// ---------- utilidades ----------
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => hojeFixo || isoLocal(new Date());
function amanha() {
  const [a, m, d] = hoje().split('-').map(Number);
  return isoLocal(new Date(a, m - 1, d + 1));
}
function fmtData(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function fmtDiaExtenso(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  return dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function lerPref(k, padrao) {
  try { const v = localStorage.getItem('pilha.' + k); return v == null ? padrao : v; } catch { return padrao; }
}
function salvarPref(k, v) {
  try { localStorage.setItem('pilha.' + k, v); } catch { /* sem problema */ }
}

// ---------- regras da pilha ----------
function pastaAtual() {
  return estado.pastas.find((p) => p.id === ui.pastaId) || estado.pastas[0];
}
function corDa(p) {
  return CORES[estado.pastas.indexOf(p) % CORES.length];
}
// Resumos adicionados hoje só entram na revisão a partir de amanhã.
// Exceção: se a pasta só tem resumos de hoje (primeiro dia de uso), mostra esses mesmo.
function elegiveis(p, dia = hoje()) {
  const e = p.itens.filter((i) => i.adicionadoEm < dia);
  return e.length ? e : p.itens;
}
function selecaoDoDia(p) {
  if (p.concluidoEm === hoje()) {
    const porId = new Map(p.itens.map((i) => [i.id, i]));
    return { feito: true, itens: p.ultimaSelecao.map((id) => porId.get(id)).filter(Boolean) };
  }
  return { feito: false, itens: elegiveis(p).slice(0, p.porDia) };
}
function previaAmanha(p) {
  return elegiveis(p, amanha()).slice(0, p.porDia);
}

let desfazerSnapshot = null;
async function salvar() {
  await api.salvar(estado);
  renderLateral();
}

function concluirHoje(p) {
  desfazerSnapshot = JSON.stringify(estado);
  const sel = selecaoDoDia(p).itens;
  const ids = new Set(sel.map((i) => i.id));
  const resto = p.itens.filter((i) => !ids.has(i.id));
  for (const i of sel) i.revisoes.push(hoje());
  p.itens = [...resto, ...sel]; // revisados vão para o fim da fila
  p.concluidoEm = hoje();
  p.ultimaSelecao = sel.map((i) => i.id);
  salvar();
  render();
  toast(`${plural(sel.length, 'resumo foi', 'resumos foram')} para o fim da fila.`, 'Desfazer', desfazer);
}
function desfazer() {
  if (!desfazerSnapshot) return;
  estado = JSON.parse(desfazerSnapshot);
  desfazerSnapshot = null;
  salvar();
  render();
}

async function adicionar(resultado) {
  const p = pastaAtual();
  const { itens, ignorados } = resultado;
  if (ignorados.length) {
    toast(`Ignorei ${plural(ignorados.length, 'arquivo', 'arquivos')} em formato que não abro: ${ignorados.join(', ')}. Use PDF, Word (.docx) ou imagem.`);
  }
  if (!itens.length) return;
  const novos = itens.map((i) => ({ ...i, adicionadoEm: hoje(), revisoes: [] }));
  if (p.novosNoTopo) p.itens = [...novos, ...p.itens];
  else p.itens = [...p.itens, ...novos];
  await salvar();
  render();
  if (!ignorados.length) {
    const n = novos.length > 1;
    const quando = p.itens.length === novos.length ? (n ? 'já aparecem na revisão de hoje' : 'já aparece na revisão de hoje') : (p.novosNoTopo ? (n ? 'entram no topo da pilha e aparecem a partir de amanhã' : 'entra no topo da pilha e aparece a partir de amanhã') : (n ? 'entraram no fim da fila' : 'entrou no fim da fila'));
    toast(`${plural(novos.length, 'resumo adicionado', 'resumos adicionados')} — ${quando}.`);
  }
}

// ---------- renderização de arquivos ----------
const observadorDocx = new ResizeObserver((entradas) => {
  for (const e of entradas) ajustarDocx(e.target);
});
function ajustarDocx(alvo) {
  const caixa = alvo.querySelector('.docx-caixa');
  const sec = caixa && caixa.querySelector('section.docx');
  if (!sec) return;
  const natural = Number(caixa.dataset.natural) || sec.offsetWidth;
  caixa.dataset.natural = natural;
  if (natural > 0 && alvo.clientWidth > 0) caixa.style.zoom = alvo.clientWidth / natural;
}

async function renderizarFolha(item, alvo) {
  alvo.innerHTML = '<div class="carregando">Carregando a folha…</div>';
  try {
    const buf = await api.ler(item.arquivo);
    const area = document.createElement('div');
    if (item.tipo === 'pdf') await renderPdf(buf, area);
    else if (item.tipo === 'docx') await renderDocx(buf, area, alvo);
    else renderImagem(buf, item.tipo, area);
    alvo.innerHTML = '';
    alvo.append(...area.childNodes);
    if (item.tipo === 'docx') { ajustarDocx(alvo); observadorDocx.observe(alvo); }
  } catch (err) {
    console.error(err);
    alvo.innerHTML = `<div class="erro-folha">Não consegui mostrar este arquivo aqui.<br><small>${esc(err.message || err)}</small><br>
      <button class="btn" data-abrir="${esc(item.arquivo)}">Abrir no programa do computador</button></div>`;
  }
}

async function renderPdf(buf, area) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const base = pagina.getViewport({ scale: 1 });
    const vp = pagina.getViewport({ scale: 1800 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await pagina.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    area.append(embrulharPagina(canvas, rotuloPagina(n, pdf.numPages)));
  }
}
function rotuloPagina(n, total) {
  if (total === 2) return n === 1 ? 'frente' : 'verso';
  if (total > 2) return `pág. ${n} de ${total}`;
  return '';
}
function embrulharPagina(conteudo, rotulo) {
  const div = document.createElement('div');
  div.className = 'pagina';
  if (rotulo) {
    const r = document.createElement('span');
    r.className = 'pagina-rotulo';
    r.textContent = rotulo;
    div.append(r);
  }
  div.append(conteudo);
  return div;
}

async function renderDocx(buf, area, alvo) {
  // docx-preview precisa estar no documento para medir o layout
  const caixa = document.createElement('div');
  caixa.className = 'docx-caixa';
  const temp = document.createElement('div');
  temp.className = 'docx-medida';
  document.body.append(temp);
  temp.append(caixa);
  try {
    await window.docx.renderAsync(buf, caixa, null, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
    });
    const sec = caixa.querySelector('section.docx');
    if (sec) caixa.dataset.natural = sec.offsetWidth;
  } finally {
    temp.remove();
  }
  area.append(caixa);
}

function renderImagem(buf, tipo, area) {
  const mime = tipo === 'jpg' ? 'image/jpeg' : `image/${tipo}`;
  const img = document.createElement('img');
  img.src = URL.createObjectURL(new Blob([buf], { type: mime }));
  img.alt = '';
  area.append(embrulharPagina(img, ''));
}

function aplicarZoom() {
  document.documentElement.style.setProperty('--largura-folha', `${Math.round(LARGURA_BASE * (estado.zoom || 1))}px`);
  $$('.folha-paginas').forEach(ajustarDocx);
}
function mudarZoom(delta) {
  estado.zoom = Math.min(2, Math.max(0.5, Math.round(((estado.zoom || 1) + delta) * 10) / 10));
  aplicarZoom();
  $$('.zoom-valor').forEach((el) => (el.textContent = `${Math.round(estado.zoom * 100)}%`));
  salvar();
}
function htmlZoom() {
  return `<div class="zoom" title="Tamanho da folha na tela">
    <button class="btn-icone" data-zoom="-0.1" aria-label="Diminuir">−</button>
    <span class="zoom-valor">${Math.round((estado.zoom || 1) * 100)}%</span>
    <button class="btn-icone" data-zoom="0.1" aria-label="Aumentar">+</button></div>`;
}

// ---------- telas ----------
function render() {
  renderLateral();
  renderCabecalho();
  if (ui.aba === 'hoje') renderHoje(); else renderPilha();
}

function renderLateral() {
  $('#dataHoje').textContent = fmtDiaExtenso(hoje());
  $('#listaPastas').innerHTML = estado.pastas.map((p) => {
    const sel = selecaoDoDia(p);
    const status = !p.itens.length ? '<span class="status vazio">vazia</span>'
      : sel.feito ? '<span class="status ok">✓ feito hoje</span>'
      : `<span class="status pendente">${plural(sel.itens.length, 'para hoje', 'para hoje')}</span>`;
    return `<button class="pasta-item ${p.id === ui.pastaId ? 'ativa' : ''}" data-pasta="${p.id}">
      <span class="pasta-cor" style="background:${corDa(p)}"></span>
      <span class="pasta-textos"><span class="pasta-nome">${esc(p.nome)}</span>
      <span class="pasta-meta">${plural(p.itens.length, 'folha', 'folhas')} · ${status}</span></span></button>`;
  }).join('');
}

function renderCabecalho() {
  const p = pastaAtual();
  $('#tituloPasta').innerHTML = `<span class="pasta-cor grande" style="background:${corDa(p)}"></span>${esc(p.nome)}`;
  $('#abaHoje').classList.toggle('ativa', ui.aba === 'hoje');
  $('#abaPilha').classList.toggle('ativa', ui.aba === 'pilha');
  $('#abaPilha').textContent = `A pilha (${p.itens.length})`;
  $('#vistaHoje').hidden = ui.aba !== 'hoje';
  $('#vistaPilha').hidden = ui.aba !== 'pilha';
}

function htmlVazio() {
  return `<div class="vazio-caixa">
    <div class="vazio-pilha" aria-hidden="true"><i></i><i></i><i></i></div>
    <h2>Esta pasta ainda está vazia</h2>
    <p>Arraste para cá os resumos em <b>PDF</b>, <b>Word (.docx)</b> ou <b>foto</b> da folha,<br>ou use o botão abaixo. Pode adicionar vários de uma vez.</p>
    <button class="btn btn-primario" data-acao="adicionar">+ Adicionar resumos</button>
  </div>`;
}

function htmlMetaItem(i) {
  const n = i.revisoes.length;
  const ult = n ? `última em ${fmtData(i.revisoes[n - 1])}` : 'nunca revisado';
  return `adicionado em ${fmtData(i.adicionadoEm)} · ${n ? plural(n, 'revisão', 'revisões') + ' · ' : ''}${ult}`;
}

function renderHoje() {
  const p = pastaAtual();
  const v = $('#vistaHoje');
  observadorDocx.disconnect();
  if (!p.itens.length) { v.innerHTML = htmlVazio(); return; }
  const sel = selecaoDoDia(p);

  if (sel.feito) {
    const prox = previaAmanha(p);
    v.innerHTML = `<div class="feito-caixa">
      <div class="feito-selo">✓</div>
      <h2>Revisão de hoje feita</h2>
      <p class="feito-sub">Estas folhas voltaram para o fim da fila:</p>
      <ul class="feito-lista">${sel.itens.map((i) => `<li>${esc(i.titulo)}</li>`).join('')}</ul>
      ${prox.length ? `<div class="amanha"><span class="amanha-rotulo">Amanhã</span>${prox.map((i) => `<span class="amanha-item">${esc(i.titulo)}</span>`).join('')}</div>` : ''}
      <div class="feito-acoes">
        <button class="btn" data-acao="revisar-mais">Revisar mais ${p.porDia} agora</button>
        <button class="btn-fantasma" data-acao="desfazer-hoje">Desfazer a revisão de hoje</button>
      </div></div>`;
    return;
  }

  const totalVolta = Math.ceil(p.itens.length / p.porDia);
  v.innerHTML = `<div class="barra-hoje">
      <div class="por-dia">
        <span>Revisar</span>
        <button class="btn-icone" data-pordia="-1" aria-label="Menos">−</button>
        <b class="por-dia-n">${p.porDia}</b>
        <button class="btn-icone" data-pordia="1" aria-label="Mais">+</button>
        <span>por dia</span>
        <span class="dica">· a pilha dá uma volta completa a cada ${plural(totalVolta, 'dia', 'dias')}</span>
      </div>
      ${htmlZoom()}
    </div>
    <ol class="folhas">${sel.itens.map((i, k) => `
      <li class="folha-bloco">
        <div class="folha-cab">
          <span class="folha-ordem">${k + 1}<small>/${sel.itens.length}</small></span>
          <div class="folha-titulos"><h3>${esc(i.titulo)}</h3><span class="folha-meta">${htmlMetaItem(i)}</span></div>
          <button class="btn-fantasma pequeno" data-abrir="${esc(i.arquivo)}" title="Abrir no Word / leitor de PDF">Abrir no programa ↗</button>
        </div>
        <div class="folha-paginas" data-item="${i.id}"></div>
      </li>`).join('')}
    </ol>
    <div class="concluir">
      <button class="btn btn-primario grande" data-acao="concluir">✓ Concluí a revisão de hoje</button>
      <p>${sel.itens.length === 1 ? 'Esta folha vai' : `Estas ${sel.itens.length} folhas vão`} para o fim da fila. Amanhã aparecem as próximas.</p>
    </div>`;
  aplicarZoom();
  for (const i of sel.itens) renderizarFolha(i, v.querySelector(`[data-item="${i.id}"]`));
}

function renderPilha() {
  const p = pastaAtual();
  const v = $('#vistaPilha');
  if (!p.itens.length) { v.innerHTML = htmlVazio(); return; }
  const sel = selecaoDoDia(p);
  const idsHoje = new Set(sel.itens.map((i) => i.id));
  const h = hoje();
  v.innerHTML = `<p class="pilha-intro">A ordem abaixo é a fila: de cima para baixo. Cada revisão pega as primeiras da fila e manda para o fim.
    Arraste as linhas ou use as setas para mudar a ordem.</p>
    <ol class="pilha-lista">${p.itens.map((i, k) => {
      let selo = '';
      if (idsHoje.has(i.id)) selo = sel.feito ? '<span class="selo selo-ok">revisada hoje</span>' : '<span class="selo selo-hoje">hoje</span>';
      else if (i.adicionadoEm === h && elegiveis(p).length !== p.itens.length) selo = '<span class="selo selo-novo">nova · entra amanhã</span>';
      return `<li class="pilha-linha" draggable="true" data-id="${i.id}">
        <span class="pilha-pos">${k + 1}</span>
        <span class="tipo tipo-${i.tipo}">${i.tipo === 'docx' ? 'DOC' : i.tipo.toUpperCase()}</span>
        <div class="pilha-textos">
          <span class="pilha-titulo" data-titulo="${i.id}">${esc(i.titulo)}</span>${selo}
          <span class="folha-meta">${htmlMetaItem(i)}</span>
        </div>
        <div class="pilha-acoes">
          <button class="btn-icone" data-mover="topo" title="Mandar para o topo (próxima da fila)">⤒</button>
          <button class="btn-icone" data-mover="-1" title="Subir">↑</button>
          <button class="btn-icone" data-mover="1" title="Descer">↓</button>
          <button class="btn-icone" data-mover="fim" title="Mandar para o fim da fila">⤓</button>
          <span class="sep"></span>
          <button class="btn-fantasma pequeno" data-ver="${i.id}">Ver</button>
          <button class="btn-fantasma pequeno" data-renomear="${i.id}">Renomear</button>
          <button class="btn-fantasma pequeno" data-abrir="${esc(i.arquivo)}">Abrir ↗</button>
          <button class="btn-fantasma pequeno" data-substituir="${i.id}" title="Trocar o arquivo por uma versão nova, mantendo a posição na fila">Trocar arquivo</button>
          <button class="btn-fantasma pequeno perigo" data-remover="${i.id}">Remover</button>
        </div>
      </li>`;
    }).join('')}</ol>`;
}

// ---------- modais ----------
function abrirModal(html, aoAbrir) {
  const m = $('#modal');
  m.innerHTML = html;
  m.showModal();
  m.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => m.close()));
  if (aoAbrir) aoAbrir(m);
}
$('#modal').addEventListener('close', () => { observadorDocx.disconnect(); if (ui.aba === 'hoje') $$('#vistaHoje .folha-paginas').forEach((el) => observadorDocx.observe(el)); });
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.target.close(); });

function confirmar(titulo, texto, rotuloOk, perigo = false) {
  return new Promise((res) => {
    abrirModal(`<form method="dialog" class="modal-corpo pequeno-modal">
      <h2>${titulo}</h2><p>${texto}</p>
      <div class="modal-acoes"><button class="btn" value="nao">Cancelar</button>
      <button class="btn ${perigo ? 'btn-perigo' : 'btn-primario'}" value="sim">${rotuloOk}</button></div></form>`,
    (m) => m.addEventListener('close', () => res(m.returnValue === 'sim'), { once: true }));
  });
}

function verFolha(item) {
  abrirModal(`<div class="modal-corpo visualizador">
    <div class="visualizador-cab"><div><h2>${esc(item.titulo)}</h2><span class="folha-meta">${htmlMetaItem(item)}</span></div>
    ${htmlZoom()}<button class="btn" data-fechar>Fechar</button></div>
    <div class="visualizador-rolagem"><div class="folha-paginas" data-item="${item.id}"></div></div></div>`,
  (m) => { aplicarZoom(); renderizarFolha(item, m.querySelector('.folha-paginas')); });
}

function ajustesPasta() {
  const p = pastaAtual();
  abrirModal(`<form method="dialog" class="modal-corpo">
    <h2>Ajustes da pasta</h2>
    <label class="campo"><span>Nome</span><input name="nome" value="${esc(p.nome)}" required maxlength="60"></label>
    <label class="campo"><span>Quantas folhas revisar por dia</span><input name="porDia" type="number" min="1" max="30" value="${p.porDia}"></label>
    <fieldset class="campo"><legend>Onde entra um resumo novo</legend>
      <label class="opcao"><input type="radio" name="novos" value="topo" ${p.novosNoTopo ? 'checked' : ''}> <span><b>No topo da pilha</b> — aparece já na revisão de amanhã</span></label>
      <label class="opcao"><input type="radio" name="novos" value="fim" ${!p.novosNoTopo ? 'checked' : ''}> <span><b>No fim da fila</b> — espera a vez dele, depois de todas as outras</span></label>
    </fieldset>
    <div class="modal-acoes">
      <button type="button" class="btn-fantasma perigo" data-excluir-pasta>Excluir pasta</button>
      <span class="flex"></span>
      <button class="btn" value="cancelar" formnovalidate>Cancelar</button>
      <button class="btn btn-primario" value="ok">Salvar</button>
    </div></form>`,
  (m) => {
    m.querySelector('[data-excluir-pasta]').addEventListener('click', async () => {
      m.close();
      if (estado.pastas.length === 1) return toast('Precisa existir pelo menos uma pasta.');
      if (p.itens.length) return toast('Para excluir a pasta, remova as folhas dela antes (na aba "A pilha").');
      if (await confirmar('Excluir pasta?', `A pasta <b>${esc(p.nome)}</b> está vazia e vai sumir da lista.`, 'Excluir', true)) {
        estado.pastas = estado.pastas.filter((x) => x !== p);
        ui.pastaId = estado.pastas[0].id;
        await salvar(); render();
      }
    });
    m.addEventListener('close', async () => {
      if (m.returnValue !== 'ok') return;
      const f = new FormData(m.querySelector('form'));
      p.nome = String(f.get('nome')).trim() || p.nome;
      p.porDia = Math.min(30, Math.max(1, parseInt(f.get('porDia'), 10) || p.porDia));
      p.novosNoTopo = f.get('novos') === 'topo';
      await salvar(); render();
    }, { once: true });
  });
}

function novaPasta() {
  abrirModal(`<form method="dialog" class="modal-corpo pequeno-modal">
    <h2>Nova pasta</h2>
    <p>Cada pasta é uma pilha separada, com a sua própria fila. Ex.: “Resumos de matérias”, “Caderno de questões”, “Lei seca”.</p>
    <label class="campo"><span>Nome</span><input name="nome" required maxlength="60" autofocus></label>
    <div class="modal-acoes"><button class="btn" value="cancelar" formnovalidate>Cancelar</button><button class="btn btn-primario" value="ok">Criar</button></div></form>`,
  (m) => m.addEventListener('close', async () => {
    if (m.returnValue !== 'ok') return;
    const nome = String(new FormData(m.querySelector('form')).get('nome')).trim();
    if (!nome) return;
    const id = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 6);
    estado.pastas.push({ id, nome, porDia: 2, novosNoTopo: true, concluidoEm: null, ultimaSelecao: [], itens: [] });
    ui.pastaId = id; ui.aba = 'hoje';
    await salvar(); render();
  }, { once: true }));
}

function configuracoes() {
  abrirModal(`<div class="modal-corpo">
    <h2>Configurações</h2>
    <div class="campo"><span>Onde os resumos ficam guardados</span>
      <code class="caminho">${esc(pastaDados)}</code>
      <div class="linha-botoes"><button class="btn" data-abrir-dados>Abrir a pasta</button><button class="btn" data-mudar-dados>Mudar de lugar…</button></div>
      <small>Dica: se escolher uma pasta do Google Drive ou OneDrive, a pilha fica com backup e dá para usar em outro computador.</small>
    </div>
    <div class="como-funciona">
      <h3>Como funciona</h3>
      <ol>
        <li>Cada pasta é uma pilha de folhas, na ordem da fila.</li>
        <li>Todo dia o app mostra as próximas folhas da fila (2 por padrão; dá para aumentar perto da prova).</li>
        <li>Ao terminar, clique em <b>Concluí a revisão de hoje</b>: essas folhas vão para o fim da fila e amanhã vêm as seguintes.</li>
        <li>Quando a fila acaba, ela recomeça. Assim todas as folhas são revisadas várias vezes.</li>
        <li>Um resumo novo entra no topo da pilha e aparece a partir do dia seguinte. Se pular um dia, o app continua de onde parou.</li>
      </ol>
    </div>
    <div class="modal-acoes"><button class="btn btn-primario" data-fechar>Fechar</button></div></div>`,
  (m) => {
    m.querySelector('[data-abrir-dados]').addEventListener('click', () => api.abrirPastaDados());
    m.querySelector('[data-mudar-dados]').addEventListener('click', async () => {
      const nova = await api.mudarPastaDados();
      if (!nova) return;
      const r = await api.carregar();
      estado = r.estado; pastaDados = r.pastaDados;
      ui.pastaId = estado.pastas[0].id;
      m.close(); render();
      toast('Pronto: a pilha agora fica em ' + nova);
    });
  });
}

// ---------- toast ----------
let toastTimer;
function toast(msg, rotuloAcao, acao) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${rotuloAcao ? `<button class="toast-acao">${esc(rotuloAcao)}</button>` : ''}`;
  t.hidden = false;
  if (acao) t.querySelector('.toast-acao').addEventListener('click', () => { t.hidden = true; acao(); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), rotuloAcao ? 9000 : 6000);
}

// ---------- eventos ----------
function itemPorId(id) { return pastaAtual().itens.find((i) => i.id === id); }

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const p = pastaAtual();

  if (b.dataset.pasta) { ui.pastaId = b.dataset.pasta; salvarPref('pasta', ui.pastaId); render(); return; }
  if (b.dataset.aba) { ui.aba = b.dataset.aba; salvarPref('aba', ui.aba); render(); return; }
  if (b.dataset.zoom) { mudarZoom(Number(b.dataset.zoom)); return; }
  if (b.dataset.abrir) { api.abrir(b.dataset.abrir); return; }
  if (b.dataset.pordia) {
    p.porDia = Math.min(30, Math.max(1, p.porDia + Number(b.dataset.pordia)));
    await salvar(); renderHoje(); return;
  }
  if (b.dataset.ver) { verFolha(itemPorId(b.dataset.ver)); return; }
  if (b.dataset.mover) {
    const id = b.closest('[data-id]').dataset.id;
    const idx = p.itens.findIndex((i) => i.id === id);
    const [it] = p.itens.splice(idx, 1);
    const m = b.dataset.mover;
    const destino = m === 'topo' ? 0 : m === 'fim' ? p.itens.length : Math.min(p.itens.length, Math.max(0, idx + Number(m)));
    p.itens.splice(destino, 0, it);
    await salvar(); renderPilha(); return;
  }
  if (b.dataset.renomear) { renomear(b.dataset.renomear); return; }
  if (b.dataset.substituir) {
    const it = itemPorId(b.dataset.substituir);
    if (await api.substituir(it.arquivo)) { toast('Arquivo trocado. A folha continua no mesmo lugar da fila.'); render(); }
    return;
  }
  if (b.dataset.remover) {
    const it = itemPorId(b.dataset.remover);
    if (await confirmar('Remover da pilha?', `<b>${esc(it.titulo)}</b> sai da fila. O arquivo vai para a subpasta <i>_removidos</i>, caso precise recuperar.`, 'Remover', true)) {
      await api.apagar(it.arquivo);
      p.itens = p.itens.filter((i) => i !== it);
      p.ultimaSelecao = p.ultimaSelecao.filter((id) => id !== it.id);
      await salvar(); render();
    }
    return;
  }
  switch (b.dataset.acao) {
    case 'adicionar': adicionar(await api.escolherArquivos(p.id)); break;
    case 'concluir': concluirHoje(p); break;
    case 'revisar-mais': p.concluidoEm = null; await salvar(); render(); break;
    case 'desfazer-hoje': {
      // devolve as folhas de hoje para o começo da fila
      const ids = new Set(p.ultimaSelecao);
      const voltam = p.ultimaSelecao.map((id) => p.itens.find((i) => i.id === id)).filter(Boolean);
      for (const i of voltam) if (i.revisoes[i.revisoes.length - 1] === hoje()) i.revisoes.pop();
      p.itens = [...voltam, ...p.itens.filter((i) => !ids.has(i.id))];
      p.concluidoEm = null; p.ultimaSelecao = [];
      await salvar(); render(); break;
    }
  }
});

$('#btnAdicionar').addEventListener('click', async () => adicionar(await api.escolherArquivos(pastaAtual().id)));
$('#btnPastaConfig').addEventListener('click', ajustesPasta);
$('#btnNovaPasta').addEventListener('click', novaPasta);
$('#btnConfig').addEventListener('click', configuracoes);

function renomear(id) {
  const it = itemPorId(id);
  const span = $(`[data-titulo="${id}"]`);
  const input = document.createElement('input');
  input.className = 'input-renomear';
  input.value = it.titulo;
  span.replaceWith(input);
  input.focus(); input.select();
  let feito = false;
  const fim = async (salvarNome) => {
    if (feito) return; feito = true;
    if (salvarNome && input.value.trim()) { it.titulo = input.value.trim(); await salvar(); }
    renderPilha();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') fim(true); if (e.key === 'Escape') fim(false); });
  input.addEventListener('blur', () => fim(true));
}

// arrastar linhas para reordenar
let arrastando = null;
document.addEventListener('dragstart', (e) => {
  const li = e.target.closest?.('.pilha-linha');
  if (!li) return;
  arrastando = li.dataset.id;
  li.classList.add('arrastando');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-pilha', arrastando);
});
document.addEventListener('dragend', () => { arrastando = null; $$('.pilha-linha').forEach((l) => l.classList.remove('arrastando', 'alvo-cima', 'alvo-baixo')); });

// arrastar arquivos do computador
let contadorSoltar = 0;
const temArquivos = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!temArquivos(e)) return;
  contadorSoltar++;
  $('#soltarPasta').textContent = pastaAtual().nome;
  $('#soltar').hidden = false;
});
document.addEventListener('dragleave', (e) => {
  if (!temArquivos(e)) return;
  if (--contadorSoltar <= 0) { contadorSoltar = 0; $('#soltar').hidden = true; }
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (arrastando) {
    const li = e.target.closest('.pilha-linha');
    $$('.pilha-linha').forEach((l) => l.classList.remove('alvo-cima', 'alvo-baixo'));
    if (li && li.dataset.id !== arrastando) {
      const r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'alvo-cima' : 'alvo-baixo');
    }
  }
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (arrastando) {
    const li = e.target.closest('.pilha-linha');
    const p = pastaAtual();
    if (li && li.dataset.id !== arrastando) {
      const r = li.getBoundingClientRect();
      const depois = e.clientY >= r.top + r.height / 2;
      const it = p.itens.find((i) => i.id === arrastando);
      p.itens = p.itens.filter((i) => i !== it);
      let idx = p.itens.findIndex((i) => i.id === li.dataset.id);
      if (depois) idx++;
      p.itens.splice(idx, 0, it);
      await salvar(); renderPilha();
    }
    return;
  }
  contadorSoltar = 0;
  $('#soltar').hidden = true;
  const caminhos = [...e.dataTransfer.files].map((f) => api.caminhoDe(f)).filter(Boolean);
  if (caminhos.length) adicionar(await api.importar(pastaAtual().id, caminhos));
});

// vira o dia com o app aberto
setInterval(() => {
  if (hojeFixo) return;
  const d = $('#dataHoje').dataset.dia;
  if (d && d !== hoje()) render();
  $('#dataHoje').dataset.dia = hoje();
}, 60_000);

// ---------- início ----------
(async function iniciar() {
  const r = await api.carregar();
  estado = r.estado; pastaDados = r.pastaDados; hojeFixo = r.hoje;
  estado.zoom = estado.zoom || 1;
  ui.pastaId = lerPref('pasta', estado.pastas[0].id);
  if (!estado.pastas.some((p) => p.id === ui.pastaId)) ui.pastaId = estado.pastas[0].id;
  ui.aba = lerPref('aba', 'hoje') === 'pilha' ? 'pilha' : 'hoje';
  $('#dataHoje').dataset.dia = hoje();
  render();
})();
