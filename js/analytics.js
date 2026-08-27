/* ============================================================
   BAZARES — Analytics centralizado
   ------------------------------------------------------------
   Um único módulo, um único vocabulário de eventos, em toda a
   app (55 páginas). Objectivo: parar de reconstruir métricas a
   partir de logs soltos e passar a ter dados estruturados para:
     - User Journey Tracking  → cada page_view leva session_id
       + anon_id (+ user_id quando autenticado), por ordem
     - Conversion Funnels     → trackFunnelStep(funnel, step)
     - Drop-off Analysis      → dá para calcular a partir da
       sequência de funnel_step por sessão (quem parou em que
       passo) — cálculo fica do lado do backend/BI, aqui só se
       garante que o passo é sempre reportado
     - Feature Usage Analytics→ trackFeatureUsed(feature, meta)
     - Search Analytics       → trackSearchPerformed(...)

   Eventos padronizados (nomes fixos, não inventar variantes):
     page_view, product_viewed, product_published,
     checkout_started, order_created, search_performed,
     funnel_step, feature_used

   Cada evento sai com o mesmo envelope (ver track()), para que
   o backend nunca precise de adivinhar de onde veio.

   IMPORTANTE — pendente do lado do backend: isto envia para
   POST {BAZARES_API_BASE}/api/analytics/events, em lote, no
   formato { events: [...] }. Esse endpoint ainda não existe no
   backend (não fazia parte deste export do frontend) — precisa
   de ser criado lá para os eventos deixarem de ficar presos na
   fila local. Até isso acontecer, os eventos ficam guardados em
   localStorage (até ao limite abaixo) e sobem sozinhos assim
   que o endpoint responder 2xx.
============================================================ */
'use strict';

window.Bazares = window.Bazares || {};

