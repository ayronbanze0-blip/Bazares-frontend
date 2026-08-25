/* ============================================================
   BAZARES — API Client (vanilla JS, no build needed)
   Mirrors every backend route exactly. Configure API_BASE below.
============================================================ */
'use strict';

// ─── CONFIG ────────────────────────────────────────────────────
// Change this if your backend runs elsewhere. Defaults to localhost:3001
// (the backend's default dev port). For production, replace with your
// deployed backend URL, e.g. 'https://api.bazares.co.mz'.
const API_BASE = (window.BAZARES_API_BASE || 'http://localhost:3001') + '/api';
const SOCKET_BASE = window.BAZARES_API_BASE || 'http://localhost:3001';

// ─── IN-MEMORY ACCESS TOKEN ────────────────────────────────────
// Never persisted to localStorage; restored via silent refresh on load.
let _accessToken = null;
const getAccessToken = () => _accessToken;
const setAccessToken = (t) => { _accessToken = t; };

// ─── REFRESH TOKEN (localStorage fallback) ─────────────────────
// O refresh token normalmente vive num cookie httpOnly — mais seguro,
// porque scripts não conseguem lê-lo. Mas o Safari do iOS bloqueia esse
// cookie por ser "de terceiro" (frontend e backend em domínios
// diferentes), o que deixava o login preso num ciclo de redireccionar
// de volta para login.html. Por isso, além do cookie, guardamos também
// o token aqui e mandamo-lo explicitamente no pedido — funciona em
// qualquer navegador, independentemente da política de cookies dele.
const RT_KEY = 'bazares_rt';
const getRefreshToken = () => { try { return localStorage.getItem(RT_KEY); } catch { return null; } };
const setRefreshToken = (t) => { try { t ? localStorage.setItem(RT_KEY, t) : localStorage.removeItem(RT_KEY); } catch {} };
const clearRefreshToken = () => setRefreshToken(null);

// ─── REFRESH QUEUE (avoid refresh storms on concurrent 401s) ──
let _isRefreshing = false;
let _refreshQueue = [];

function _flushQueue(token, err) {
  _refreshQueue.forEach(({ resolve, reject }) => err ? reject(err) : resolve(token));
  _refreshQueue = [];
}

/**
 * fetch() with a per-attempt timeout and automatic retry on network-level
 * failure (connection dropped, DNS hiccup, or — the most common real-world
 * case here — a Railway free-tier backend that was asleep and is still
 * waking up on the first request). Does NOT retry once a response is
 * actually received (so it never double-submits an order/payment/etc).
 *
 * `perAttemptTimeout` é configurável (default 20s) — pedidos normais
 * (JSON, poucos KB) não precisam de mais do que isso. Uploads grandes
 * (vídeo/áudio) passam um valor maior, calculado a partir do tamanho
 * real do ficheiro — ver `estimateFormDataBytes`/`uploadTimeoutFor` em
 * baixo. Sem isto, um upload de vídeo mais pesado numa rede mais lenta
 * era cortado a meio pelo AbortController antes de terminar de subir,
 * e a ligação fechava sem resposta nenhuma (nem sucesso nem erro claro
 * — só um pedido que nunca chega ao fim).
 */
async function fetchWithRetry(url, options, attempts = 3, perAttemptTimeout = 20000) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perAttemptTimeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res; // got a real HTTP response — stop here, success or not
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastErr;
}

// Soma o tamanho real dos ficheiros num FormData (ignora campos de texto).
function estimateFormDataBytes(fd) {
  let total = 0;
  try {
    for (const [, v] of fd.entries()) {
      if (v instanceof Blob) total += v.size;
    }
  } catch { /* entries() indisponível — segue com 0, cai no mínimo abaixo */ }
  return total;
}

// Timeout por tentativa para uploads (FormData), a escalar com o
// tamanho real do ficheiro em vez de um valor fixo — o vídeo recortado
// no telemóvel agora pode pesar bastante mais (bitrate subido para
// corrigir a qualidade), e um timeout fixo de 20s cortava o envio a
// meio em redes mais lentas antes de terminar de subir. Assume um
// piso conservador de ~40KB/s (rede móvel fraca) + 20s de folga fixa
// para o handshake/latência, com um teto de 5 min para nunca ficar
// pendurado indefinidamente se algo estiver mesmo avariado no servidor.
function uploadTimeoutFor(formData) {
  const bytes = estimateFormDataBytes(formData);
  if (!bytes) return 20000; // sem ficheiros a sério (ex.: só campos de texto) — mantém o timeout normal
  return Math.min(300000, Math.max(30000, Math.round(bytes / 40000) * 1000 + 20000));
}

