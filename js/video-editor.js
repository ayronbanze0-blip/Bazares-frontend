/* ============================================================
   BAZARES — Editor de vídeo partilhado (Fase 3)
   O backend já não aceita o campo multipart "video" directo em
   POST /bazars/:id/stories ou /bazars/:id/reels — exige um
   `processedVideoJobId` obtido em POST /api/media/video/process
   (corte + capa + áudio opcional, processado em FFmpeg no servidor)
   e confirmado via polling em GET /api/media/video/process/:jobId
   até status=DONE. Este módulo isola esse fluxo para ser
   reaproveitado em qualquer página (histórias, Reels).
============================================================ */
'use strict';

let _veState = null;

/**
 * Abre o editor de vídeo para `file` (um File bruto escolhido pelo
 * utilizador) e devolve, via `onDone`, o resultado processado:
 * { jobId, resultUrl, thumbnailUrl, durationSec }.
 *
 * @param {File} file
 * @param {Object} opts
 * @param {'stories'|'reels'} opts.target
 * @param {number} opts.maxSeconds - duração máxima do corte final
 * @param {Function} opts.onDone
 * @param {Function} [opts.onCancel]
 */
function openVideoEditor(file, opts) {
  const { target, maxSeconds, onDone, onCancel } = opts;
  const objUrl = URL.createObjectURL(file);
  _veState = { file, target, maxSeconds, onDone, onCancel, objUrl, duration: 0, start: 0, end: 0, cover: 0, audioFile: null, jobId: null, polling: false };

  let root = document.getElementById('ve-root');
  if (!root) { root = document.createElement('div'); root.id = 've-root'; document.body.appendChild(root); }
  root.innerHTML = `
    <div class="ve-bd" id="ve-bd">
      <div class="ve-sheet">
        <div class="ve-hd"><b>Editar vídeo</b><button type="button" class="modal-x" onclick="cancelVideoEditor()">${typeof icon === 'function' ? icon('close', 18, 2) : '✕'}</button></div>
        <div class="ve-body">
          <video id="ve-video" src="${objUrl}" muted playsinline></video>

          <label class="ve-label">Corte (até ${maxSeconds}s)</label>
          <div class="ve-range-wrap">
            <input type="range" id="ve-start" min="0" max="0" step="0.1" value="0">
            <input type="range" id="ve-end" min="0" max="0" step="0.1" value="0">
          </div>
          <div class="ve-time-row"><span id="ve-start-lbl">0.0s</span><span id="ve-dur-lbl"></span><span id="ve-end-lbl">0.0s</span></div>

          <label class="ve-label">Capa (fotograma de destaque)</label>
          <input type="range" id="ve-cover" min="0" max="0" step="0.1" value="0">

          <label class="ve-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="ve-keep-audio" checked style="width:auto"> Manter o som original
          </label>

          <label class="ve-label">Música (opcional)</label>
          <div class="imgup-drop" id="ve-audio-drop" style="padding:16px" onclick="document.getElementById('ve-audio-input').click()">
            <div id="ve-audio-name" style="font-size:12.5px;font-weight:700">Toque para escolher um áudio</div>
          </div>
          <input type="file" id="ve-audio-input" accept="audio/mpeg,audio/mp3,audio/wav,audio/m4a,audio/aac" hidden>

          <div id="ve-progress-wrap" style="display:none">
            <div class="ve-progress-bar"><div class="ve-progress-fill" id="ve-progress-fill"></div></div>
            <p id="ve-progress-txt" style="text-align:center;font-size:12px;color:var(--t3);margin-top:8px">A processar…</p>
          </div>
        </div>
        <div class="ve-footer">
          <button type="button" class="btn btn-ghost" onclick="cancelVideoEditor()">Cancelar</button>
          <button type="button" class="btn btn-primary" id="ve-apply-btn" onclick="applyVideoEditor()">Usar este vídeo</button>
        </div>
      </div>
    </div>`;

  const video = document.getElementById('ve-video');
  video.addEventListener('loadedmetadata', () => {
    const dur = video.duration || 0;
    const end = Math.min(dur, maxSeconds);
    _veState.duration = dur;
    _veState.start = 0;
    _veState.end = end;
    _veState.cover = 0;
    ['ve-start', 've-end', 've-cover'].forEach(id => {
      document.getElementById(id).max = dur;
    });
    document.getElementById('ve-start').value = 0;
    document.getElementById('ve-end').value = end;
    document.getElementById('ve-cover').value = 0;
    document.getElementById('ve-dur-lbl').textContent = `total: ${dur.toFixed(1)}s`;
    updateVeLabels();
  });

  document.getElementById('ve-start').addEventListener('input', onVeRangeChange);
  document.getElementById('ve-end').addEventListener('input', onVeRangeChange);
  document.getElementById('ve-cover').addEventListener('input', e => {
    let v = Number(e.target.value);
    if (v < _veState.start) v = _veState.start;
    if (v > _veState.end) v = _veState.end;
    _veState.cover = v;
    video.currentTime = v;
  });
  document.getElementById('ve-audio-input').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f) return;
    _veState.audioFile = f;
    document.getElementById('ve-audio-name').textContent = f.name;
  });
}

