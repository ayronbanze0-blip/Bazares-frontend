/* ============================================================
   BAZARES — Core (gestores centrais)
   ------------------------------------------------------------
   Isto NÃO substitui o que já existe (Session, initPage, go(),
   toast(), o esquema de overlays/popstate) — liga-se a isso.
   Cobre só o que faltava centralizar:

     Bazares.Error       — captura erros globais, evita spam de
                            toasts repetidos, manda ao Sentry se
                            estiver activo.
     Bazares.Loading     — contador global de "há pedidos em
                            curso" (refcounted), para uma barra
                            de progresso no topo funcionar sem
                            cada página ter de gerir isso à mão.
     Bazares.RequestCache— cache curta (TTL) + deduplicação de
                            GETs idênticos em voo ao mesmo tempo.
     Bazares.Recovery    — guarda a última acção que falhou por
                            erro de rede, para um botão "Tentar
                            novamente" a poder repetir sem o
                            utilizador ter de repetir os passos.

   Carregar DEPOIS de api.js e ANTES de app.js.
============================================================ */
'use strict';

window.Bazares = window.Bazares || {};
Bazares.Utils = Bazares.Utils || {};

// ── ERROR MANAGER ───────────────────────────────────────────
// Um único ponto a apanhar erros não tratados (JS a rebentar,
// promises rejeitadas sem .catch) em qualquer página, em vez de
// cada página ter (ou não ter) o seu próprio try/catch solto.
// Evita mostrar o mesmo erro em toast repetidamente num curto
// espaço de tempo (ex.: um erro dentro de um loop de render).
Bazares.Error = (() => {
  let lastMsgAt = 0;
  let lastMsg = '';

  function report(err, context) {
    const message = err instanceof Error ? err.message : String(err?.message || err || 'Erro desconhecido');
    try {
      if (window.Sentry?.captureException) {
        window.Sentry.captureException(err instanceof Error ? err : new Error(message), {
          extra: { context: context || 'unknown' }
        });
      }
    } catch {}
    // Complementa o Sentry: um registo próprio, consultável em
    // GET /api/analytics/summary — dá para ver "esta página está a
    // gerar erros" sem precisar de abrir o dashboard do Sentry.
    try {
      Bazares.Analytics?.track('client_error', {
        message: (message || '').slice(0, 300),
        context: context || 'unknown',
        stack: (err?.stack || '').slice(0, 500)
      });
    } catch {}
  }

  function userFacingMessage(err) {
    // Erros já "de negócio" (vindos da api, com .message legível em
    // português) mostram-se tal como estão; erros de programação
    // (TypeError, etc.) não devem aparecer crus ao utilizador.
    if (err && typeof err.message === 'string' && err.ok === false) return err.message;
    return 'Algo correu mal. Já estamos a par — tente novamente.';
  }

  function notify(err, context) {
    const msg = userFacingMessage(err);
    const now = Date.now();
    if (msg === lastMsg && (now - lastMsgAt) < 4000) return; // já mostrado agora mesmo — não repetir
    lastMsg = msg; lastMsgAt = now;
    if (typeof toast === 'function') toast(msg, 'err');
    report(err, context);
  }

  window.addEventListener('error', (ev) => {
    // Erros de <img>/<script> a falhar a carregar disparam 'error' mas
    // não são bugs de JS — ignora-os aqui (têm o seu próprio fallback).
    if (ev.target && ev.target !== window) return;
    report(ev.error || ev.message, 'window.onerror');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    report(ev.reason, 'unhandledrejection');
  });

  // Liga o utilizador autenticado ao Sentry (login/logout/bootstrap —
  // ver Bazares.State em runtime.js) — sem isto, cada erro aparece no
  // Sentry como "utilizador desconhecido" e não dá para saber quantas
  // PESSOAS diferentes estão a ser afectadas pelo mesmo problema, só
  // quantas VEZES aconteceu.
  document.addEventListener('bazares:state:user', (ev) => {
    try {
      const user = ev.detail?.value;
      if (user?.id) window.Sentry?.setUser?.({ id: user.id, username: user.name || undefined });
      else window.Sentry?.setUser?.(null);
    } catch {}
  });

  return { notify, report };
})();

