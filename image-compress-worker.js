/* ============================================================
   BAZARES — Worker de compressão de imagem
   ------------------------------------------------------------
   Corre fora da thread principal: redimensiona a imagem para o
   lado maior no máximo em `maxSize` e reexporta como JPEG na
   qualidade pedida. Usa OffscreenCanvas (sem acesso ao DOM, por
   isso tem de correr aqui e não pode usar <canvas> normal).
============================================================ */
self.onmessage = async (e) => {
  const { id, file, maxSize, quality } = e.data;
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width > height && width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
    else if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    self.postMessage({ id, ok: true, blob });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
