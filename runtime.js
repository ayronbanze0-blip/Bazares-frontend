/* ============================================================
   BAZARES — Runtime (Fase 3.1: Global App State, Route Guard,
   Navigation Manager, History Manager)
   ------------------------------------------------------------
   Não substitui nada do que já existe (Session, go()/goBack(),
   initPage(), BazaresRouter, o esquema de overlays/popstate) —
   dá-lhes uma camada comum por cima:

     Bazares.State      — Estado global observável (chave/valor +
                           subscribe), ponte automática com
                           Session (utilizador) e Bazares.Connectivity
                           (online/offline), para qualquer página
                           poder reagir sem sondar (polling).

     Bazares.RouteGuard — A MESMA lógica de requireAuth/roles/
                           guestOnly que já existia dentro de
                           initPage(), agora num único sítio
                           reutilizável — por initPage() (carga
                           normal) E por BazaresRouter (navegação
                           SPA, ANTES de trocar o #main, para nunca
                           mostrar conteúdo restrito nem por um
                           instante).

     Bazares.Nav        — API única para navegação: envolve go()/
                           goBack()/BazaresRouter.navigate(), mantém
                           o "route" actual e dispara um evento
                           'bazares:nav:change' sempre que muda
                           (recarregamento completo OU troca SPA),
                           para quem precisar de reagir (analytics,
                           fechar sidebar, etc.) sem ter de saber
                           qual dos dois mecanismos foi usado.

     Bazares.History    — Formaliza o registo de "coisas que o
                           botão/gesto voltar deve fechar antes de
                           sair da página" (modal, lightbox, story
                           viewer, etc.). O comportamento é
                           EXACTAMENTE o mesmo de sempre
                           (_bzOpenOverlay/_bzConsumeOverlayGuard em
                           app.js) — só passa a ser possível registar
                           um overlay novo com uma linha, em vez de
                           acrescentar mais um `if` a
                           closeTopmostOverlay().

   Carregar DEPOIS de core.js e ANTES de spa-router.js e app.js
   (todas as páginas — MPA e SPA — mesma ordem de sempre).
   ============================================================ */
'use strict';

window.Bazares = window.Bazares || {};

// ── GLOBAL APP STATE (com persistência + sincronização) ──────
// Loja chave/valor em memória, com duas capacidades opcionais por
// chave (nenhuma delas é o comportamento por omissão — set()/get()
// simples continuam a funcionar exactamente como antes):
//
//   Bazares.State.persist('chave')  — grava em localStorage a cada
//     set() e hidrata sozinho a partir daí no arranque da página
//     (chamar isto ANTES de qualquer set() dessa chave, tipicamente
//     logo a seguir a este IIFE). Usado para o que deve sobreviver
//     a fechar/recarregar a página (ex.: filtros escolhidos).
//
//   Bazares.State.sync('chave')     — além de persist(), propaga
//     mudanças da chave para OUTROS separadores/abas abertos da app
//     (reaproveita o evento nativo 'storage', que só dispara nas
//     abas QUE NÃO fizeram a mudança — sem risco de eco/loop). É o
//     mesmo mecanismo que já existia só para a sessão (ver
//     Session._bc/BroadcastChannel em app.js), agora disponível
//     para qualquer chave sem cada caso ter de reimplementar isto.
Bazares.State = (() => {
  const PREFIX = 'bzstate:';
  const store = new Map();
  const listeners = new Map();   // chave -> Set(fn)
  const wildcard = new Set();    // fn(key, value, prev) — ouve tudo
  const persistedKeys = new Set();
  const syncedKeys = new Set();

  function loadPersisted(key) {
    try { const raw = localStorage.getItem(PREFIX + key); return raw === null ? undefined : JSON.parse(raw); }
    catch (e) { return undefined; }
  }
  function savePersisted(key, value) {
    try {
      if (value === undefined) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) { /* quota cheia ou modo privado — falha em silêncio, fica só em memória */ }
  }

  function get(key) { return store.get(key); }
  function getAll() { return Object.fromEntries(store); }

  function set(key, value, opts = {}) {
    const prev = store.get(key);
    if (prev === value) return; // mesmo valor — não dispara nada à toa
    store.set(key, value);
    if (persistedKeys.has(key) && !opts._fromHydration) savePersisted(key, value);
    (listeners.get(key) || []).forEach((fn) => { try { fn(value, prev); } catch (e) {} });
    wildcard.forEach((fn) => { try { fn(key, value, prev); } catch (e) {} });
    document.dispatchEvent(new CustomEvent('bazares:state:' + key, { detail: { value, prev } }));
  }

  // Atalho para actualizar várias chaves de uma vez (ex.: depois de login).
  function patch(obj) { Object.keys(obj).forEach((k) => set(k, obj[k])); }

  // subscribe('user', fn) — só essa chave. subscribe(fn) — todas.
  function subscribe(key, fn) {
    if (typeof key === 'function') { wildcard.add(key); return () => wildcard.delete(key); }
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key) && listeners.get(key).delete(fn);
  }

  // Marca `key` como persistente e hidrata-a já a partir do
  // localStorage, se houver algo guardado e a chave ainda não tiver
  // sido definida nesta carga da página (um set() explícito feito
  // antes de chamar persist() ganha sempre ao valor gravado).
  function persist(key) {
    if (persistedKeys.has(key)) return;
    persistedKeys.add(key);
    if (!store.has(key)) {
      const saved = loadPersisted(key);
      if (saved !== undefined) set(key, saved, { _fromHydration: true });
    }
  }

  // Marca `key` como sincronizada entre separadores (implica persist()
  // — a sincronização usa o mesmo par localStorage+evento 'storage').
  function sync(key) {
    syncedKeys.add(key);
    persist(key);
  }

  // Outra aba mudou uma chave persistida+sincronizada — aplica aqui
  // sem voltar a gravar (já está gravado, foi de lá que veio).
  window.addEventListener('storage', (ev) => {
    if (!ev.key || ev.key.indexOf(PREFIX) !== 0) return;
    const key = ev.key.slice(PREFIX.length);
    if (!syncedKeys.has(key)) return;
    if (ev.newValue === null) { store.delete(key); return; }
    try { set(key, JSON.parse(ev.newValue), { _fromHydration: true }); } catch (e) {}
  });

  return { get, getAll, set, patch, subscribe, persist, sync };
})();