// ── CONNECTIVITY MANAGER ────────────────────────────────────
// Bazares.Connectivity = (() => {
  let isOnline = navigator.onLine;
  const listeners = new Set();

  function setState(next) {
    if (next === isOnline) return;

    isOnline = next;

    if (window.Bazares?.State) {
      Bazares.State.set('online', isOnline);
    }

    listeners.forEach(fn => {
      try {
        fn(isOnline);
      } catch {}
    });

    if (typeof toast === 'function') {
      if (!isOnline) {
        toast(
          'Sem ligação à internet. A app voltará a funcionar quando a ligação regressar.',
          'warn',
          6000
        );
      } else {
        toast('Ligação à internet recuperada.', 'ok', 2500);
      }
    }
  }

  function checkNow() {
    setState(navigator.onLine);
    return isOnline;
  }

  window.addEventListener('online', () => setState(true));
  window.addEventListener('offline', () => setState(false));

  return {
    checkNow,
    isOnline: () => isOnline,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
})();
// ── LOADING MANAGER ─────────────────────────────────────────
// Contador global (refcounted): várias chamadas em simultâneo não
// fazem a barra "acabar" antes de tempo — só desaparece quando a
// última pendente terminar. Dispara um evento; quem quiser mostrar
// uma barra de progresso no topo só precisa de ouvir 'bazares:loading'.
Bazares.Loading = (() => {
  let count = 0;
  function emit() {
    document.dispatchEvent(new CustomEvent('bazares:loading', { detail: { active: count > 0, count } }));
  }
  function start() { count++; emit(); }
  function stop() { count = Math.max(0, count - 1); emit(); }
  function isActive() { return count > 0; }
  return { start, stop, isActive };
})();

// Barra fina no topo do ecrã, sem cada página ter de a desenhar —
// aparece sempre que há pelo menos um pedido de rede em curso.
(function initLoadingBar() {
  let bar;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'bz-loading-bar';
    bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;width:0;background:var(--g-green,#16A34A);z-index:99999;transition:width .3s ease,opacity .3s ease;opacity:0;pointer-events:none';
    document.body.appendChild(bar);
    return bar;
  }
  document.addEventListener('bazares:loading', (ev) => {
    const b = ensureBar();
    if (ev.detail.active) { b.style.opacity = '1'; b.style.width = '70%'; }
    else { b.style.width = '100%'; setTimeout(() => { b.style.opacity = '0'; b.style.width = '0'; }, 250); }
  });
})();

// memoize: guarda o resultado de uma função pura por argumento — só
// vale a pena para funções chamadas muitas vezes com os MESMOS
// argumentos repetidos (ex.: formatar o mesmo preço em dezenas de
// cartões do feed) e cujo resultado nunca muda para o mesmo input.
// NUNCA usar em funções que dependem de algo além dos argumentos
// (Date.now(), Math.random(), estado externo) — ficaria "presa" no
// primeiro resultado calculado. `maxSize` evita crescer sem limite:
// ao chegar ao topo, limpa tudo de uma vez (mais simples que um LRU
// real, e suficiente aqui — o padrão de chamadas repete muito pouco
// depois de "aquecer" a cache num ecrã).
Bazares.Utils.memoize = function memoize(fn, { maxSize = 500 } = {}) {
  const cache = new Map();
  const memoized = function (...args) {
    const key = args.length === 1 ? String(args[0]) : JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    if (cache.size >= maxSize) cache.clear();
    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };
  memoized.clear = () => cache.clear();
  return memoized;
};

