// Service worker: deixa o app abrir sem internet.
// Estratégia: responde do cache na hora e atualiza o cache em segundo plano,
// então uma versão nova aparece na próxima vez que o app for aberto.
const CACHE = 'pilha-dev'; // o workflow troca por 'pilha-<commit>' a cada publicação
const ARQUIVOS = [
  './', './index.html', './app.js', './web-api.js', './styles.css', './manifest.webmanifest',
  './icone.png', './icones/apple-touch-icon.png', './icones/icone-192.png', './icones/icone-512.png',
  './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs', './vendor/docx-preview.min.js', './vendor/jszip.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const emCache = await cache.match(req, { ignoreSearch: true });
      const daRede = fetch(req)
        .then((resp) => { if (resp && resp.ok) cache.put(req, resp.clone()); return resp; })
        .catch(() => null);
      if (emCache) { e.waitUntil(daRede); return emCache; }
      return (await daRede) || new Response('Sem conexão', { status: 503 });
    })
  );
});