// ── EVENT BUS ────────────────────────────────────────────────
// Nome próprio para um padrão que já existia espalhado (document.
// dispatchEvent/addEventListener com CustomEvent, prefixo 'bazares:')
// — Bazares.State e Bazares.Nav já o usavam por baixo, cada um com a
// sua própria chamada directa a dispatchEvent. Isto não troca nada
// do que já funciona (os nomes de evento continuam iguais, ex.:
// 'bazares:state:user'), só dá uma API mais curta para código NOVO
// que precise de emitir/ouvir um evento próprio da app sem ter de
// escrever `new CustomEvent(...)` à mão em cada sítio.
Bazares.Events = (() => {
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent('bazares:' + name, { detail }));
  }
  // on('nav:change', fn) — fn recebe directamente o `detail` (não o
  // evento inteiro). Devolve uma função para deixar de ouvir.
  function on(name, fn) {
    const handler = (ev) => fn(ev.detail);
    document.addEventListener('bazares:' + name, handler);
    return () => document.removeEventListener('bazares:' + name, handler);
  }
  // Ouve só a próxima ocorrência, depois desliga-se sozinho.
  function once(name, fn) {
    const off = on(name, (detail) => { off(); fn(detail); });
    return off;
  }
  return { emit, on, once };
})();

// ── LOCAL STATE ──────────────────────────────────────────────
// Contraparte "pequena" do Bazares.State: uma instância isolada,
// não-global, não-persistida — nasce e morre com a página/controller
// que a criou. Para estado que só interessa a UM ecrã (ex.: qual
// separador está activo, o item em edição num formulário) e que não
// faz sentido poluir a loja global nem sobreviver a um recarregar.
// Uso: const s = Bazares.createLocalState({tab:'fotos'});
//      s.subscribe((state,prev) => { ... });
//      s.set({tab:'video'});
function bzCreateLocalState(initial) {
  let state = Object.assign({}, initial || {});
  const listeners = new Set();
  function get(key) { return key === undefined ? Object.assign({}, state) : state[key]; }
  function set(patchObj) {
    const prev = state;
    state = Object.assign({}, state, patchObj);
    listeners.forEach((fn) => { try { fn(state, prev); } catch (e) {} });
  }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  return { get, set, subscribe };
}
Bazares.createLocalState = bzCreateLocalState;