// loadScriptOnce: injecta um <script src> só quando é mesmo preciso
// (ex.: maps.js/MapLibre só ao clicar em "ordenar por distância", em
// vez de em todas as visitas a products.html) — devolve sempre a
// MESMA promise para o mesmo src, por isso é seguro chamar várias
// vezes seguidas (ex.: cliques repetidos) sem duplicar o <script>.
Bazares.Utils.loadScriptOnce = (function () {
  const inflight = new Map();
  return function loadScriptOnce(src) {
    if (inflight.has(src)) return inflight.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { inflight.delete(src); reject(new Error('falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
    inflight.set(src, p);
    return p;
  };
})();


// Dois pedidos GET idênticos disparados quase ao mesmo tempo (ex.:
// dois componentes da mesma página a pedir os mesmos dados) partilham
// uma única chamada de rede em vez de duas. Cache curta opcional por
// cima disso, para dados que não mudam a cada segundo (ex.: categorias).
Bazares.RequestCache = (() => {
  const inFlight = new Map();   // key -> Promise
  const cache = new Map();      // key -> { data, expiresAt }

  function key(method, path, params) {
    return method + ' ' + path + (params ? '?' + new URLSearchParams(params).toString() : '');
  }

  // ttlMs = 0 desliga a cache (só faz a deduplicação de pedidos em voo)
  async function dedupedGet(path, params, fetcher, ttlMs = 0) {
    const k = key('GET', path, params);
    const hit = cache.get(k);
    if (hit && hit.expiresAt > Date.now()) return hit.data;

    if (inFlight.has(k)) return inFlight.get(k);

    const p = fetcher().then((data) => {
      inFlight.delete(k);
      if (ttlMs > 0) cache.set(k, { data, expiresAt: Date.now() + ttlMs });
      return data;
    }).catch((err) => { inFlight.delete(k); throw err; });

    inFlight.set(k, p);
    return p;
  }

  function invalidate(pathPrefix) {
    for (const k of cache.keys()) if (!pathPrefix || k.includes(pathPrefix)) cache.delete(k);
  }

  return { dedupedGet, invalidate };
})();

// ── RECOVERY MANAGER ────────────────────────────────────────
// Guarda a última acção que falhou por erro de REDE (não erro de
// validação — não faz sentido "tentar de novo" um pedido inválido
// sem o utilizador mudar algo). Mostra um toast com botão "Tentar
// novamente" que repete exactamente a mesma chamada.
Bazares.Recovery = (() => {
  let lastAction = null; // { fn, label }

  async function attempt(fn, label = 'a acção') {
    try {
      const res = await fn();
      lastAction = null;
      return res;
    } catch (err) {
      if (err?.networkError) {
        lastAction = { fn, label };
        showRetryToast(label);
      }
      throw err;
    }
  }

  function showRetryToast(label) {
    let root = document.getElementById('toast-root');
    if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
    const el = document.createElement('div');
    el.className = 'toast t-warn toast-el';
    el.innerHTML = `<span class="t-msg">Não foi possível ${esc(label)}.</span>
      <button type="button" style="margin-left:8px;font-weight:700;text-decoration:underline;background:none;border:none;color:inherit" id="bz-retry-btn">Tentar novamente</button>`;
    root.appendChild(el);
    const btn = el.querySelector('#bz-retry-btn');
    btn.onclick = async () => {
      el.remove();
      if (lastAction) await attempt(lastAction.fn, lastAction.label);
    };
    setTimeout(() => el.remove(), 8000);
  }

  return { attempt };
})();

// ── BREADCRUMBS ─────────────────────────────────────────────
// Equivalente MPA de breadcrumbs de SPA: cada página conhece o seu
// "pai" lógico na árvore do site (não a página anterior no histórico
// do browser, que pode ser qualquer coisa). Zero-touch — não precisa
// de tocar em nenhum dos ficheiros .html: injecta-se sozinha dentro
// de #main assim que initPage() corre.
//
// Páginas que mostram uma entidade concreta (produto, loja,
// categoria, encomenda, anúncio) arrancam com uma etiqueta genérica
// ("Produto") e podem, opcionalmente, chamar
// Bazares.Breadcrumbs.setLast('Nome real') assim que os dados
// chegarem da API, para trocar só o último item pelo nome real —
// isto é opcional, sem isso a breadcrumb funciona à mesma.
//
// Carregar DEPOIS de api.js e ANTES de app.js (usa esc()/go(), que
// só existem em runtime — são chamados só dentro de render(), nunca
// no carregamento do próprio ficheiro).
Bazares.Breadcrumbs = (() => {
  // Páginas "raiz" — mesmas do topbar (TB_ROOT_PAGES em app.js) mais
  // o fluxo de autenticação e o visualizador de stories (imersivo,
  // não é uma página de navegação normal).
  const HIDDEN = new Set([
    'index.html', 'home.html', 'explorar.html', 'chat.html', 'profile.html',
    'login.html', 'register.html', 'forgot-password.html', 'verify-email.html',
    'historia.html'
  ]);

  const TREE = {
    'products.html':          { label: 'Produtos',                parent: 'home.html' },
    'product.html':           { label: 'Produto',                 parent: 'products.html' },
    'category.html':          { label: 'Categoria',                parent: 'products.html' },
    'bazars.html':            { label: 'Lojas',                    parent: 'home.html' },
    'bazar.html':              { label: 'Loja',                     parent: 'bazars.html' },
    'cart.html':               { label: 'Carrinho',                 parent: 'home.html' },
    'checkout.html':           { label: 'Finalizar compra',         parent: 'cart.html' },
    'my-orders.html':          { label: 'Minhas encomendas',        parent: 'profile.html' },
    'order-detail.html':       { label: 'Encomenda',                parent: 'my-orders.html' },
    'wallet.html':             { label: 'Carteira',                 parent: 'profile.html' },
    'wallet-history.html':     { label: 'Histórico',                parent: 'wallet.html' },
    'favorites.html':          { label: 'Favoritos',                parent: 'profile.html' },
    'notifications.html':      { label: 'Notificações',             parent: 'home.html' },
    'settings.html':           { label: 'Definições',               parent: 'profile.html' },
    'dashboard.html':          { label: 'Painel',                   parent: 'home.html' },
    'my-products.html':        { label: 'Meus produtos',            parent: 'dashboard.html' },
    'novoproduto.html':        { label: 'Novo produto',             parent: 'my-products.html' },
    'my-bazar.html':           { label: 'Minha loja',               parent: 'dashboard.html' },
    'finance.html':            { label: 'Finanças',                 parent: 'dashboard.html' },
    'premium.html':            { label: 'Premium',                  parent: 'profile.html' },
    'referrals.html':          { label: 'Indicações',               parent: 'profile.html' },
    'ranking.html':            { label: 'Ranking',                  parent: 'home.html' },
    'reels.html':              { label: 'Reels',                    parent: 'home.html' },
    'newreels.html':           { label: 'Nova reel',                parent: 'reels.html' },
    'meufeed.html':            { label: 'Meu feed',                 parent: 'profile.html' },
    'anuncios.html':           { label: 'Anúncios',                 parent: 'home.html' },
    'anuncio.html':            { label: 'Anúncio',                  parent: 'anuncios.html' },
    'search.html':             { label: 'Pesquisa',                 parent: 'home.html' },
    'support.html':            { label: 'Suporte',                  parent: 'profile.html' },
    'seller-guidelines.html':  { label: 'Regras para vendedores',   parent: 'support.html' },
    'terms.html':              { label: 'Termos de uso',            parent: 'support.html' },
    'privacy.html':            { label: 'Privacidade',              parent: 'support.html' },
    'refund-policy.html':      { label: 'Política de reembolso',    parent: 'support.html' },
    'admin.html':              { label: 'Admin',                    parent: 'home.html' },
    'admin-orders.html':       { label: 'Encomendas',               parent: 'admin.html' },
    'admin-products.html':     { label: 'Produtos',                 parent: 'admin.html' },
    'admin-premium.html':      { label: 'Premium',                  parent: 'admin.html' },
    'admin-logs.html':         { label: 'Logs',                     parent: 'admin.html' },
    'admin-finance.html':      { label: 'Finanças',                 parent: 'admin.html' },
    'admin-wallet.html':       { label: 'Carteira',                 parent: 'admin.html' },
    'admin-broadcast.html':    { label: 'Broadcast',                parent: 'admin.html' },
    'admin-denuncias.html':    { label: 'Denúncias',                parent: 'admin.html' },
    'admin-reports.html':      { label: 'Relatórios',               parent: 'admin.html' },
    'admin-users.html':        { label: 'Utilizadores',             parent: 'admin.html' }
  };

  const HOME_LABEL = 'Início';
  let lastOverride = null; // { label } — só preenchido se a página chamar setLast()

  function currentPage() {
    return location.pathname.split('/').pop() || 'index.html';
  }

  function buildTrail(page) {
    const trail = [];
    let node = page;
    let guard = 0; // protecção contra ciclo mal configurado na TREE
    while (node && TREE[node] && guard++ < 12) {
      trail.unshift({ label: TREE[node].label, href: node });
      node = TREE[node].parent;
    }
    if (trail.length && trail[0].href !== 'home.html') {
      trail.unshift({ label: HOME_LABEL, href: 'home.html' });
    }
    return trail;
  }

  function render() {
    const page = currentPage();
    const main = document.getElementById('main');
    let nav = document.getElementById('bz-crumbs');
    if (!main) return;

    if (HIDDEN.has(page) || !TREE[page]) {
      if (nav) nav.remove();
      lastOverride = null;
      return;
    }

    const trail = buildTrail(page);
    if (trail.length < 2) { if (nav) nav.remove(); return; }

    const lastIdx = trail.length - 1;
    const html = trail.map((c, i) => {
      const isLast = i === lastIdx;
      const label = esc(isLast && lastOverride ? lastOverride.label : c.label);
      if (isLast) return `<span class="bz-crumb-current" aria-current="page">${label}</span>`;
      return `<a class="bz-crumb-link" href="${c.href}" onclick="return _bzCrumbNav(event,'${c.href}')">${label}</a>`;
    }).join('<span class="bz-crumb-sep" aria-hidden="true">/</span>');

    if (!nav) {
      nav = document.createElement('nav');
      nav.id = 'bz-crumbs';
      nav.className = 'bz-crumbs';
      nav.setAttribute('aria-label', 'Localização');
      main.insertBefore(nav, main.firstChild);
    }
    nav.innerHTML = html;
  }

  // Chamado opcionalmente por páginas de entidade (produto, loja,
  // categoria, encomenda, anúncio) assim que o nome real chega da
  // API, para trocar a etiqueta genérica pelo nome real.
  function setLast(label) {
    lastOverride = label ? { label } : null;
    render();
  }

  return { render, setLast, currentPage };
})();

// Breadcrumb usa go() (definido em app.js) em vez de deixar o <a>
// navegar normalmente, para manter a mesma lógica central de
// navegação (transição suave, etc.) que o resto da app usa.
function _bzCrumbNav(ev, page) {
  ev.preventDefault();
  go(page);
  return false;
}

// ── DEBOUNCE / THROTTLE ─────────────────────────────────────
// Utilitário genérico único — antes disto cada ficheiro (app.js,
// maps.js, mentions.js) reimplementava o seu próprio
// clearTimeout/setTimeout à mão, cada um com um comportamento
// ligeiramente diferente. Agora é uma só implementação testada,
// usada em qualquer sítio que precise de atrasar chamadas (busca
// em tempo real, scroll, resize, etc.).

// debounce: só corre depois de `wait` ms sem nova chamada — ideal
// para "espera que a pessoa pare de escrever" (busca, autocomplete).
// options.immediate: corre logo na primeira chamada, e só volta a
// poder correr depois de `wait` ms de silêncio (útil para botões).
Bazares.Utils.debounce = function debounce(fn, wait = 300, options = {}) {
  let timer = null;
  const debounced = function (...args) {
    const callNow = options.immediate && !timer;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!options.immediate) fn.apply(this, args);
    }, wait);
    if (callNow) fn.apply(this, args);
  };
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  return debounced;
};