/**
 * Core request helper. Always sends credentials (httpOnly refresh cookie),
 * attaches the Bearer access token, and auto-refreshes once on 401.
 */
async function apiRequest(method, path, { body, isForm, params, _retry } = {}) {
  const _t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  const _monitor = (ok, status, extra) => {
    const durationMs = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - _t0);
    try {
      window.Sentry?.addBreadcrumb?.({
        category: 'api', level: ok ? 'info' : 'error',
        message: `${method} ${path} → ${status ?? 'network-error'}`,
        data: { method, path, status, durationMs, ...extra }
      });
    } catch {}
    // Complementa o Sentry com um registo próprio, consultável em
    // GET /api/analytics/summary sem precisar de abrir o dashboard do
    // Sentry — só regista o que interessa (falhas e chamadas lentas),
    // nunca todas as chamadas (isso seria a Analytics normal, não isto).
    if (!ok) {
      Bazares.Analytics?.track('api_error', { method, path, status: status ?? null, duration_ms: durationMs, ...extra });
    } else if (durationMs > 3000) {
      Bazares.Analytics?.track('api_slow', { method, path, duration_ms: durationMs });
    }
  };

  let url = API_BASE + path;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
    const qsStr = qs.toString();
    if (qsStr) url += '?' + qsStr;
  }

  const headers = {};
  if (_accessToken) headers['Authorization'] = 'Bearer ' + _accessToken;
  // Cookie pode não chegar (Safari/iOS bloqueia cookie de terceiro) — manda
  // o refresh token guardado também no corpo, como reforço.
  if (path === '/auth/refresh' || path === '/auth/logout') {
    body = { ...(body || {}), refreshToken: getRefreshToken() };
  }
  let fetchBody;
  if (isForm) {
    fetchBody = body; // FormData — browser sets Content-Type with boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  let res;
  try {
    if (window.Bazares?.Loading) Bazares.Loading.start();
    const timeoutMs = (isForm && body instanceof FormData) ? uploadTimeoutFor(body) : 20000;
    res = await fetchWithRetry(url, { method, headers, body: fetchBody, credentials: 'include' }, 3, timeoutMs);
  } catch (networkErr) {
    const isUpload = isForm && body instanceof FormData;
    let msg;
    if (!navigator.onLine) {
      // O dispositivo está mesmo sem rede — aqui faz sentido apontar para a internet.
      msg = isUpload
        ? 'Não foi possível concluir o envio. Verifique a sua ligação à internet e tente novamente — se persistir, tente com menos imagens de cada vez.'
        : 'Sem ligação à internet. Verifique a sua rede e tente novamente.';
    } else {
      // O dispositivo tem rede, mas o pedido falhou (servidor em baixo,
      // timeout, CORS, etc.) — não é um problema de internet do utilizador.
      msg = isUpload
        ? 'Não foi possível concluir o envio. O servidor não respondeu — tente novamente em breve.'
        : 'Não foi possível ligar ao servidor. Tente novamente em breve.';
    }
    _monitor(false, null, { reason: !navigator.onLine ? 'offline' : 'server_unreachable' });
    throw { ok: false, networkError: true, message: msg };
  } finally {
    if (window.Bazares?.Loading) Bazares.Loading.stop();
  }

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  // Sempre que o servidor devolver um refreshToken novo (login ou
  // rotação no refresh), actualiza a cópia local — é o que faz este
  // mecanismo funcionar como substituto do cookie no Safari/iOS.
  if (data?.data?.refreshToken) setRefreshToken(data.data.refreshToken);
  if (path === '/auth/logout') clearRefreshToken();

  if (res.status === 401 && !_retry && path !== '/auth/refresh' && path !== '/auth/login') {
    // Try a single silent refresh, queuing concurrent callers.
    if (_isRefreshing) {
      const token = await new Promise((resolve, reject) => _refreshQueue.push({ resolve, reject })).catch(() => null);
      if (token) {
        return apiRequest(method, path, { body, isForm, params, _retry: true });
      }
    } else {
      _isRefreshing = true;
      try {
        const r = await fetch(API_BASE + '/auth/refresh', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: getRefreshToken() })
        });
        const rd = await r.json().catch(() => null);
        if (r.ok && rd?.data?.accessToken) {
          setAccessToken(rd.data.accessToken);
          if (rd.data.refreshToken) setRefreshToken(rd.data.refreshToken);
          _flushQueue(rd.data.accessToken, null);
          return apiRequest(method, path, { body, isForm, params, _retry: true });
        }
        _flushQueue(null, new Error('refresh failed'));
      } catch (e) {
        _flushQueue(null, e);
      } finally {
        _isRefreshing = false;
      }
      // Refresh failed — force logout state
      setAccessToken(null);
      clearRefreshToken();
      document.dispatchEvent(new CustomEvent('bazares:unauthorized'));
    }
  }

  if (!res.ok) {
    // 429 (rate limit) tem uma mensagem própria mais clara — o
    // Retry-After do backend (em segundos) dá um tempo concreto em vez
    // de "tente novamente" genérico, quando o cabeçalho vem presente.
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '', 10);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? (retryAfter >= 60 ? `${Math.ceil(retryAfter / 60)} min` : `${retryAfter}s`)
        : 'momentos';
      const message = data?.message || `Está a ir depressa demais. Espere ${wait} e tente novamente.`;
      _monitor(false, 429, { reason: 'rate_limited' });
      throw { ok: false, status: 429, code: data?.code, message, errors: data?.errors, rateLimited: true, retryAfter: Number.isFinite(retryAfter) ? retryAfter : null };
    }
    const message = data?.message || data?.errors?.[0]?.message || `Erro ${res.status}`;
    _monitor(false, res.status, { code: data?.code || null });
    throw { ok: false, status: res.status, code: data?.code, message, errors: data?.errors };
  }
  _monitor(true, res.status);
  return data; // { success, message, data }
}