// ── CACHE MANAGER (persistente) ─────────────────────────────
// Diferente do Bazares.RequestCache (core.js — em memória, morre ao
// sair da página, serve sobretudo para deduplicar pedidos em voo ao
// mesmo tempo): isto sobrevive a recarregar a página ou fechar a app,
// porque vive em localStorage. Usado por api.js para os poucos GETs
// explicitamente marcados como "lentos a mudar" (ver CACHEABLE_GET em
// api.js) — nenhuma página precisa de mudar nada para beneficiar.
// VERSION: subir este número invalida TODA a cache persistente de
// uma vez (útil se o formato de alguma resposta da API mudar).
Bazares.Cache = (() => {
  const PREFIX = 'bzcache:';
  const VERSION = 1;

  function get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (entry.v !== VERSION || entry.expiresAt < Date.now()) { localStorage.removeItem(PREFIX + key); return null; }
      return entry.data;
    } catch (e) { return null; }
  }

  function set(key, data, ttlMs) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ v: VERSION, data, expiresAt: Date.now() + ttlMs }));
    } catch (e) { /* quota cheia ou modo privado — cache é só optimização, falha em silêncio */ }
  }

  // invalidate('/products') apaga só entradas cuja chave contenha esse
  // trecho; invalidate() sem argumento apaga tudo o que este módulo
  // guardou (não mexe noutras chaves do localStorage da app).
  function invalidate(pathFragment) {
    try {
      Object.keys(localStorage)
        .filter((k) => k.indexOf(PREFIX) === 0 && (!pathFragment || k.indexOf(pathFragment) !== -1))
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  }

  return { get, set, invalidate };
})();

// ── PERMISSION MANAGER ──────────────────────────────────────
// Duas coisas distintas que viviam espalhadas e sem nome próprio:
//
//  1) Capacidades da APP por papel (BUYER/SELLER/ADMIN) — antes cada
//     sítio fazia o seu próprio `user.role === 'BUYER'`. Continuam a
//     poder fazer isso (não muda nada do que já existe), mas agora há
//     um sítio único para o resto do código consultar, e para código
//     novo evitar reespalhar a mesma regra.
//
//  2) Permissões do BROWSER (notificações push, localização) — antes
//     cada ficheiro (push-notifications.js, maps.js) lia/pedia a sua
//     diretamente. Aqui ficam consultáveis e reactivas via
//     Bazares.State (chave 'permission:notifications' / 'permission:
//     geolocation'), sem cada ficheiro ter de sondar a sua própria.
Bazares.Permission = (() => {
  // Capacidade → papéis que a têm. 'ANY' = qualquer utilizador
  // autenticado, independentemente do papel.
  const CAPABILITIES = {
    buy: ['BUYER'],
    favoritar: ['BUYER'],
    sell: ['SELLER'],
    manageStore: ['SELLER'],
    postReel: ['SELLER'],
    postAnnouncement: ['SELLER'],
    admin: ['ADMIN'],
  };

  function can(capability, user) {
    const u = user !== undefined ? user : (window.Session ? Session.user : null);
    if (!u) return false;
    const roles = CAPABILITIES[capability];
    return !roles || roles.includes(u.role);
  }

  // Consulta sem pedir (não interrompe o utilizador) — 'granted',
  // 'denied', 'prompt', ou null se o browser não suportar a API em
  // causa. Actualiza sempre Bazares.State para quem quiser reagir.
  async function browserStatus(name) {
    try {
      if (name === 'notifications') {
        const state = typeof Notification === 'undefined' ? null : Notification.permission;
        Bazares.State.set('permission:notifications', state);
        return state;
      }
      if (name === 'geolocation' && navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        Bazares.State.set('permission:geolocation', status.state);
        status.onchange = () => Bazares.State.set('permission:geolocation', status.state);
        return status.state;
      }
    } catch (e) {}
    return null;
  }

  return { can, browserStatus, CAPABILITIES };
})();