function onVeRangeChange() {
  let start = Number(document.getElementById('ve-start').value);
  let end = Number(document.getElementById('ve-end').value);
  if (end - start > _veState.maxSeconds) {
    // Mantém a janela dentro do limite, empurrando o handle oposto ao que se moveu.
    if (this && this.id === 've-start') end = start + _veState.maxSeconds;
    else start = end - _veState.maxSeconds;
  }
  if (end <= start) end = Math.min(_veState.duration, start + 0.5);
  start = Math.max(0, start);
  end = Math.min(_veState.duration, end);
  _veState.start = start;
  _veState.end = end;
  document.getElementById('ve-start').value = start;
  document.getElementById('ve-end').value = end;
  const coverInput = document.getElementById('ve-cover');
  if (_veState.cover < start || _veState.cover > end) {
    _veState.cover = start;
    coverInput.value = start;
  }
  const video = document.getElementById('ve-video');
  if (video) video.currentTime = start;
  updateVeLabels();
}

function updateVeLabels() {
  document.getElementById('ve-start-lbl').textContent = `${_veState.start.toFixed(1)}s`;
  document.getElementById('ve-end-lbl').textContent = `${_veState.end.toFixed(1)}s`;
}

function cancelVideoEditor() {
  if (_veState?.polling) return; // não cancela a meio do processamento — evita job órfão sem feedback
  if (_veState?.objUrl) URL.revokeObjectURL(_veState.objUrl);
  const onCancel = _veState?.onCancel;
  document.getElementById('ve-root')?.remove();
  _veState = null;
  if (onCancel) onCancel();
}

async function applyVideoEditor() {
  const st = _veState;
  if (!st) return;
  if (st.end - st.start < 0.5) { toast('O corte tem de ter pelo menos meio segundo.', 'warn'); return; }

  const btn = document.getElementById('ve-apply-btn');
  setLoading(btn, true);
  document.getElementById('ve-progress-wrap').style.display = '';
  st.polling = true;

  try {
    // ─── Recorte já no telemóvel, antes de subir ───────────────────
    // Antes disto, enviávamos sempre o ficheiro BRUTO inteiro (st.file)
    // ao servidor, mesmo que o utilizador só quisesse guardar 8s de um
    // vídeo de 2 minutos — a parte lenta da publicação (1-3 minutos)
    // era sobretudo o envio desse ficheiro grande pela rede móvel, não
    // o processamento em si. Se o browser suportar captureStream()+
    // MediaRecorder, recortamos aqui mesmo (só o troço escolhido) antes
    // de enviar; o ficheiro que sobe fica muito mais pequeno. Se o
    // browser não suportar, seguimos como antes (ficheiro bruto,
    // recorte só no servidor) — nunca bloqueia a publicação.
    const isTrimmed = st.start > 0.05 || st.end < st.duration - 0.05;
    let videoToUpload = st.file;
    let sendTrimStart = st.start, sendTrimEnd = st.end;

    if (isTrimmed) {
      const txt = document.getElementById('ve-progress-txt');
      if (txt) txt.textContent = 'A recortar no telemóvel…';
      const trimmed = await clientTrimVideo(st.file, st.start, st.end);
      if (trimmed) {
        videoToUpload = trimmed;
        sendTrimStart = 0;
        sendTrimEnd = st.end - st.start; // o ficheiro enviado já começa no ponto certo
      }
    }

    // Guarda o vídeo já recortado (o trabalho pesado e único que não
    // se pode perder) — se o envio falhar por rede, "Tentar novamente"
    // reusa isto directamente, sem recortar outra vez nem pedir para
    // escolher o ficheiro de novo.
    st.preparedBlob = videoToUpload;
    st.preparedTrimStart = sendTrimStart;
    st.preparedTrimEnd = sendTrimEnd;
    st.preparedIsTrimmedFile = videoToUpload !== st.file;

    await uploadAndProcessVideo(st, btn);
  } catch (e) {
    st.polling = false;
    setLoading(btn, false);
    document.getElementById('ve-progress-wrap').style.display = 'none';
    toast(apiErrorMessage(e), 'err');
  }
}