// throttle: corre no máximo uma vez a cada `wait` ms, mesmo com
// chamadas contínuas — ideal para scroll/resize/drag, onde
// debounce deixaria a UI "presa" à espera do fim do gesto.
// Garante sempre uma chamada final (trailing) com os últimos args.
Bazares.Utils.throttle = function throttle(fn, wait = 200) {
  let last = 0;
  let timer = null;
  let lastArgs = null;
  const throttled = function (...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    lastArgs = args;
    if (remaining <= 0) {
      clearTimeout(timer); timer = null;
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, lastArgs);
      }, remaining);
    }
  };
  throttled.cancel = () => { clearTimeout(timer); timer = null; };
  return throttled;
};

// ── UNDO MANAGER ────────────────────────────────────────────
// Padrão "eliminar já, mas dá para desfazer" (como o Gmail): a UI
// remove o item imediatamente (sensação instantânea), e só ao fim
// de `timeout` ms é que o pedido de eliminação real é enviado ao
// servidor. Se a pessoa clicar "Desfazer" antes disso, o pedido ao
// servidor NUNCA chega a sair — mais seguro e mais rápido do que um
// modal de confirmação a bloquear o fluxo.
//
// Uso típico:
//   const row = document.getElementById('item-123');
//   row.style.display = 'none';               // 1. esconde já
//   Bazares.Undo.perform({
//     message: 'Produto eliminado.',
//     onUndo:   () => { row.style.display = ''; },      // desfez — mostra outra vez
//     onCommit: async () => { await api.delete('/products/123'); } // confirmou (silêncio) — apaga a sério
//   });
Bazares.Undo = (() => {
  function perform({ message, onUndo, onCommit, timeout = 5000 }) {
    let settled = false;
    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      try { await onCommit?.(); }
      catch (e) {
        // Falhou a apagar a sério — repõe a UI e avisa, para não ficar
        // "meio apagado" (escondido no ecrã mas ainda vivo no servidor).
        onUndo?.();
        toast(typeof apiErrorMessage === 'function' ? apiErrorMessage(e) : 'Não foi possível concluir a acção.', 'err');
      }
    }, timeout);

    showToast(message, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onUndo?.();
    }, timeout);
  }

  function showToast(message, onClickUndo, timeout) {
    let root = document.getElementById('toast-root');
    if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
    const el = document.createElement('div');
    el.className = 'toast t-info toast-el bz-undo-toast';
    el.innerHTML = `<span class="t-msg">${esc(message)}</span>
      <button type="button" class="bz-undo-btn">Desfazer</button>`;
    root.appendChild(el);
    let clicked = false;
    el.querySelector('.bz-undo-btn').onclick = () => {
      if (clicked) return;
      clicked = true;
      el.remove();
      onClickUndo();
    };
    setTimeout(() => { if (!clicked) el.remove(); }, timeout + 300);
  }

  return { perform };
})();

