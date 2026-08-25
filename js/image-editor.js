/* ============================================================
   BAZARES — Editor de fotos partilhado
   Abre um editor por foto (rodar, enquadrar por proporção, filtro,
   ajustes de brilho/contraste/saturação), tudo desenhado em canvas
   no próprio browser — não depende do servidor. Reaproveitado em
   qualquer página que já tenha uma grelha de fotos (my-products,
   novoproduto, anuncio, historia): dá-se-lhe a foto (File local ou
   URL já publicada) e ele devolve, via onDone, um novo File JPEG já
   com as edições aplicadas — pronto para substituir a entrada
   correspondente na grelha existente.
============================================================ */
'use strict';

let _ieState = null;
let _ieHistory = null;

// Ronda 42 — mesmo risco do video-editor.js: `#ie-root` vive em
// `document.body`, fora do `#main` que o router substitui.
document.addEventListener('bz:spa-leave', () => {
  if (!_ieState) return;
  if (_ieState.blobUrl) URL.revokeObjectURL(_ieState.blobUrl);
  document.getElementById('ie-root')?.remove();
  _ieState = null;
  _ieHistory = null;
});

const IE_PRESETS = [
  { key: 'original', label: 'Original', grayscale: 0, sepia: 0, hue: 0, extraSat: 0,  extraCon: 0,  extraBri: 0 },
  { key: 'vivido',   label: 'Vívido',   grayscale: 0, sepia: 0, hue: 0, extraSat: 35, extraCon: 12, extraBri: 0 },
  { key: 'pb',       label: 'P&B',      grayscale: 100, sepia: 0, hue: 0, extraSat: 0,  extraCon: 6,  extraBri: 0 },
  { key: 'quente',   label: 'Quente',   grayscale: 0, sepia: 22, hue: 0, extraSat: 15, extraCon: 0,  extraBri: 4 },
  { key: 'frio',     label: 'Frio',     grayscale: 0, sepia: 0, hue: -10, extraSat: -8, extraCon: 4,  extraBri: 0 },
  { key: 'suave',    label: 'Suave',    grayscale: 0, sepia: 0, hue: 0, extraSat: -8,  extraCon: -10, extraBri: 5 }
];
const IE_MAX_OUT = 1600; // maior lado, em px — mesmo tecto usado em compressImage()

/**
 * @param {File|Blob|string} source - ficheiro local ainda não enviado, ou o URL de uma foto já publicada
 * @param {Object} opts
 * @param {Function} opts.onDone - chamado com (file) já editado, em JPEG
 * @param {Function} [opts.onCancel]
 */