// Envia o vídeo já preparado (st.preparedBlob) e acompanha o
// processamento. Duas coisas que antes faziam perder os 1-3 minutos
// já gastos ao primeiro soluço de rede, corrigidas aqui:
//  1. Um único pedido falhado (envio OU verificação de estado) já
//     chumbava tudo — agora tenta sozinho mais 2 vezes (só para erros
//     de REDE, nunca para um erro "de negócio" do servidor, esse não
//     se resolve repetindo) antes de mostrar qualquer erro.
//  2. Se mesmo assim falhar, e o envio já tinha criado um job no
//     servidor (o vídeo já lá está, só a verificação de estado é que
//     falhou), "Tentar novamente" retoma esse job em vez de reenviar
//     o vídeo do zero — o envio grande só volta a acontecer se tiver
//     mesmo falhado antes de o job chegar a existir.
async function uploadAndProcessVideo(st, btn) {
  const txt = document.getElementById('ve-progress-txt');
  try {
    if (!st.jobId) {
      if (txt) txt.textContent = 'A enviar o vídeo…';
      const fd = new FormData();
      const blob = st.preparedBlob || st.file;
      fd.append('video', blob, blob.name || `recorte.${(blob.type||'').includes('mp4')?'mp4':'webm'}`);
      if (st.audioFile) fd.append('audio', st.audioFile);
      fd.append('target', st.target);
      fd.append('trimStart', st.preparedTrimStart.toFixed(2));
      fd.append('trimEnd', st.preparedTrimEnd.toFixed(2));
      fd.append('coverTime', Math.max(0, st.cover - (st.preparedIsTrimmedFile ? st.start : 0)).toFixed(2));
      fd.append('keepOriginalAudio', document.getElementById('ve-keep-audio').checked ? 'true' : 'false');

      const startRes = await withNetworkRetry(() => api.postForm('/media/video/process', fd), 2);
      const jobId = startRes?.data?.jobId;
      if (!jobId) throw { message: 'Não foi possível iniciar o processamento do vídeo.' };
      st.jobId = jobId;
    }

    await pollVeJob(st.jobId);
  } catch (e) {
    st.polling = false;
    setLoading(btn, false);
    showVeRetry(st.jobId
      ? 'A ligação falhou a meio da verificação — o teu vídeo já está no servidor, não precisas de o enviar outra vez.'
      : apiErrorMessage(e));
  }
}