// ── EDIT HISTORY (Undo/Redo genérico) ───────────────────────
// Diferente do Bazares.Undo acima (que é "eliminei já, mas ainda dá
// para cancelar antes de confirmar no servidor" — um caso muito
// específico, sem Redo com sentido: depois de confirmado no
// servidor não há nada para desfazer). Isto é o padrão clássico de
// editor: uma pilha de snapshots do estado, para voltar atrás/à
// frente livremente enquanto se edita ALGO LOCAL (ainda não
// enviado) — ex.: o editor de fotos (rotação/enquadramento/filtro/
// ajustes).
//
// Uso típico:
//   const hist = Bazares.EditHistory.create(
//     () => ({...st}),           // getState — devolve uma cópia do estado actual
//     (s) => { Object.assign(st, s); redraw(); } // setState — aplica um snapshot
//   );
//   hist.push();       // chamar depois de CADA mudança confirmada (ex.: soltar o slider)
//   hist.undo();        // volta ao snapshot anterior
//   hist.redo();        // avança outra vez, se tiver havido undo()
//   hist.canUndo() / hist.canRedo()  // para activar/desactivar os botões ↶ ↷
Bazares.EditHistory = (() => {
  function create(getState, setState, opts = {}) {
    const limit = opts.limit || 30;
    let stack = [getState()];
    let index = 0; // posição actual dentro de stack

    function push() {
      const snapshot = getState();
      // corta qualquer "futuro" (redos) que ainda existisse — editar
      // depois de um undo() abre um novo ramo, como em qualquer editor
      stack = stack.slice(0, index + 1);
      stack.push(snapshot);
      if (stack.length > limit) stack.shift(); else index++;
    }

    function undo() {
      if (index <= 0) return false;
      index--;
      setState(stack[index]);
      return true;
    }

    function redo() {
      if (index >= stack.length - 1) return false;
      index++;
      setState(stack[index]);
      return true;
    }

    function canUndo() { return index > 0; }
    function canRedo() { return index < stack.length - 1; }

    // Reinicia a pilha (ex.: ao abrir uma foto nova no mesmo editor,
    // sem fechar/reabrir o componente).
    function reset() { stack = [getState()]; index = 0; }

    return { push, undo, redo, canUndo, canRedo, reset };
  }

  return { create };
})();