function openImageEditor(source, opts) {
  const { onDone, onCancel } = opts || {};
  _ieState = {
    source, onDone, onCancel,
    img: null, blobUrl: null,
    rotation: 0, aspect: 'free', preset: 'original',
    brightness: 0, contrast: 0, saturation: 0
  };
  // Pilha de undo/redo — só cobre os campos editáveis (não img/blobUrl,
  // que não mudam durante a edição). Bazares.EditHistory vive em core.js.
  _ieHistory = Bazares.EditHistory.create(
    () => ({ rotation: _ieState.rotation, aspect: _ieState.aspect, preset: _ieState.preset,
              brightness: _ieState.brightness, contrast: _ieState.contrast, saturation: _ieState.saturation }),
    (snap) => { Object.assign(_ieState, snap); ieSyncControlsFromState(); ieRedraw(); ieUpdateHistoryButtons(); }
  );

  let root = document.getElementById('ie-root');
  if (!root) { root = document.createElement('div'); root.id = 'ie-root'; document.body.appendChild(root); }
  root.innerHTML = `
    <div class="ve-bd" id="ie-bd">
      <div class="ve-sheet">
        <div class="ve-hd"><b>Editar foto</b>
          <div style="display:flex;align-items:center;gap:2px;margin-left:auto">
            <button type="button" class="btn-icon btn-sm" id="ie-undo-btn" onclick="ieUndo()" aria-label="Desfazer" title="Desfazer">${typeof icon === 'function' ? icon('undo', 18, 2) : '↶'}</button>
            <button type="button" class="btn-icon btn-sm" id="ie-redo-btn" onclick="ieRedo()" aria-label="Refazer" title="Refazer">${typeof icon === 'function' ? icon('redo', 18, 2) : '↷'}</button>
            <button type="button" class="modal-x" onclick="cancelImageEditor()">${typeof icon === 'function' ? icon('close', 18, 2) : '✕'}</button>
          </div>
        </div>
        <div class="ve-body">
          <div class="ie-canvas-wrap" id="ie-canvas-wrap"><canvas id="ie-canvas"></canvas></div>

          <label class="ve-label">Rodar / Enquadrar</label>
          <div class="ie-row">
            <button type="button" class="ie-tool-btn" onclick="ieRotate()">⟳ Rodar</button>
            <button type="button" class="ie-aspect-btn on" data-a="free" onclick="ieSetAspect('free')">Livre</button>
            <button type="button" class="ie-aspect-btn" data-a="1:1" onclick="ieSetAspect('1:1')">1:1</button>
            <button type="button" class="ie-aspect-btn" data-a="4:5" onclick="ieSetAspect('4:5')">4:5</button>
            <button type="button" class="ie-aspect-btn" data-a="16:9" onclick="ieSetAspect('16:9')">16:9</button>
          </div>

          <label class="ve-label">Filtro</label>
          <div class="ie-swatches" id="ie-swatches"></div>

          <label class="ve-label">Ajustes</label>
          <div class="ie-slider-row"><span>Brilho</span><input type="range" id="ie-brightness" min="-60" max="60" value="0"></div>
          <div class="ie-slider-row"><span>Contraste</span><input type="range" id="ie-contrast" min="-60" max="60" value="0"></div>
          <div class="ie-slider-row"><span>Saturação</span><input type="range" id="ie-saturation" min="-100" max="100" value="0"></div>
        </div>
        <div class="ve-footer">
          <button type="button" class="btn btn-ghost" onclick="cancelImageEditor()">Cancelar</button>
          <button type="button" class="btn btn-primary" id="ie-apply-btn" onclick="applyImageEditor()">Usar esta foto</button>
        </div>
      </div>
    </div>`;

  document.getElementById('ie-swatches').innerHTML = IE_PRESETS.map(p =>
    `<button type="button" class="ie-swatch${p.key === 'original' ? ' on' : ''}" data-k="${p.key}" onclick="ieSetPreset('${p.key}')">${esc(p.label)}</button>`
  ).join('');

  ['brightness', 'contrast', 'saturation'].forEach(k => {
    const el = document.getElementById(`ie-${k}`);
    // 'input' redesenha em tempo real enquanto arrasta (sem tocar no
    // histórico — um snapshot por pixel arrastado não teria utilidade
    // nenhuma como ponto de undo). 'change' só dispara ao soltar —
    // é aí que vale a pena guardar um ponto para poder desfazer.
    el.addEventListener('input', e => {
      _ieState[k] = Number(e.target.value);
      ieRedraw();
    });
    el.addEventListener('change', () => { _ieHistory?.push(); ieUpdateHistoryButtons(); });
  });

  ieUpdateHistoryButtons();
  ieLoadSource();
}

async function ieLoadSource() {
  const st = _ieState;
  let url;
  if (typeof st.source === 'string') {
    // Foto já publicada (Cloudinary) — descarrega como blob para poder
    // desenhar em canvas e reexportar (o Cloudinary entrega com CORS
    // aberto, por isso isto funciona sem passar pelo backend).
    try {
      const res = await fetch(st.source, { mode: 'cors' });
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
    } catch (e) {
      toast('Não foi possível carregar esta foto para editar.', 'err');
      cancelImageEditor();
      return;
    }
  } else {
    url = URL.createObjectURL(st.source);
  }
  st.blobUrl = url;
  const img = new Image();
  img.onload = () => { st.img = img; ieRedraw(); };
  img.onerror = () => { toast('Não foi possível abrir esta foto.', 'err'); cancelImageEditor(); };
  img.src = url;
}

function ieFilterString(st) {
  const preset = IE_PRESETS.find(p => p.key === st.preset) || IE_PRESETS[0];
  const bri = Math.max(0, 100 + st.brightness + preset.extraBri);
  const con = Math.max(0, 100 + st.contrast + preset.extraCon);
  const sat = Math.max(0, 100 + st.saturation + preset.extraSat);
  return `brightness(${bri}%) contrast(${con}%) saturate(${sat}%) grayscale(${preset.grayscale}%) sepia(${preset.sepia}%) hue-rotate(${preset.hue}deg)`;
}