// A MESMA regra que já vivia dentro de initPage() (ver app.js):
//   requireAuth  → sem utilizador, manda para login.html?next=...
//   roles        → utilizador de outro papel, manda para dashboard.html
//   guestOnly    → utilizador JÁ autenticado numa página só-de-visitante
//                  (login/registo/recuperar-password), manda para home.html
// Isolado aqui para initPage() (carga normal) e BazaresRouter (SPA,
// antes de trocar o conteúdo) chamarem exactamente a mesma lógica,
// em vez de duas cópias que podiam divergir com o tempo.
Bazares.RouteGuard = (() => {
  function check({ requireAuth = false, roles = null, guestOnly = false, user = undefined, url = location.href } = {}) {
    const currentUser = user !== undefined ? user : (window.Session ? Session.user : null);

    if (guestOnly && currentUser) {
      return { ok: false, redirect: 'home.html', params: {} };
    }
    if (requireAuth && !currentUser) {
      return { ok: false, redirect: 'login.html', params: { next: url } };
    }
    if (roles && currentUser && !roles.includes(currentUser.role)) {
      return { ok: false, redirect: 'dashboard.html', params: {} };
    }
    return { ok: true };
  }

  // Lê os requisitos declarados no <body data-require-auth data-roles
  // data-guest-only> de um documento já parseado (usado pelo
  // BazaresRouter a partir do HTML ainda não trocado no ecrã — ver
  // spa-router.js). Páginas sem esses atributos são tratadas como
  // públicas (sem qualquer restrição), como sempre foi o caso.
  function readDeclared(doc) {
    const b = doc && doc.body;
    if (!b) return { requireAuth: false, roles: null, guestOnly: false };
    return {
      requireAuth: b.getAttribute('data-require-auth') === '1',
      roles: b.getAttribute('data-roles') ? b.getAttribute('data-roles').split(',') : null,
      guestOnly: b.getAttribute('data-guest-only') === '1'
    };
  }

  return { check, readDeclared };
})();

// ── NAVIGATION MANAGER ──────────────────────────────────────
// Ponto único para "onde estou" / "para onde vou" — não substitui
// go()/goBack() (continuam a ser a forma normal de navegar dentro
// das páginas, ver app.js), envolve-os. Dispara 'bazares:nav:change'
// tanto numa troca SPA (via BazaresRouter) como no carregamento
// inicial de qualquer página — quem precisar de reagir a "mudei de
// página" (ex.: fechar sidebar, analytics) ouve um único evento em
// vez de ter de saber se a navegação foi SPA ou reload completo.
Bazares.Nav = (() => {
  function fileOf(pathname) { return pathname.split('/').pop() || 'index.html'; }

  function current() {
    return { file: fileOf(location.pathname), path: location.pathname, query: location.search };
  }

  function emitChange(from) {
    const to = current();
    Bazares.State.set('route', to);
    Bazares.Events.emit('nav:change', { from, to });
  }

  // Navega para `page` (com params opcionais) usando sempre o mesmo
  // caminho que go() já usa (SPA quando possível, MPA como reserva) —
  // API central para quem preferir chamar Bazares.Nav.to(...) em vez
  // de go(...) directamente (mesmo resultado, nome mais explícito).
  function to(page, params) {
    if (typeof go === 'function') return go(page, params || {});
    const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    window.location.href = page + qs;
  }

  function back() {
    if (typeof goBack === 'function') return goBack();
    history.back();
  }

  let _last = current();
  document.addEventListener('bazares:spanavigate', () => {
    const from = _last;
    _last = current();
    emitChange(from);
  });
  document.addEventListener('DOMContentLoaded', () => { emitChange(null); });

  return { to, back, current, on: (fn) => Bazares.Events.on('nav:change', fn) };
})();

// ── HISTORY MANAGER ─────────────────────────────────────────
// Regista "camadas" que consomem o botão/gesto voltar (modal,
// lightbox, story viewer, editores...) num único sítio, em vez de
// cada uma exigir mais um `if` dentro de closeTopmostOverlay()
// (app.js). O mecanismo de histórico em si (empurrar uma entrada
// falsa ao abrir, consumi-la ao fechar) continua a ser o mesmo de
// sempre — _bzOpenOverlay/_bzConsumeOverlayGuard em app.js chamam
// agora para dentro deste registo central.
Bazares.History = (() => {
  // Ordem = prioridade de fecho (o primeiro que disser "sim, tenho
  // algo aberto" é o único a fechar nesse toque de voltar).
  const closers = []; // { name, test, close }

  function registerOverlayCloser(name, test, close) {
    closers.push({ name, test, close });
  }

  // Corre os closers registados por ordem; devolve true assim que um
  // deles fechar algo (não continua a tentar os restantes).
  function closeTop() {
    for (const c of closers) {
      try {
        if (c.test()) { c.close(); return true; }
      } catch (e) {}
    }
    return false;
  }

  // Estes dois nomes são só um alias directo às funções que já
  // existem em app.js — mantidos aqui para initPage()/overlays
  // novos poderem chamar Bazares.History.* sem precisar de saber
  // que a implementação real vive noutro ficheiro.
  function openOverlay() { if (typeof _bzOpenOverlay === 'function') _bzOpenOverlay(); }
  function consumeOverlayGuard() { if (typeof _bzConsumeOverlayGuard === 'function') _bzConsumeOverlayGuard(); }

  return { registerOverlayCloser, closeTop, openOverlay, consumeOverlayGuard };
})();