Bazares.Analytics = (() => {
  const PATH = '/analytics/events';
  const ANON_KEY = 'bazares_an_anon';
  const SESSION_KEY = 'bazares_an_session';
  const QUEUE_KEY = 'bazares_an_queue';
  const SESSION_TTL = 30 * 60 * 1000;   // 30min sem actividade = nova sessão
  const FLUSH_INTERVAL = 12000;
  const MAX_BATCH = 20;
  const MAX_QUEUE = 300;                // nunca cresce sem limite se ficar muito tempo offline

  function uuid() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ── identidade anónima persistente (sobrevive a sessões) ──
  function getAnonId() {
    try {
      let id = localStorage.getItem(ANON_KEY);
      if (!id) { id = uuid(); localStorage.setItem(ANON_KEY, id); }
      return id;
    } catch { return 'anon-unknown'; }
  }

  // ── sessão (expira ao fim de 30min de inactividade) ──
  let _session = null;
  function getSession() {
    const now = Date.now();
    try {
      if (!_session) {
        const raw = sessionStorage.getItem(SESSION_KEY);
        _session = raw ? JSON.parse(raw) : null;
      }
      if (!_session || now - _session.lastActivity > SESSION_TTL) {
        _session = { id: uuid(), startedAt: now, lastActivity: now, pageCount: 0 };
      }
      _session.lastActivity = now;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(_session));
      return _session;
    } catch {
      if (!_session) _session = { id: 'session-unknown', startedAt: now, lastActivity: now, pageCount: 0 };
      return _session;
    }
  }

  function currentUserId() {
    try { return window.Session?.user?.id || null; } catch { return null; }
  }
  function currentUserRole() {
    try { return window.Session?.user?.role || null; } catch { return null; }
  }

  // ── fila persistida (sobrevive a recarregar/fechar a app) ──
  let _queue = [];
  try { _queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { _queue = []; }

  function persistQueue() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(_queue.slice(-MAX_QUEUE))); } catch {}
  }

  function apiBase() {
    return (window.BAZARES_API_BASE || 'http://localhost:3001') + '/api';
  }

  function enqueue(evt) {
    _queue.push(evt);
    if (_queue.length > MAX_QUEUE) _queue = _queue.slice(-MAX_QUEUE); // descarta os mais antigos, nunca os recentes
    persistQueue();
    if (_queue.length >= MAX_BATCH) flush();
  }

  let _flushing = false;
  async function flush(useBeacon) {
    if (!_queue.length) return;
    if (window.Bazares?.Connectivity && !Bazares.Connectivity.isOnline() && !useBeacon) return;

    const batch = _queue.slice(0, MAX_BATCH);
    const url = apiBase() + PATH;

    if (useBeacon && navigator.sendBeacon) {
      try {
        const blob = new Blob([JSON.stringify({ events: batch })], { type: 'application/json' });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) { _queue = _queue.slice(batch.length); persistQueue(); }
      } catch {}
      return;
    }

    if (_flushing) return;
    _flushing = true;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true
      });
      if (res.ok) {
        _queue = _queue.slice(batch.length);
        persistQueue();
      }
      // se falhar (endpoint ainda não existe, rede em baixo, etc.), fica
      // tudo na fila — tenta-se outra vez no próximo ciclo, sem perder nada
    } catch {
      // silencioso de propósito: analytics nunca deve incomodar o utilizador
    } finally {
      _flushing = false;
    }
  }

  // ── envelope comum a todos os eventos ──
  function track(eventName, properties) {
    if (!eventName) return;
    const s = getSession();
    s.pageCount = s.pageCount || 0;
    const evt = {
      event: eventName,
      properties: properties || {},
      anon_id: getAnonId(),
      session_id: s.id,
      user_id: currentUserId(),
      user_role: currentUserRole(),
      timestamp: new Date().toISOString(),
      page: location.pathname,
      url: location.href,
      referrer: document.referrer || null
    };
    enqueue(evt);
    return evt;
  }

  // ── page_view automático (User Journey Tracking) ──
  let _lastTrackedPage = null;
  function trackPageView(extra) {
    // evita duplicar o mesmo page_view (ex.: DOMContentLoaded + evento SPA
    // a disparar quase ao mesmo tempo na primeira carga)
    if (_lastTrackedPage === location.pathname + location.search) return;
    _lastTrackedPage = location.pathname + location.search;
    const s = getSession();
    s.pageCount = (s.pageCount || 0) + 1;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
    track('page_view', { title: document.title, position_in_session: s.pageCount, ...extra });
  }

  // ── eventos padronizados (ver taxonomia no topo do ficheiro) ──
  function trackProductViewed(product) {
    if (!product) return;
    track('product_viewed', {
      product_id: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      price: product.price,
      seller_id: product.sellerId || product.seller?.id,
      bazar_id: product.bazarId || product.bazar?.id,
      in_stock: (product.stock ?? null) > 0
    });
  }

  function trackProductPublished(product) {
    if (!product) return;
    track('product_published', {
      product_id: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      stock: product.stock
    });
  }

  function trackCheckoutStarted(details) {
    track('checkout_started', {
      mode: details?.mode || null,        // 'single' | 'cart'
      item_count: details?.itemCount ?? null,
      total: details?.total ?? null,
      currency: 'MZN'
    });
  }

  function trackOrderCreated(order) {
    track('order_created', {
      order_id: order?.id || order?.orderId || null,
      total: order?.total ?? null,
      item_count: order?.itemCount ?? (Array.isArray(order?.items) ? order.items.length : null),
      payment_method: order?.paymentMethod || null,
      mode: order?.mode || null,
      currency: 'MZN'
    });
  }

  function trackSearchPerformed(details) {
    track('search_performed', {
      query: details?.query || '',
      tab: details?.tab || 'tudo',
      results_count: details?.resultsCount ?? null,
      has_results: (details?.resultsCount ?? 0) > 0
    });
  }

  // ── Conversion Funnels / Drop-off Analysis ──
  // Uso genérico: Bazares.Analytics.trackFunnelStep('checkout', 'iniciado', {...})
  // A análise de abandono (em que passo cada sessão parou) é feita a
  // partir da sequência destes eventos por session_id — não precisa de
  // lógica extra aqui, só de reportar sempre o passo certo.
  function trackFunnelStep(funnel, step, meta) {
    if (!funnel || !step) return;
    track('funnel_step', { funnel, step, ...meta });
  }

  // ── Feature Usage Analytics ──
  function trackFeatureUsed(feature, meta) {
    if (!feature) return;
    track('feature_used', { feature, ...meta });
  }

  // ── disparo automático de page_view ──
  // Primeira carga da página real (não-SPA):
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    trackPageView();
  } else {
    document.addEventListener('DOMContentLoaded', () => trackPageView(), { once: true });
  }
  // Navegações seguintes dentro da SPA (ver js/spa-router.js → 'bazares:spanavigate'):
  document.addEventListener('bazares:spanavigate', () => trackPageView());

  // ── ciclo de envio ──
  setInterval(() => flush(false), FLUSH_INTERVAL);
  window.addEventListener('online', () => flush(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true); // sendBeacon — sobrevive ao fecho da página
  });
  window.addEventListener('pagehide', () => flush(true));

  return {
    track,
    trackPageView,
    trackProductViewed,
    trackProductPublished,
    trackCheckoutStarted,
    trackOrderCreated,
    trackSearchPerformed,
    trackFunnelStep,
    trackFeatureUsed,
    flush: () => flush(false)
  };
})();
