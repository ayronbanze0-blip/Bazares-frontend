/* ============================================================
   BAZARES — Media Compress (wrapper do Worker de imagem)
   ------------------------------------------------------------
   Mesma assinatura e comportamento do compressImage() que antes
   estava duplicado em my-products.html e novoproduto.html — só
   que agora, sempre que o browser suporta (OffscreenCanvas +
   createImageBitmap + Worker, a maioria em 2026), o trabalho
   pesado de redimensionar/recodificar corre numa Worker thread,
   sem travar a interface enquanto se publica um produto/post com
   várias fotos grandes. Em navegadores mais antigos que não
   suportam, cai sozinho para a thread principal (mesmo código de
   sempre) — nunca fica sem funcionar, só sem o ganho de fluidez.

   Uso:
     const compressed = await MediaCompress.compressImage(file);

   Carregar DEPOIS de core.js, ANTES de qualquer página que
   publique fotos (my-products.html, novoproduto.html, ...).
============================================================ */
'use strict';

window.MediaCompress = (() => {
  let worker = null;
  let workerBroken = false;
  let nextId = 1;
  const pending = new Map();

  function supported() {
    return !workerBroken && typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
  }

  function getWorker() {
    if (worker) return worker;
    try {
      worker = new Worker('/js/image-compress-worker.js');
      worker.onmessage = (e) => {
        const { id, ok, blob, error } = e.data;
        const cb = pending.get(id);
        if (!cb) return;
        pending.delete(id);
        ok ? cb.resolve(blob) : cb.reject(new Error(error));
      };
      worker.onerror = () => {
        // Worker rebentou de vez (ex.: bloqueado por política de rede) —
        // marca como avariado para as próximas chamadas caírem logo para
        // a thread principal em vez de tentarem e falharem outra vez.
        workerBroken = true;
        pending.forEach(cb => cb.reject(new Error('worker error')));
        pending.clear();
      };
    } catch { worker = null; workerBroken = true; }
    return worker;
  }

  function compressInWorker(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
      const w = getWorker();
      if (!w) { reject(new Error('worker indisponível')); return; }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, file, maxSize, quality });
    });
  }

  // Fallback — idêntico ao compressImage() que já existia nas páginas.
  function compressMainThread(file, maxSize, quality) {
    return new Promise(resolve => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > height && width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
        else if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function compressImage(file, maxSize = 1600, quality = 0.82) {
    if (file.size < 350 * 1024) return file; // ficheiro já pequeno — não compensa reprocessar
    let blob;
    try {
      blob = supported() ? await compressInWorker(file, maxSize, quality) : await compressMainThread(file, maxSize, quality);
    } catch {
      try { blob = await compressMainThread(file, maxSize, quality); } catch { return file; }
    }
    if (!blob || blob.size >= file.size) return file; // não compensou — mantém original
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  }

  return { compressImage };
})();