// Devolve um canvas com a imagem já rodada (sem corte nem filtro).
function ieRotatedCanvas(st) {
  const img = st.img;
  const rotated90 = st.rotation % 180 !== 0;
  const w = rotated90 ? img.naturalHeight : img.naturalWidth;
  const h = rotated90 ? img.naturalWidth : img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.rotate(st.rotation * Math.PI / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return c;
}

// Rectângulo de corte centrado, já nas dimensões pós-rotação.
function ieCropRect(st) {
  const rotated90 = st.rotation % 180 !== 0;
  const iw = rotated90 ? st.img.naturalHeight : st.img.naturalWidth;
  const ih = rotated90 ? st.img.naturalWidth : st.img.naturalHeight;
  if (st.aspect === 'free') return { x: 0, y: 0, w: iw, h: ih };
  const [aw, ah] = st.aspect.split(':').map(Number);
  const targetRatio = aw / ah;
  let w = iw, h = iw / targetRatio;
  if (h > ih) { h = ih; w = ih * targetRatio; }
  return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
}

function ieRedraw() {
  const st = _ieState;
  if (!st || !st.img) return;
  const canvas = document.getElementById('ie-canvas');
  if (!canvas) return;
  const crop = ieCropRect(st);
  const maxPreview = 340;
  const scale = Math.min(1, maxPreview / Math.max(crop.w, crop.h));
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.filter = ieFilterString(st);
  const rotCanvas = ieRotatedCanvas(st);
  ctx.drawImage(rotCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function ieRotate() {
  if (!_ieState) return;
  _ieState.rotation = (_ieState.rotation + 90) % 360;
  ieRedraw();
  _ieHistory?.push();
  ieUpdateHistoryButtons();
}
function ieSetAspect(a) {
  if (!_ieState) return;
  _ieState.aspect = a;
  document.querySelectorAll('.ie-aspect-btn').forEach(b => b.classList.toggle('on', b.dataset.a === a));
  ieRedraw();
  _ieHistory?.push();
  ieUpdateHistoryButtons();
}
function ieSetPreset(k) {
  if (!_ieState) return;
  _ieState.preset = k;
  document.querySelectorAll('.ie-swatch').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  ieRedraw();
  _ieHistory?.push();
  ieUpdateHistoryButtons();
}

// Repõe os controlos visíveis (aspecto/preset activos, sliders) a
// partir de _ieState — chamado depois de um undo()/redo(), que só
// mexe nos dados, não no DOM.
function ieSyncControlsFromState() {
  const st = _ieState;
  if (!st) return;
  document.querySelectorAll('.ie-aspect-btn').forEach(b => b.classList.toggle('on', b.dataset.a === st.aspect));
  document.querySelectorAll('.ie-swatch').forEach(b => b.classList.toggle('on', b.dataset.k === st.preset));
  ['brightness', 'contrast', 'saturation'].forEach(k => {
    const el = document.getElementById(`ie-${k}`);
    if (el) el.value = st[k];
  });
}

function ieUpdateHistoryButtons() {
  const u = document.getElementById('ie-undo-btn'), r = document.getElementById('ie-redo-btn');
  if (u) u.disabled = !_ieHistory?.canUndo();
  if (r) r.disabled = !_ieHistory?.canRedo();
}

function ieUndo() { if (_ieHistory?.undo()) toast('Desfeito.', 'info', 1200); }
function ieRedo() { if (_ieHistory?.redo()) toast('Refeito.', 'info', 1200); }

function cancelImageEditor() {
  const st = _ieState;
  if (st?.blobUrl) URL.revokeObjectURL(st.blobUrl);
  document.getElementById('ie-root')?.remove();
  const onCancel = st?.onCancel;
  _ieState = null;
  _ieHistory = null;
  if (onCancel) onCancel();
}

function applyImageEditor() {
  const st = _ieState;
  if (!st || !st.img) return;
  const btn = document.getElementById('ie-apply-btn');
  setLoading(btn, true);
  const crop = ieCropRect(st);
  const scale = Math.min(1, IE_MAX_OUT / Math.max(crop.w, crop.h));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(crop.w * scale));
  out.height = Math.max(1, Math.round(crop.h * scale));
  const ctx = out.getContext('2d');
  ctx.filter = ieFilterString(st);
  const rotCanvas = ieRotatedCanvas(st);
  ctx.drawImage(rotCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  out.toBlob(blob => {
    setLoading(btn, false);
    if (!blob) { toast('Não foi possível gerar a foto editada.', 'err'); return; }
    const file = new File([blob], 'foto-editada.jpg', { type: 'image/jpeg' });
    const onDone = st.onDone;
    if (st.blobUrl) URL.revokeObjectURL(st.blobUrl);
    document.getElementById('ie-root')?.remove();
    _ieState = null;
    _ieHistory = null;
    if (onDone) onDone(file);
  }, 'image/jpeg', 0.9);
}