// Repete `fn` até `maxRetries` vezes, só quando o erro é de rede
// (networkError) — um erro "de negócio" (ex.: vídeo demasiado longo,
// 413 payload too large) nunca se resolve tentando outra vez, por
// isso propaga-se de imediato. Pausa curta entre tentativas para dar
// tempo à ligação de estabilizar.
async function withNetworkRetry(fn, maxRetries) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (!e?.networkError || attempt === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Mostra o botão "Tentar novamente" na área de progresso, em vez de
// só um toast que obriga a recomeçar tudo do zero.
function showVeRetry(message) {
  const wrap = document.getElementById('ve-progress-wrap');
  if (!wrap) { toast(message, 'err'); return; }
  wrap.style.display = '';
  wrap.innerHTML = `
    <p style="text-align:center;font-size:12.5px;color:var(--t3);margin-bottom:10px">${esc(message)}</p>
    <button type="button" class="btn btn-primary btn-block" onclick="retryVideoEditor()">Tentar novamente</button>`;
}

// Chamado pelo botão "Tentar novamente". Nunca recorta nem pede o
// ficheiro outra vez — reusa exactamente o que já foi preparado.
async function retryVideoEditor() {
  const st = _veState;
  if (!st) return;
  const wrap = document.getElementById('ve-progress-wrap');
  if (wrap) wrap.innerHTML = `
    <div class="ve-progress-bar"><div class="ve-progress-fill" id="ve-progress-fill"></div></div>
    <p id="ve-progress-txt" style="text-align:center;font-size:12px;color:var(--t3);margin-top:8px">A tentar de novo…</p>`;
  const btn = document.getElementById('ve-apply-btn');
  setLoading(btn, true);
  st.polling = true;
  await uploadAndProcessVideo(st, btn);
}


// video.captureStream() + MediaRecorder (suportado no Chrome/Android
// e no Safari/iOS recente). Devolve um Blob já recortado, ou `null`
// se o browser não suportar — nesse caso o chamador usa o ficheiro
// bruto como sempre fez, sem quebrar nada.
function clientTrimVideo(file, start, end) {
  return new Promise((resolve) => {
    try {
      if (typeof MediaRecorder === 'undefined') return resolve(null);
      const video = document.createElement('video');
      video.muted = false;
      video.playsInline = true;
      video.src = URL.createObjectURL(file);

      const cleanupUrl = () => { try { URL.revokeObjectURL(video.src); } catch(e){} };

      video.addEventListener('loadedmetadata', () => {
        const captureFn = video.captureStream || video.mozCaptureStream;
        if (typeof captureFn !== 'function') { cleanupUrl(); return resolve(null); }
        video.currentTime = start;
        video.addEventListener('seeked', function onSeeked() {
          video.removeEventListener('seeked', onSeeked);
          try {
            const stream = captureFn.call(video);
            const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
            const mime = candidates.find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
            // videoBitsPerSecond: sem isto, o MediaRecorder usa um
            // bitrate por omissão do browser que é baixo demais para
            // vídeo vertical/HD — as dimensões (largura/altura) saem
            // certas, mas a imagem fica em blocos, com aspecto visual
            // de ~320p mesmo dizendo 720p/1080p nos metadados. Isto
            // acontecia em praticamente todos os vídeos publicados,
            // porque quase todos passam por corte (logo por aqui).
            // Escalamos o bitrate à resolução real do vídeo capturado
            // (video.videoWidth/videoHeight, já disponíveis aqui via
            // loadedmetadata) em vez de um valor fixo, para não pesar
            // desnecessariamente em vídeos pequenos.
            const w = video.videoWidth || 720, h = video.videoHeight || 1280;
            const area = w * h;
            const videoBitsPerSecond = area >= 1920 * 1080 ? 8_000_000
              : area >= 1280 * 720 ? 5_000_000
              : 2_500_000;
            const recorder = new MediaRecorder(stream, {
              ...(mime ? { mimeType: mime } : {}),
              videoBitsPerSecond
            });
            const chunks = [];
            recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            recorder.onstop = () => {
              cleanupUrl();
              if (!chunks.length) return resolve(null);
              resolve(new Blob(chunks, { type: mime || 'video/webm' }));
            };
            recorder.onerror = () => { cleanupUrl(); resolve(null); };
            recorder.start();
            video.play().catch(() => {});
            const durationTarget = end - start;
            const startedAt = performance.now();
            const check = () => {
              if (!_veState) { recorder.stop(); return; } // editor foi cancelado a meio
              const elapsed = (performance.now() - startedAt) / 1000;
              if (video.currentTime - start >= durationTarget || elapsed >= durationTarget + 1) {
                video.pause();
                recorder.stop();
              } else {
                requestAnimationFrame(check);
              }
            };
            requestAnimationFrame(check);
          } catch (e) {
            cleanupUrl();
            resolve(null);
          }
        });
      }, { once: true });
      video.addEventListener('error', () => { cleanupUrl(); resolve(null); });
    } catch (e) {
      resolve(null);
    }
  });
}

function pollVeJob(jobId) {
  return new Promise((resolve, reject) => {
    const fill = document.getElementById('ve-progress-fill');
    const txt = document.getElementById('ve-progress-txt');
    let consecutiveNetworkFails = 0;
    const MAX_CONSECUTIVE_FAILS = 5; // ~7.5s de rede em baixo seguidos, sem contar backoff — só desiste se for mesmo persistente
    const tick = async () => {
      if (!_veState || _veState.jobId !== jobId) return; // editor foi fechado/substituído entretanto
      try {
        const r = await api.get(`/media/video/process/${jobId}`);
        consecutiveNetworkFails = 0;
        const d = r?.data || {};
        if (fill) fill.style.width = `${Math.max(5, d.progress || 0)}%`;
        if (txt) txt.textContent = d.status === 'PROCESSING' ? `A processar… ${d.progress || 0}%` : 'A preparar…';
        if (d.status === 'DONE') {
          const result = { jobId, resultUrl: d.resultUrl, thumbnailUrl: d.thumbnailUrl, durationSec: d.durationSec };
          const onDone = _veState.onDone;
          _veState.polling = false;
          if (_veState.objUrl) URL.revokeObjectURL(_veState.objUrl);
          document.getElementById('ve-root')?.remove();
          _veState = null;
          onDone(result);
          resolve();
        } else if (d.status === 'FAILED') {
          // Falha real reportada pelo servidor (ex.: ficheiro corrompido) —
          // repetir a verificação não ia mudar nada, propaga já.
          reject({ message: d.error || 'O processamento do vídeo falhou. Tenta um corte mais curto.' });
        } else {
          setTimeout(tick, 1500);
        }
      } catch (e) {
        // O job já está a processar no servidor — um pedido de
        // verificação falhado (rede instável) não deita tudo fora,
        // só tenta a verificação outra vez com um intervalo maior.
        // Só desiste ao fim de várias falhas seguidas.
        if (e?.networkError && consecutiveNetworkFails < MAX_CONSECUTIVE_FAILS) {
          consecutiveNetworkFails++;
          if (txt) txt.textContent = 'Ligação instável — a continuar a verificar…';
          setTimeout(tick, 2500);
          return;
        }
        reject(e);
      }
    };
    tick();
  });
}
