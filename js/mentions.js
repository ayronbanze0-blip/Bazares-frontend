/* ============================================================
   BAZARES — Autocomplete de menções (@utilizador)
   Liga qualquer <input>/<textarea> a GET /api/users/search/mentions.
   O backend já sincroniza menções (Fase 2) em comentários e
   anúncios via mentionService — isto é só o lado do frontend que
   fazia falta: sugerir handles enquanto o utilizador escreve "@".
============================================================ */
'use strict';

let _mnActiveEl = null;
let _mnResults = [];
let _mnActiveIdx = -1;

/**
 * Liga o autocomplete de menções a um <input> ou <textarea>.
 * Precisa que o elemento esteja dentro de um contentor com
 * position:relative (ou envolve-o automaticamente com .mn-wrap
 * se `wrap` !== false).
 */
function attachMentionAutocomplete(el, { wrap = true } = {}) {
  if (!el || el._mnAttached) return;
  el._mnAttached = true;

  if (wrap && el.parentElement && !el.parentElement.classList.contains('mn-wrap')) {
    const w = document.createElement('div');
    w.className = 'mn-wrap';
    el.parentElement.insertBefore(w, el);
    w.appendChild(el);
  }

  el.addEventListener('input', () => onMentionInput(el));
  el.addEventListener('keydown', e => onMentionKeydown(el, e));
  el.addEventListener('blur', () => setTimeout(closeMentionList, 150)); // delay para o clique no item registar primeiro
}

function currentMentionQuery(el) {
  const pos = el.selectionStart ?? el.value.length;
  const upToCursor = el.value.slice(0, pos);
  const m = upToCursor.match(/(^|[\s])@([a-z0-9_.]{0,30})$/i);
  return m ? m[2] : null;
}

function onMentionInput(el) {
  const q = currentMentionQuery(el);
  if (q === null) { closeMentionList(); return; }
  _mnActiveEl = el;
  _mnSearchDebounced.cancel();
  if (q.length === 0) { closeMentionList(); return; }
  _mnSearchDebounced(el, q);
}

const _mnSearchDebounced = Bazares.Utils.debounce(async (el, q) => {
  try {
    const r = await api.get('/users/search/mentions', { q });
    if (_mnActiveEl !== el) return; // utilizador já mudou de campo
    _mnResults = r?.data?.users || [];
    _mnActiveIdx = _mnResults.length ? 0 : -1;
    renderMentionList(el);
  } catch { closeMentionList(); }
}, 220);

function renderMentionList(el) {
  let list = el.parentElement.querySelector('.mn-list');
  if (!_mnResults.length) { closeMentionList(); return; }
  if (!list) {
    list = document.createElement('div');
    list.className = 'mn-list';
    el.parentElement.appendChild(list);
  }
  list.innerHTML = _mnResults.map((u, i) => `
    <div class="mn-item${i === _mnActiveIdx ? ' active' : ''}" onmousedown="event.preventDefault();pickMention(${i})">
      ${avatar(u.name, 26, u.avatarUrl || null)}
      <div><b>${esc(u.name)}</b><br><span>@${esc(u.username)}</span></div>
    </div>`).join('');
}

function onMentionKeydown(el, e) {
  if (!_mnResults.length || !document.querySelector('.mn-list')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); _mnActiveIdx = Math.min(_mnActiveIdx + 1, _mnResults.length - 1); renderMentionList(el); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _mnActiveIdx = Math.max(_mnActiveIdx - 1, 0); renderMentionList(el); }
  else if (e.key === 'Enter' || e.key === 'Tab') { if (_mnActiveIdx >= 0) { e.preventDefault(); pickMention(_mnActiveIdx); } }
  else if (e.key === 'Escape') { closeMentionList(); }
}

function pickMention(i) {
  const el = _mnActiveEl;
  const u = _mnResults[i];
  if (!el || !u) return;
  const pos = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, pos);
  const after = el.value.slice(pos);
  const newBefore = before.replace(/(^|[\s])@([a-z0-9_.]{0,30})$/i, `$1@${u.username} `);
  el.value = newBefore + after;
  const newPos = newBefore.length;
  el.focus();
  el.setSelectionRange(newPos, newPos);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  closeMentionList();
}

function closeMentionList() {
  document.querySelectorAll('.mn-list').forEach(l => l.remove());
  _mnResults = [];
  _mnActiveIdx = -1;
}

/**
 * Devolve `text` já escapado (esc()) com "@username" e "#hashtag"
 * realçados — usar em vez de esc() simples ao renderizar
 * comentários/anúncios.
 */
function escWithMentions(text) {
  const escaped = esc(text || '');
  return escaped
    .replace(/(^|[\s])@([a-z0-9_.]{2,30})/gi, `$1<span class="mn-highlight">@$2</span>`)
    .replace(/(^|[\s])#([a-zA-Z0-9_À-ÿ]{2,40})/g, `$1<span class="mn-hashtag">#$2</span>`);
}

// ─── Etiquetas rápidas de anúncio ("Promoção", "Novidade"...) ────────
// anuncio.html guarda-as como prefixo "[Promoção · Novidade]\n" dentro
// do próprio texto do anúncio. parseQuickTags() separa esse prefixo do
// resto do texto para poder mostrar as etiquetas como selos com ícone
// por baixo do nome da loja, em vez de aparecerem entre parênteses
// rectos dentro do parágrafo. Funciona também nos anúncios antigos já
// publicados (não precisa de alterar nada no backend).
const QUICK_TAG_STYLES = {
  'Promoção':          { ic: 'percent',  bg: 'var(--a-100)', fg: 'var(--a-600)' },
  'Novidade':          { ic: 'sparkle',  bg: 'var(--b-50)',  fg: 'var(--b-700)' },
  'Stock disponível':  { ic: 'box',      bg: 'var(--c-100)', fg: 'var(--c-600)' },
  'Evento':            { ic: 'calendar', bg: '#EAE6FF',      fg: '#5B3FD6' },
};
const QUICK_TAG_DEFAULT_STYLE = { ic: 'tag', bg: 'var(--g-100)', fg: 'var(--g-600)' };

function parseQuickTags(rawText) {
  const m = /^\[([^\]]+)\]\n?/.exec(rawText || '');
  if (!m) return { tags: [], text: rawText || '' };
  const tags = m[1].split('·').map(s => s.trim()).filter(Boolean);
  return { tags, text: (rawText || '').slice(m[0].length) };
}

function quickTagBadgesHtml(tags) {
  if (!tags || !tags.length) return '';
  return `<div class="fc-tag-badges">${tags.map(t => {
    const st = QUICK_TAG_STYLES[t] || QUICK_TAG_DEFAULT_STYLE;
    return `<span class="fc-tag-badge" style="background:${st.bg};color:${st.fg}">${icon(st.ic, 12, 2.2)}${esc(t)}</span>`;
  }).join('')}</div>`;
}
