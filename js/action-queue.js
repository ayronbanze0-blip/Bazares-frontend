/* ============================================================
   BAZARES — Action Queue (sincronização em segundo plano)
   ------------------------------------------------------------
   Nota honesta sobre o que isto É e o que NÃO é: a Background
   Sync API do browser (`registration.sync`) permite que o
   Service Worker repita um pedido mesmo com a aba fechada — mas
   só funcionaria aqui se o pedido pudesse ser autenticado sem o
   token de acesso, que vive só em memória na página (nunca é
   persistido, por segurança) e não chega ao Service Worker. Por
   isso isto é sincronização "ao nível da página": a acção fica
   guardada em localStorage (dados simples, não uma função — por
   isso sobrevive a recarregar a página) e é reenviada
   automaticamente quando (a) a rede volta ('online') ou (b) a
   página fica visível outra vez.

   Cada TIPO de acção regista-se uma única vez, no arranque da
   página (ex.: app.js regista 'react'), não por item — assim um
   item enfileirado antes de recarregar continua reenviável depois.

   Uso:
     ActionQueue.registerHandler('react', (payload) => syncX(payload))
     ActionQueue.enqueue('react:feed-PRODUCT-123', 'react', {...}, 'reacção')
============================================================ */
'use strict';

window.ActionQueue = (function () {
  const KEY = 'bz_action_queue_v1';
  const handlers = new Map(); // type -> async function(payload)
  let flushing = false;
  const listeners = new Set(); // avisados sempre que o nº de pendentes muda — ver onChange()

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  }
  function writeQueue(q) {
    try { localStorage.setItem(KEY, JSON.stringify(q)); } catch {}
    const count = Object.keys(q).length;
    listeners.forEach(fn => { try { fn(count); } catch {} });
  }

  function registerHandler(type, fn) {
    handlers.set(type, fn);
  }

  function enqueue(key, type, payload, label) {
    const q = readQueue();
    q[key] = { type, payload, label: label || '', queuedAt: Date.now() };
    writeQueue(q);
    // Reforço para Chrome/Edge/Android: pede ao browser para avisar o
    // Service Worker assim que a rede voltar, mesmo que 'online' não
    // dispare a tempo por algum motivo. Falha em silêncio onde não há
    // suporte (iOS Safari) — o fallback 'online'/visibilitychange
    // abaixo cobre esses casos.
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.sync.register('bz-flush-actions'))
        .catch(() => {});
    }
  }

  function dequeue(key) {
    const q = readQueue();
    if (q[key]) { delete q[key]; writeQueue(q); }
  }

  function pendingCount() {
    return Object.keys(readQueue()).length;
  }

  async function flush() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    const synced = []; // labels das acções que conseguiram sair desta vez
    try {
      const q = readQueue();
      for (const key of Object.keys(q)) {
        const item = q[key];
        const handler = handlers.get(item.type);
        if (!handler) continue; // tipo ainda não registado nesta página — tenta mais tarde
        try {
          await handler(item.payload);
          dequeue(key);
          synced.push(item.label || '');
        } catch (e) {
          if (!e?.networkError) dequeue(key); // erro "de negócio" — repetir não ia ajudar
          // erro de rede — mantém na fila, tenta na próxima 'online'
        }
      }
    } finally {
      flushing = false;
    }
    // Avisa que o que ficou pendente offline já foi enviado — sem isto,
    // a pessoa nunca sabe se aquela reacção/acção chegou mesmo a sair,
    // só que "parecia" ter funcionado no momento em que a fez.
    if (synced.length && typeof toast === 'function') {
      const msg = synced.length === 1
        ? `${synced[0] ? synced[0].charAt(0).toUpperCase() + synced[0].slice(1) : 'Ação pendente'} sincronizada.`
        : `${synced.length} ações pendentes foram sincronizadas.`;
      toast(msg, 'ok', 3000);
    }
  }

  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'bz-flush-actions') flush();
    });
  }

  // onChange(fn) — regista para ser avisado sempre que o nº de acções
  // pendentes mudar (enfileirar, sincronizar com sucesso, ou falhar
  // por erro "de negócio" e sair da fila). Usado pelo indicador do
  // topbar (ver buildTopbar em app.js) para se manter sempre correcto,
  // em vez de só actualizar quando a página carrega.
  function onChange(fn) {
    listeners.add(fn);
    fn(pendingCount()); // estado actual já ao registar, sem esperar pela próxima mudança
    return () => listeners.delete(fn);
  }

  return { registerHandler, enqueue, dequeue, flush, pendingCount, onChange };
})();