const api = {
  get: (path, params) => {
    // Cache Manager — só os caminhos GET explicitamente listados aqui
    // passam pela cache persistente (localStorage, sobrevive a
    // recarregar/fechar a app); tudo o resto vai sempre à rede, como
    // sempre foi. Nunca se aplica se vierem parâmetros (query diferente
    // = pedido diferente) — mantém a coisa simples e sem risco de
    // devolver dados errados por engano.
    const rule = (!params || !Object.keys(params).length) && CACHEABLE_GET.find((r) => r.test(path));
    const fetcher = () => apiRequest('GET', path, { params });

    // Deduplicação: dois pedidos GET idênticos disparados quase ao
    // mesmo tempo (ex.: dois componentes da mesma página a pedir os
    // mesmos dados) partilham uma única chamada de rede em vez de
    // duas — Bazares.RequestCache já existia em core.js mas nunca
    // tinha sido ligado aqui. TTL só é > 0 para os GETs marcados como
    // "lentos a mudar" (CACHEABLE_GET); para o resto é só deduplicação
    // dos pedidos em voo, sem guardar resultado depois de responder.
    if (window.Bazares?.RequestCache) {
      return Bazares.RequestCache.dedupedGet(path, params, () => {
        if (!rule || !window.Bazares?.Cache) return fetcher();
        const key = 'GET ' + path;
        const cached = Bazares.Cache.get(key);
        if (cached !== null) return Promise.resolve(cached);
        return fetcher().then((data) => { Bazares.Cache.set(key, data, rule.ttl); return data; });
      }, rule ? rule.ttl : 0);
    }

    if (!rule || !window.Bazares?.Cache) return fetcher();
    const key = 'GET ' + path;
    const cached = Bazares.Cache.get(key);
    if (cached !== null) return Promise.resolve(cached);
    return fetcher().then((data) => { Bazares.Cache.set(key, data, rule.ttl); return data; });
  },
  post: (path, body) => apiRequest('POST', path, { body }),
  postForm: (path, formData) => apiRequest('POST', path, { body: formData, isForm: true }),
  put: (path, body) => apiRequest('PUT', path, { body }),
  putForm: (path, formData) => apiRequest('PUT', path, { body: formData, isForm: true }),
  patch: (path, body) => apiRequest('PATCH', path, { body }),
  delete: (path, body) => apiRequest('DELETE', path, { body })
};

// Lista curada de GETs "lentos a mudar" — cada entrada nova aqui é uma
// decisão consciente (dados estáticos/quase-estáticos), não uma regra
// automática por padrão de URL. `ttl` em ms.
const CACHEABLE_GET = [
  { test: (p) => p === '/products/categories-overview', ttl: 30 * 60 * 1000 }
];

function apiErrorMessage(err) {
  if (err?.message) return err.message;
  return 'Ocorreu um erro inesperado. Tente novamente.';
}
