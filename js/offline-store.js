/* ============================================================
   BAZARES — Offline Store (IndexedDB)
   ------------------------------------------------------------
   Guarda a ÚLTIMA resposta boa de cada endpoint GET importante
   (feed da Home, produtos, categorias, perfil da loja) para que,
   sem rede, a app mostre "estás a ver dados guardados" em vez de
   um ecrã de erro vazio. Não é sincronização bidireccional nem
   fila de escrita offline (isso fica para uma fase seguinte,
   quando fizer sentido para acções como comentar/reagir offline)
   — por agora é só leitura, que é o que resolve o problema mais
   comum: abrir a app numa rede fraca/instável e ver um ecrã em
   branco.

   Uso:
     await OfflineStore.save('home-feed', data)
     const cached = await OfflineStore.load('home-feed')
     // cached === null se nunca guardado, ou { data, savedAt }

   Carregar DEPOIS de core.js.
============================================================ */
'use strict';

window.OfflineStore = (() => {
  const DB_NAME = 'bazares-offline';
  const DB_VERSION = 1;
  const STORE = 'snapshots';
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null); // IndexedDB indisponível (modo privado, etc.) — falha em silêncio
    });
    return dbPromise;
  }

  async function save(key, data) {
    try {
      const db = await openDb();
      if (!db) return false;
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, data, savedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch { return false; }
  }

  async function load(key) {
    try {
      const db = await openDb();
      if (!db) return null;
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  async function clear() {
    try {
      const db = await openDb();
      if (!db) return;
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
    } catch {}
  }

  // Envolve uma chamada GET normal: tenta a rede, guarda o resultado
  // bom em IndexedDB; se a rede falhar, cai para o último resultado
  // guardado e avisa o utilizador com um toast (não faz isto em
  // silêncio — dados desactualizados sem aviso podem enganar, ex.:
  // preço ou stock antigo de um produto).
  async function getWithFallback(key, fetcher, { maxAgeMs = null } = {}) {
    try {
      const data = await fetcher();
      save(key, data); // não bloqueia — guarda em segundo plano
      return { data, fromCache: false };
    } catch (err) {
      if (!err?.networkError) throw err; // erro "de negócio" — não tem cache que ajude
      const cached = await load(key);
      if (!cached) throw err;
      if (maxAgeMs && (Date.now() - cached.savedAt) > maxAgeMs) throw err; // cache velha demais para este caso
      if (typeof toast === 'function') {
        const mins = Math.round((Date.now() - cached.savedAt) / 60000);
        const when = mins < 1 ? 'há instantes' : mins < 60 ? `há ${mins} min` : 'há algum tempo';
        toast(`Sem ligação — a mostrar dados guardados (${when}).`, 'warn', 5000);
      }
      return { data: cached.data, fromCache: true, savedAt: cached.savedAt };
    }
  }

  return { save, load, clear, getWithFallback };
})();