// ── DROPDOWN MANAGER ────────────────────────────────────────
// Painel pequeno ancorado a um botão (menu de acções, selector),
// SEM fundo escuro nem entrada no histórico — ao contrário dos
// modais/drawers/sheets, um dropdown é efémero por natureza: fecha
// sozinho ao tocar fora, ao rolar a página, ao mudar de tamanho de
// ecrã, ou com Escape, exactamente como qualquer menu nativo.
Bazares.Dropdown = (() => {
  let current = null; // { el, onOutside, onEsc }

  function close() {
    if (!current) return;
    current.el.remove();
    document.removeEventListener('click', current.onOutside, true);
    document.removeEventListener('keydown', current.onEsc);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    current = null;
  }

  // anchor: elemento de referência (normalmente o botão que foi tocado).
  // itemsHtml: string já pronta com .dropdown-item's dentro.
  // opts.align: 'left' (por defeito) ou 'right' — de que lado do anchor
  // o painel se alinha.
  function open(anchor, itemsHtml, opts = {}) {
    close();
    const el = document.createElement('div');
    el.className = 'dropdown-panel';
    el.innerHTML = itemsHtml;
    document.body.appendChild(el);

    const r = anchor.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    let top = r.bottom + 6 + window.scrollY;
    let left = (opts.align === 'right' ? r.right - pr.width : r.left) + window.scrollX;
    left = Math.max(8, Math.min(left, window.scrollX + vw - pr.width - 8));
    if (r.bottom + pr.height + 6 > vh) top = r.top + window.scrollY - pr.height - 6; // sem espaço em baixo — abre para cima
    el.style.top = top + 'px';
    el.style.left = left + 'px';

    // Não fechar logo no mesmo clique que abriu o dropdown (o listener
    // de 'click' global já estaria activo antes do click terminar de
    // propagar, e fechava-o no instante em que abria).
    const onOutside = (e) => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => document.addEventListener('click', onOutside, true), 0);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onEsc);
    current = { el, onOutside, onEsc };
    return el;
  }

  function isOpen() { return !!current; }

  return { open, close, isOpen };
})();

// ── TOOLTIP MANAGER ─────────────────────────────────────────
// Basta pôr data-tooltip="texto" em qualquer elemento — funciona
// mesmo em conteúdo injectado depois (cartões renderizados
// dinamicamente, páginas SPA), porque ouve por delegação em vez de
// precisar de um listener por elemento. Aparece ao passar o rato ou
// ao focar via teclado (acessibilidade); em ecrãs tácteis puros isto
// raramente dispara (não há hover), o que é o comportamento certo —
// não é um substituto de legendas visíveis, só um extra para quem
// usa rato/teclado (ex.: páginas de admin).
Bazares.Tooltip = (() => {
  let el = null;
  let showTimer = null;

  function hide() {
    clearTimeout(showTimer);
    if (el) { el.remove(); el = null; }
  }

  function show(target) {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    hide();
    el = document.createElement('div');
    el.className = 'bz-tooltip';
    el.textContent = text;
    document.body.appendChild(el);

    const r = target.getBoundingClientRect();
    const tr = el.getBoundingClientRect();
    let top = r.top + window.scrollY - tr.height - 9;
    if (top < window.scrollY + 4) top = r.bottom + window.scrollY + 9; // sem espaço em cima — mostra por baixo
    let left = r.left + window.scrollX + (r.width - tr.width) / 2;
    left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - tr.width - 8));
    el.style.top = top + 'px';
    el.style.left = left + 'px';
  }

  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tooltip]');
    if (!t) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(t), 380); // pequeno atraso — evita piscar ao passar por cima de vários seguidos
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest && e.target.closest('[data-tooltip]')) hide();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest && e.target.closest('[data-tooltip]');
    if (t) show(t);
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.closest && e.target.closest('[data-tooltip]')) hide();
  });
  window.addEventListener('scroll', hide, true);

  return { hide };
})();
