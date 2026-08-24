/* ============================================================
   BAZARES — Auth, Session, Shared Utilities (vanilla JS)
============================================================ */
'use strict';

// ─── DESLIGAR PINCH-ZOOM DA PÁGINA ─────────────────────────────
// O <meta viewport> (maximum-scale=1,user-scalable=no) e o CSS
// (touch-action:manipulation) não chegam sozinhos: o Safari/iOS
// ignora de propósito esses dois desde 2016 (decisão de
// acessibilidade da Apple, permanente — não é bug, não vai voltar a
// funcionar por essa via). O pinch-zoom no iOS dispara os eventos
// proprietários `gesturestart`/`gesturechange` do WebKit — travamos
// aí. No Android/Chrome não há esses eventos, mas o zoom de dois
// dedos passa por `touchmove` com 2+ toques em simultâneo — travamos
// esse caso também. O scroll normal (1 dedo) não é afectado.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// ─── SESSION ────────────────────────────────────────────────────
// Pista local e não-sensível (não é o token — só diz "já esteve
// autenticado neste navegador"). Permite saltar por completo o pedido
// de /auth/refresh para visitantes novos, que é o caso mais comum na
// primeira visita — a página deixa de "esperar pela rede" para pintar.
const SESSION_HINT_KEY = 'bz_had_session';
const hadSessionBefore = () => { try { return localStorage.getItem(SESSION_HINT_KEY) === '1'; } catch { return true; } };
const markSessionHint  = (on) => { try { on ? localStorage.setItem(SESSION_HINT_KEY,'1') : localStorage.removeItem(SESSION_HINT_KEY); } catch {} };

const Session = {
  _user: null,

  get user() { return this._user; },

  async bootstrap() {
    // Sem pista de sessão anterior <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg> não vale a pena tentar /auth/refresh.
    // Poupa uma volta de rede inteira em toda visita de convidado.
    if (!hadSessionBefore()) { this._user = null; return null; }
    try {
      const res = await api.post('/auth/refresh');
      if (res?.data?.accessToken) {
        setAccessToken(res.data.accessToken);
        // O /auth/refresh já devolve o utilizador — evita um segundo
        // pedido a /auth/me em cada carregamento de página autenticado.
        if (res.data.user) {
          this._user = res.data.user;
        } else {
          const me = await api.get('/auth/me');
          this._user = me?.data?.user || null;
        }
        markSessionHint(true);
      }
    } catch { this._user = null; markSessionHint(false); }
    finally { if (window.Bazares?.State) Bazares.State.set('user', this._user); }
    return this._user;
  },

  async login(email, password) {
    const res = await api.post('/auth/login', { email, password });
    if (res?.data?.accessToken) setAccessToken(res.data.accessToken);
    // /auth/login já devolve o utilizador — usa-o de imediato em vez de
    // esperar por mais um pedido a /auth/me antes de poder navegar.
    this._user = res?.data?.user || null;
    markSessionHint(true);
    if (window.Bazares?.State) Bazares.State.set('user', this._user);
    return this._user;
  },

  // Login social (Google / Facebook / Apple). `endpoint` é 'google',
  // 'facebook' ou 'apple'; `body` é o token que o respectivo SDK devolveu.
  async socialLogin(endpoint, body) {
    const res = await api.post(`/auth/${endpoint}`, body);
    if (res?.data?.accessToken) setAccessToken(res.data.accessToken);
    this._user = res?.data?.user || null;
    markSessionHint(true);
    if (window.Bazares?.State) Bazares.State.set('user', this._user);
    return this._user;
  },

  async logout(_fromOtherTab = false) {
    if (!_fromOtherTab) {
      try { await api.post('/auth/logout'); } catch {}
      AuthSync.broadcastLogout();
    }
    setAccessToken(null);
    clearRefreshToken();
    markSessionHint(false);
    this._user = null;
    if (window.Bazares?.State) Bazares.State.set('user', null);
  },

  isLoggedIn() { return !!this._user; },
  isRole(...roles) { return roles.includes(this._user?.role); }
};

// Force logout on 401
document.addEventListener('bazares:unauthorized', () => {
  Session._user = null;
  setAccessToken(null);
  const cur = location.href;
  if (!cur.includes('login.html') && !cur.includes('register.html')) {
    go('login.html');
  }
});

// ─── SINCRONIZAÇÃO ENTRE ABAS/SEPARADORES ──────────────────────
// Ao terminar sessão numa aba, todas as outras abas abertas do Bazares
// devem terminar sessão também (sem isto, uma aba antiga continuava
// autenticada e a fazer pedidos até o token expirar sozinho). Usa
// BroadcastChannel onde existe; cai para o evento 'storage' do
// localStorage (dispara nas OUTRAS abas, não na que escreveu) em
// navegadores mais antigos que não têm BroadcastChannel.
const AUTH_SYNC_KEY = 'bz_logout_ping';
const AuthSync = {
  _bc: null,
  init() {
    try {
      if ('BroadcastChannel' in window) {
        this._bc = new BroadcastChannel('bazares_auth');
        this._bc.onmessage = (ev) => { if (ev.data === 'logout') this._onRemoteLogout(); };
        return;
      }
    } catch {}
    // Fallback sem BroadcastChannel.
    window.addEventListener('storage', (ev) => {
      if (ev.key === AUTH_SYNC_KEY && ev.newValue) this._onRemoteLogout();
    });
  },
  broadcastLogout() {
    try { this._bc?.postMessage('logout'); } catch {}
    try { localStorage.setItem(AUTH_SYNC_KEY, String(Date.now())); } catch {}
  },
  _onRemoteLogout() {
    if (!Session.isLoggedIn() && !getAccessToken()) return; // já sem sessão nesta aba
    Session.logout(true);
    const cur = location.href;
    if (!cur.includes('login.html') && !cur.includes('register.html')) go('login.html');
  }
};
AuthSync.init();

// ─── ESTADO DA LIGAÇÃO (online/offline) ────────────────────────
// Aviso simples e global quando o telemóvel perde/recupera ligação —
// útil sobretudo em zonas com rede móvel instável, para o utilizador
// perceber porque é que uma acção não está a responder, em vez de
// pensar que a app está avariada.
window.addEventListener('offline', () => {
  // Sinal do browser é só um empurrão para verificar já — não confia
  // cegamente nele nem no 'online' (ver Bazares.Connectivity abaixo).
  Bazares?.Connectivity?.checkNow();
});
window.addEventListener('online', () => {
  Bazares?.Connectivity?.checkNow();
});

// ─── NAVIGATION ─────────────────────────────────────────────────
// Véu de transição — um <div> a cobrir o ecrã na cor de fundo,
// criado uma única vez e reutilizado. go() acende-o antes de mudar
// de página, para o corte da navegação MPA (window.location.href)
// ficar suave em vez de um flash branco/brusco. Ver .pt-veil (CSS).
function _ptVeil() {
  let v = document.getElementById('pt-veil');
  if (!v) {
    v = document.createElement('div');
    v.id = 'pt-veil';
    v.className = 'pt-veil';
    document.body.appendChild(v);
  }
  return v;
}

function go(page, params = {}) {
  const pretty = prettyUrl(page, params);
  const qs = pretty
    ? ''
    : Object.keys(params).length
      ? '?' + new URLSearchParams(params).toString()
      : '';
  const url = pretty || (page + qs);

  // Se o router SPA estiver carregado nesta página E tanto a página
  // actual como o destino já tiverem sido convertidas (fase 2, página a
  // página), navega sem reload. Em qualquer outro caso — router ausente,
  // ou uma das duas páginas ainda não migrada — cai exactamente no
  // comportamento de sempre (véu + location.href), sem qualquer mudança
  // de comportamento para páginas ainda não convertidas.
  if (window.BazaresRouter && BazaresRouter.isSpaPage(BazaresRouter.currentFile()) && BazaresRouter.isSpaPage(page.split('?')[0])) {
    BazaresRouter.navigate(url);
    return;
  }

  const veil = _ptVeil();
  veil.classList.add('show');
  // Um frame para o browser pintar o véu antes de largar a página —
  // sem isto o fade nunca chega a ser visto (a navegação começa antes
  // do repaint).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.location.href = url;
  }));
}

// Destino específico para quando não há histórico de navegação (ex: link
// direto/recarregar a página) — sem isto, essas duas páginas cairiam
// genericamente na home em vez do ecrã-mãe que faz sentido para elas.
const GOBACK_FALLBACK = { 'novoproduto.html': 'my-products.html', 'order-detail.html': 'my-orders.html' };
function goBack() {
  // Se a página foi aberta directamente (sem histórico dentro da app — ex:
  // link partilhado, PWA reaberta), history.back() não tem para onde ir e
  // ou não faz nada ou sai da app. Nesse caso, cai para a home (ou para o
  // destino específico da página, ver GOBACK_FALLBACK acima).
  if (history.length > 1) history.back();
  else go(GOBACK_FALLBACK[location.pathname.split('/').pop()] || 'home.html');
}

// ─── MEMÓRIA DE LISTAGEM (voltar sem perder a posição) ─────────────
// Guarda scroll + filtros de uma página de listagem em sessionStorage.
// É "consumido" (apagado) assim que é lido, para só se aplicar na volta
// imediata a seguir a abrir um item — uma visita nova à mesma página
// não é afectada.
try { history.scrollRestoration = 'manual'; } catch (e) {}
function saveListState(key, state) {
  try { sessionStorage.setItem('bz_list_' + key, JSON.stringify({ ...state, url: location.pathname + location.search })); }
  catch (e) {}
}
function getListState(key) {
  try {
    const raw = sessionStorage.getItem('bz_list_' + key);
    if (!raw) return null;
    sessionStorage.removeItem('bz_list_' + key);
    const st = JSON.parse(raw);
    return st.url === location.pathname + location.search ? st : null;
  } catch (e) { return null; }
}
function restoreScrollY(y) {
  const apply = () => window.scrollTo({ top: y || 0, left: 0, behavior: 'instant' });
  requestAnimationFrame(() => requestAnimationFrame(apply));
  // Segunda tentativa: alguns navegadores só terminam o layout um pouco
  // depois (imagens do hero/cartões a carregar), o que pode empurrar a
  // página e desviar o scroll já aplicado.
  setTimeout(apply, 300);
}

// Saudação sensível à hora do dia — pequeno toque de cuidado que substitui
// o "Olá" genérico nos dashboards. Usa a hora local do dispositivo.
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Boa madrugada';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function getParam(key) {
  return new URLSearchParams(location.search).get(key);
}

// ─── URLs AMIGÁVEIS (SEO) ───────────────────────────────────────────
// Extrai o slug de um URL do tipo /bazar/nome-da-loja a partir de
// window.location.pathname — usado pela própria página (bazar.html)
// para saber que loja mostrar, sem depender de ?id=. `segment` é o
// prefixo da rota (ex.: 'bazar'); devolve o troço seguinte do path,
// ou null se o URL actual não seguir esse padrão (ex.: quando a
// página é aberta directamente como /bazar.html, sem slug).
function getPathSlug(segment) {
  const parts = location.pathname.split('/').filter(Boolean);
  const i = parts.indexOf(segment);
  return i !== -1 && parts[i + 1] ? decodeURIComponent(parts[i + 1]) : null;
}

// Mapeia página+parâmetros para o URL "bonito" equivalente, quando
// existir uma rota amigável para essa página — hoje só /bazar/:slug
// (ver functions/bazar/[slug].js, que trata a mesma rota no servidor
// para SSR das meta tags a crawlers/partilhas). Central aqui em vez
// de em cada sítio que constrói um link de loja: go() e
// buildShareUrl() passam ambos por aqui, por isso um único mapa
// cobre toda a app — dos links do feed às sugestões de pesquisa.
const PRETTY_ROUTES = {
  'bazar.html': (params) => (params.id != null && params.id !== '' ? `/bazar/${encodeURIComponent(params.id)}` : null),
  'product.html': (params) => (params.id != null && params.id !== '' ? `/product/${encodeURIComponent(params.id)}` : null)
};
function prettyUrl(page, params) {
  const build = PRETTY_ROUTES[page];
  const pretty = build ? build(params) : null;
  if (!pretty) return null;
  // Parâmetros extra (além do id, já absorvido na própria rota) continuam
  // como query string — ex.: /bazar/fashion-hub?tab=reels.
  const rest = { ...params };
  delete rest.id;
  const qs = Object.keys(rest).length ? '?' + new URLSearchParams(rest).toString() : '';
  return pretty + qs;
}

// ─── FORMAT HELPERS ─────────────────────────────────────────────
const CATS = [
  { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>', l: 'Telemóveis e Acessórios', color:'#2563EB' }, { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', l: 'Electrónicos', color:'#7C3AED' },
  { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3l4 3 4-3 3 4-3 2v12H8V9L5 7z"/></svg>', l: 'Moda', color:'#DB2777' }, { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h20v2H2z"/><path d="M4 18v-4l4-2 3 2 4-4 5 3v5"/></svg>', l: 'Calçados', color:'#D97706' },
  { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>', l: 'Casa e Jardim', color:'#16A34A' }, { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M2 11a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M4 16v3"/><path d="M20 16v3"/></svg>', l: 'Móveis', color:'#B45309' },
  { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-6h16l1 6"/><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 21v-6h6v6"/></svg>', l: 'Electrodomésticos', color:'#0891B2' }, { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/><path d="M5 17h9.5"/></svg>', l: 'Automóveis', color:'#DC2626' },
  { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 17.5h-9l2-6h4l3 3h3"/><path d="M8 8.5h5"/></svg>', l: 'Motociclos', color:'#EA580C' }, { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 1 0-5.66 5.66l-6 6a2 2 0 1 0 2.83 2.83l6-6a4 4 0 1 0 5.66-5.66l-2.12 2.12-2.83-2.83z"/></svg>', l: 'Serviços', color:'#0D9488' },
  { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20"/><line x1="8" y1="6" x2="8" y2="6.01"/><line x1="12" y1="6" x2="12" y2="6.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="9" y1="22" x2="9" y2="18"/><line x1="15" y1="22" x2="15" y2="18"/></svg>', l: 'Imóveis', color:'#4F46E5' }, { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V10"/><path d="M12 10c-3 0-5-2-5-5 3 0 5 2 5 5z"/><path d="M12 10c3 0 5-2 5-5-3 0-5 2-5 5z"/><path d="M12 15c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4z"/><path d="M12 15c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4z"/></svg>', l: 'Agricultura', color:'#65A30D' },
  { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6v6l-2 2v10a1 1 0 0 1-1 1h-0a1 1 0 0 1-1-1V10l-2-2z"/></svg>', l: 'Saúde e Beleza', color:'#E11D48' }, { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="12 7 15.5 9.5 14 13.5 10 13.5 8.5 9.5"/><line x1="12" y1="2" x2="12" y2="7"/><line x1="15.5" y1="9.5" x2="20" y2="8"/><line x1="14" y1="13.5" x2="16.5" y2="19"/><line x1="10" y1="13.5" x2="7.5" y2="19"/><line x1="8.5" y1="9.5" x2="4" y2="8"/></svg>', l: 'Desporto', color:'#F59E0B' }, { ico: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>', l: 'Outros', color:'#64748B' }
];

const ROLE_LABEL = { ADMIN: 'Administrador', SELLER: 'Vendedor', BUYER: 'Comprador', REVENDEDOR: 'Revendedor' };

const STATUS_LABEL = {
  PENDENTE: 'Pendente', ACEITE: 'Aceite', EM_PREPARACAO: 'Em Preparação',
  EM_ENTREGA: 'Em Entrega', ENTREGUE: 'Entregue', CANCELADA: 'Cancelada'
};
const STATUS_BADGE_CLASS = {
  PENDENTE: 'b-amb', ACEITE: 'b-blu', EM_PREPARACAO: 'b-blu',
  EM_ENTREGA: 'b-dark', ENTREGUE: 'b-grn', CANCELADA: 'b-red'
};

const fmtMT = Bazares.Utils.memoize((n) => Number(n || 0).toLocaleString('pt-MZ') + ' MT');

// ─── Tempo relativo ("há 20 minutos", "há 3 dias"...) ───────────────
// Usado nos cartões de produto e na página de detalhe, ao estilo de
// uma rede social: mostra quando o post foi publicado em vez de só
// a data — reforça a sensação de actividade/novidade do mercado.
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'agora mesmo';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'há 1 dia';
  if (diffD < 7) return `há ${diffD} dias`;
  const diffW = Math.floor(diffD / 7);
  if (diffW === 1) return 'há 1 semana';
  if (diffW < 5) return `há ${diffW} semanas`;
  const diffM = Math.floor(diffD / 30);
  if (diffM === 1) return 'há 1 mês';
  if (diffM < 12) return `há ${diffM} meses`;
  const diffY = Math.floor(diffD / 365);
  return diffY === 1 ? 'há 1 ano' : `há ${diffY} anos`;
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('pt-MZ', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Não indicado'; }
function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' }) : ''; }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// esc() (acima) só serve para TEXTO dentro de tags — não escapa aspas,
// por isso não chega para valores metidos dentro de um atributo
// onclick="...". Isto morde sempre que um `slug` (gerado a partir de um
// nome livre, ex.: "Loja da Maria's") entra num `onclick="go('product.
// html',{id:'${p.slug}'})"`: um apóstrofo fecha a string JS a meio,
// parte a chamada, e o clique deixa de levar nenhum id — exactamente o
// bug reportado (produto abre e volta sozinho para a listagem, com o
// URL final sem slug nenhum). escJsAttr() escapa para os DOIS níveis
// de aspas em jogo: a string JS de aspas simples (', \) e o atributo
// HTML de aspas duplas à volta (") que a contém.
function escJsAttr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/[\r\n]/g, '');
}

// Mesma ideia, mas para quando o valor é metido via JSON.stringify()
// dentro de um atributo (ex.: onclick="openShareSheet(...{title:${JSON.
// stringify(p.name)}})") — JSON.stringify() usa sempre aspas DUPLAS,
// que colidem directamente com o atributo HTML à volta (também aspas
// duplas), partindo o atributo mesmo sem nenhum apóstrofo envolvido.
// Uso: title:${escJsonAttr(p.name||'')}
function escJsonAttr(value) {
  return JSON.stringify(value).replace(/"/g, '&quot;');
}

// ─── CLOUDINARY — resolução e qualidade sob pedido ───────────────────
// Insere transformações directamente no URL da imagem (sem depender do
// backend) para pedir uma resolução e qualidade específicas. Se o URL
// não for do Cloudinary, devolve-o sem alterações.
function cldUrl(url, transform) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/${transform}/`);
}

// Atalhos por cima do cldUrl com um preset sensato por defeito: nunca
// manda mais pixels do que o espaço no ecrã precisa (poupa dados e
// acelera o carregamento), mas com dpr_auto/q_auto:best a imagem sai
// mais nítida que o "tamanho fixo cru" que estava a ser usado antes —
// q_auto escolhe a qualidade óptima por imagem e f_auto entrega
// AVIF/WebP quando o browser suporta. Não faz upscaling — só optimiza
// a entrega do que já existe.
const cldImg = Bazares.Utils.memoize((url, width) => {
  return cldUrl(url, `w_${width},dpr_auto,q_auto:best,f_auto,c_limit`);
}, { maxSize: 1000 });
function cldVideo(url, width) {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  // Ordem/valores têm de bater certo com o `eager` gerado no upload
  // (uploadVideoToCloud, backend) para o Cloudinary servir a variante
  // já pronta em cache em vez de a gerar na hora (lento, sobretudo em
  // vídeo) — usa sempre width=1080 aqui, é o único tamanho pré-gerado.
  // q_auto:best (era q_auto:good) — tem de ser IDÊNTICO ao `quality` do
  // eager no backend (uploadService.js). Se um dos dois for alterado
  // sem o outro, deixa de bater com a variante em cache.
  return url.replace('/upload/', `/upload/w_${width},c_limit,q_auto:best,f_auto/`);
}
// Fotograma de poster para o <video> dos Reels — pedido ao próprio
// Cloudinary (primeiro fotograma, como imagem), para nunca aparecer
// um rectângulo preto enquanto o vídeo ainda não carregou.
const cldVideoPoster = Bazares.Utils.memoize((url, width) => {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return '';
  const withTransform = url.replace('/upload/', `/upload/so_0,w_${width},q_auto:good,f_auto,c_limit/`);
  return withTransform.replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg$2');
}, { maxSize: 500 });

// ─── Exportação CSV (Premium: relatório de vendas, inventário) ───────
// `rows` é um array de objectos simples; `headers` mapeia
// {chave: 'Rótulo da Coluna'}. Gera e descarrega directamente, sem
// pedir nada ao backend.
function exportToCSV(filename, headers, rows) {
  const cols = Object.keys(headers);
  const escCsv = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [
    cols.map(c => escCsv(headers[c])).join(';'),
    ...rows.map(r => cols.map(c => escCsv(r[c])).join(';'))
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── Convite de upgrade Premium, reaproveitado sempre que um endpoint
// devolve 403 por a funcionalidade ser exclusiva da Conta Premium. As
// mensagens de erro do backend para estes casos contêm sempre
// "exclusiv" + "Premium" — ver premiumController/productController/chatController.
function isPremiumRequiredError(e) {
  const msg = e?.message || '';
  return msg.includes('Premium') && (msg.includes('exclusiv') || msg.includes('exclusiva'));
}
function showPremiumUpsell(message) {
  openModal(`
    <div style="text-align:center;padding:8px 4px">
      <div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#F59E0B,#F97316);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:#fff">
        ${icon('star',24,2)}
      </div>
      <h3 style="margin-bottom:8px">Funcionalidade Premium</h3>
      <p style="font-size:13px;color:var(--t3);line-height:1.6;margin-bottom:18px">${esc(message || 'Esta funcionalidade é exclusiva da Conta Premium.')}</p>
      <button class="btn btn-primary btn-block" style="background:linear-gradient(135deg,#16A34A,#0d7a37);margin-bottom:8px" onclick="closeModal();go('premium.html')">${icon('star',16,2)} Ver Conta Premium</button>
      <button class="btn btn-ghost btn-block" onclick="closeModal()">Agora não</button>
    </div>
  `);
}

// Fallback for broken/missing product images. Built with DOM APIs (not an inline
// HTML string) so nested quotes in the SVG markup can never break out of the
// onerror="" attribute value, which was the cause of the "Sem foto'">" text bug.
function imgFallback(el, withIcon) {
  const wrap = el.closest('.p-img');
  if (wrap) wrap.classList.add('loaded');
  const span = document.createElement('span');
  span.style.color = 'var(--t4)';
  span.style.fontSize = '12px';
  if (withIcon !== false) {
    span.innerHTML = '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Sem foto';
  } else {
    span.textContent = 'Sem foto';
  }
  el.replaceWith(span);
}

// ─── PASSWORD SHOW/HIDE ──────────────────────────────────────────
// Uso: envolver o <input type="password"> numa <div class="pw-wrap"> e
// colocar a seguir um <button type="button" class="pw-eye" onclick="togglePwField(this)">
// com pwEyeIcon() lá dentro. Reutilizável em qualquer formulário
// (registo, recuperação de senha, alteração de senha, etc.) sem
// duplicar a lógica em cada página.
function pwEyeIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="2.5"/></svg>`;
}
function togglePwField(btn) {
  const input = btn.parentElement?.querySelector('input');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.4 17.4A10.6 10.6 0 0 1 12 19c-7 0-11-7-11-7a19.4 19.4 0 0 1 4.6-5.4M9.9 4.2A10 10 0 0 1 12 4c7 0 11 7 11 7a19.2 19.2 0 0 1-2 2.9M14.1 14.1a3 3 0 1 1-4.2-4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>'
    : pwEyeIcon();
}

function stBadge(status) {
  const cls = STATUS_BADGE_CLASS[status] || 'b-gray';
  const lbl = STATUS_LABEL[status] || status;
  return `<span class="badge ${cls}">${lbl}</span>`;
}

function stars(rating, max = 5) {
  let s = '';
  for (let i = 1; i <= max; i++)
    s += `<span style="color:${i <= Math.round(rating || 0) ? '#F59E0B' : 'var(--brd2)'}"><svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>`;
  return `<span class="stars">${s}</span>`;
}

function avatar(name = '?', size = 38, photoUrl = null) {
  if (photoUrl) {
    const src = cldImg(photoUrl, size * 2);
    return `<img src="${esc(src)}" alt="" class="avatar" loading="lazy" decoding="async" style="width:${size}px;height:${size}px;object-fit:cover">`;
  }
  const AV_COLORS = ['#0B1F3A','#1A6B45','#B91C1C','#7C3AED','#B45309','#0369A1','#0F766E','#BE185D'];
  // Nome vem de dados do utilizador (perfil próprio ou de terceiros) e
  // vai directo para innerHTML mais abaixo — filtra para só letras/dígitos
  // antes de tirar as iniciais, para um nome tipo "<b>x</b>" nunca poder
  // injectar uma tag a meio do <div>, mesmo sendo só 1-2 caracteres.
  const safeName = (name || '?').replace(/[^\p{L}\p{N} ]/gu, '');
  const ini = (safeName || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  // Soma de todos os códigos de carácter do nome (em vez de só o
  // primeiro) — nomes que começam por letras diferentes já não caem
  // sistematicamente na mesma cor por coincidência do módulo.
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash + name.charCodeAt(i) * (i + 1)) % 997;
  const bg = AV_COLORS[hash % AV_COLORS.length];
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * .38)}px">${ini}</div>`;
}

// Lê a foto de uma loja tentando todos os nomes de campo que a API já
// devolveu historicamente (logoUrl/logo_url/imageUrl/image_url). Antes,
// cada página só olhava para um ou dois destes — se o endpoint usado
// nessa página devolvesse o campo com outro nome, a foto real (a mesma
// que já aparece em "Meu Feed") ficava por mostrar e caía no ícone de
// loja genérico. Usar sempre esta função elimina essa inconsistência.
function bazarLogo(b) {
  if (!b) return null;
  return b.logoUrl || b.logo_url || b.imageUrl || b.image_url || null;
}

// ─── Hidrata avatares de loja em falta no feed ──────────────────────
// O objecto "bazar" aninhado que o GET /feed devolve dentro de cada
// item é mais leve do que o de GET /bazars/:id (usado em bazar.html/
// meufeed.html) e por vezes não traz nenhum dos campos de foto que
// bazarLogo() sabe ler — por isso a foto de perfil real (que já
// existe e aparece certinha na própria loja) não aparecia nos
// cartões do feed, caindo sempre no ícone genérico. Em vez de mudar
// o backend (fora deste repo), depois de o feed estar desenhado
// procura, uma única vez por loja (mesmo com vários cartões dela no
// ecrã), a foto real via o endpoint completo e substitui a imagem no
// próprio lugar — sem voltar a desenhar o cartão inteiro.
const _hydratedBazarLogos = {};
async function hydrateFeedAvatars(items) {
  const missing = new Set();
  (items || []).forEach(it => {
    const content = it.targetType === 'PRODUCT' ? it.product : it.announcement;
    const bazar = content?.bazar;
    if (bazar?.id && !bazarLogo(bazar) && !(bazar.id in _hydratedBazarLogos)) missing.add(bazar.id);
  });
  if (!missing.size) return;
  await Promise.all([...missing].map(async id => {
    try {
      const r = await api.get(`/bazars/${id}`);
      _hydratedBazarLogos[id] = bazarLogo(r?.data?.bazar) || null;
    } catch (e) { _hydratedBazarLogos[id] = null; }
  }));
  document.querySelectorAll('[data-fc-avatar]').forEach(el => {
    const id = el.dataset.fcAvatar;
    const photo = _hydratedBazarLogos[id];
    const av = el.querySelector('.avatar');
    if (!photo || !av) return;
    const size = Number(el.dataset.fcSize || 38);
    av.outerHTML = `<img src="${esc(cldImg(photo, size * 2))}" alt="" class="avatar" loading="lazy" decoding="async" style="width:${size}px;height:${size}px;object-fit:cover">`;
  });
}

// ─── Avatar de LOJA ──────────────────────────────────────────────────
// Usado em qualquer sítio que represente um bazar (histórias, cartões
// de produto, etc). Com foto, mostra a foto normalmente. Sem foto, em
// vez de cair em iniciais (pareciam provisórias — "FH", "SE"...) usa
// um ícone de loja elegante, com selo verde de verificado sobreposto
// quando aplicável — ver os dois modelos de referência enviados.
function storeAvatar(name = '', size = 38, photoUrl = null, verified = false) {
  // Paletes de fundo/ícone para o ícone de loja de reserva — sem isto,
  // qualquer loja sem foto usa sempre o mesmo verde, o que faz a faixa
  // de histórias parecer que é sempre a mesma loja a publicar. A cor é
  // derivada do nome, por isso é estável para a mesma loja.
  const STORE_ICON_COLORS = [
    { bg: 'var(--b-50)', fg: 'var(--b-600)' },
    { bg: '#FDECE3', fg: '#C2530F' },
    { bg: '#FCE4EC', fg: '#BE185D' },
    { bg: '#EDE7F6', fg: '#7C3AED' },
    { bg: '#E0F2F1', fg: '#0F766E' },
    { bg: '#FEF3C7', fg: '#B45309' },
    { bg: '#E3F2FD', fg: '#0369A1' },
    { bg: '#FDECEA', fg: '#B91C1C' }
  ];
  const inner = photoUrl
    ? `<img src="${esc(cldImg(photoUrl, size * 2))}" alt="" class="avatar" loading="lazy" decoding="async" style="width:${size}px;height:${size}px;object-fit:cover">`
    : (() => {
        const ic = Math.round(size * .52);
        let hash = 0;
        for (let i = 0; i < (name || '').length; i++) hash = (hash + name.charCodeAt(i) * (i + 1)) % 997;
        const c = STORE_ICON_COLORS[hash % STORE_ICON_COLORS.length];
        return `<div class="avatar store-avatar" style="width:${size}px;height:${size}px;background:${c.bg};color:${c.fg};display:flex;align-items:center;justify-content:center">
          <svg width="${ic}" height="${ic}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9.5 4.2 3h15.6l1.2 6.5"/>
            <path d="M3 9.5a2.3 2.3 0 0 0 4.4 1 2.3 2.3 0 0 0 4.4 0 2.3 2.3 0 0 0 4.4 0 2.3 2.3 0 0 0 4.4-1"/>
            <path d="M4.5 10.2V20a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-9.8"/>
            <path d="M9.5 21v-5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21"/>
          </svg>
        </div>`;
      })();
  if (!verified || size < 26) return inner;
  const badge = Math.max(13, Math.round(size * .32));
  return `<div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0">${inner}<span style="position:absolute;bottom:-1px;right:-1px;width:${badge}px;height:${badge}px;border-radius:50%;background:var(--b-500);border:2px solid var(--surf);display:flex;align-items:center;justify-content:center;color:#fff"><svg width="${Math.round(badge*.56)}" height="${Math.round(badge*.56)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span></div>`;
}

// Devolve a URL da foto de perfil do utilizador, ou null se não tiver
// (nesse caso quem chama cai no fallback avatar() com iniciais).

// ─── Visualizador de imagens em ecrã inteiro ─────────────────────────
// Usado em qualquer foto que valha a pena ver em grande: fotos de
// produtos, logotipo/capa de um bazar, fotos de perfil de outros
// utilizadores, fotos de posts no feed, etc.
// Aceita um único URL (openImageLightbox(url)) ou uma galeria completa
// com o índice inicial (openImageLightbox([url1,url2,...], idx)) — nesse
// caso mostra setas para navegar entre as fotos, tal como um carrossel
// do Instagram. Tem sempre um botão de descarregar a foto.
function openImageLightbox(urlOrList, startIndex) {
  const images = Array.isArray(urlOrList) ? urlOrList.filter(Boolean) : [urlOrList].filter(Boolean);
  if (!images.length) return;
  let idx = Math.min(Math.max(startIndex || 0, 0), images.length - 1);
  _bzReplaceOverlayRoot('img-lightbox-root');
  const div = document.createElement('div');
  div.id = 'img-lightbox-root';
  div.style.cssText = 'position:fixed;inset:0;background:rgba(6,10,20,.94);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn .15s ease';
  const arrowBtnCss = 'position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.12);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer';
  const render = () => {
    div.innerHTML = `
      <button aria-label="Fechar" class="lb-close" style="position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.12);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2">
        <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <button aria-label="Descarregar foto" class="lb-download" style="position:absolute;top:16px;right:64px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.12);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2">
        <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><polyline points="7 12 12 17 17 12"/><path d="M5 21h14"/></svg>
      </button>
      ${images.length > 1 ? `
      <button aria-label="Foto anterior" class="lb-prev" style="${arrowBtnCss};left:8px;z-index:2"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
      <button aria-label="Foto seguinte" class="lb-next" style="${arrowBtnCss};right:8px;z-index:2"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div style="position:absolute;bottom:22px;left:50%;transform:translateX(-50%);color:#fff;font-size:12.5px;font-weight:600;background:rgba(255,255,255,.14);padding:4px 12px;border-radius:99px;z-index:2">${idx + 1}/${images.length}</div>` : ''}
      <img src="${esc(images[idx])}" alt="" decoding="async" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:10px">
    `;
    div.querySelector('.lb-close').onclick = () => _bzCloseOverlayEl(div);
    div.querySelector('.lb-download').onclick = (e) => { e.stopPropagation(); downloadImageUrl(images[idx]); };
    if (images.length > 1) {
      div.querySelector('.lb-prev').onclick = (e) => { e.stopPropagation(); idx = (idx - 1 + images.length) % images.length; render(); };
      div.querySelector('.lb-next').onclick = (e) => { e.stopPropagation(); idx = (idx + 1) % images.length; render(); };
    }
  };
  render();
  div.addEventListener('click', e => { if (e.target === div) _bzCloseOverlayEl(div); });
  document.addEventListener('keydown', function onKey(e){
    if(e.key==='Escape'){ _bzCloseOverlayEl(div); document.removeEventListener('keydown', onKey); }
    else if(e.key==='ArrowLeft' && images.length>1){ idx=(idx-1+images.length)%images.length; render(); }
    else if(e.key==='ArrowRight' && images.length>1){ idx=(idx+1)%images.length; render(); }
  });
  document.body.appendChild(div);
  _bzOpenOverlay();
}

// Descarrega uma foto do feed/produto/reel. Para fotos no Cloudinary
// usa fl_attachment (o próprio Cloudinary devolve o ficheiro com
// Content-Disposition: attachment); para outros URLs abre-a numa nova
// aba como alternativa, já que o atributo download é ignorado pelo
// browser em imagens de outra origem sem esse cabeçalho.
function downloadImageUrl(url) {
  if (!url) return;
  const dlUrl = (url.includes('res.cloudinary.com') && url.includes('/upload/'))
    ? url.replace('/upload/', '/upload/fl_attachment/')
    : url;
  const a = document.createElement('a');
  a.href = dlUrl;
  a.download = '';
  a.rel = 'noopener';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openVideoLightbox(url) {
  if (!url) return;
  _bzReplaceOverlayRoot('img-lightbox-root');
  const div = document.createElement('div');
  div.id = 'img-lightbox-root';
  div.style.cssText = 'position:fixed;inset:0;background:rgba(6,10,20,.94);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn .15s ease';
  div.innerHTML = `
    <button aria-label="Fechar" style="position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.12);border:none;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer">
      <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <video src="${esc(url)}" controls autoplay playsinline style="max-width:100%;max-height:100%;border-radius:10px"></video>
  `;
  div.querySelector('button').addEventListener('click', () => _bzCloseOverlayEl(div));
  div.addEventListener('click', e => { if (e.target === div) _bzCloseOverlayEl(div); });
  document.addEventListener('keydown', function onEsc(e){ if(e.key==='Escape'){ _bzCloseOverlayEl(div); document.removeEventListener('keydown', onEsc); } });
  document.body.appendChild(div);
  _bzOpenOverlay();
}

// Folha de acções para a foto de perfil do próprio utilizador: ver em
// grande ou trocar. onChangeClick deve accionar o input file escondido.
function openOwnPhotoSheet(url, onChangeClick) {
  const item = (iconName, title, onclick) => `
    <button class="btn-ghost" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px;border-radius:var(--r);border:1px solid var(--brd)" onclick="${onclick}">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--b-50);color:var(--g-green);display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon(iconName, 18)}</div>
      <div style="font-weight:700;font-size:13.5px">${title}</div>
    </button>`;
  openModal(`
    <div class="modal-hd"><h3>Foto de perfil</h3><button class="modal-x" onclick="closeModal()">${icon('close',18,2)}</button></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${url ? item('image', 'Ver foto de perfil', `closeModal();openImageLightbox('${esc(url)}')`) : ''}
      ${item('camera', 'Trocar foto de perfil', `closeModal();__ownPhotoChange()`)}
    </div>
  `);
  window.__ownPhotoChange = () => { closeModal(); onChangeClick(); };
}

// ─── SELECTOR VISUAL DE PAGAMENTO ───────────────────────────────────
// Cartões grandes e reconhecíveis em vez de um <select> nativo — mais
// fáceis de usar com o dedo e mais claros para quem não é técnico.
const PAY_OPTIONS = [
  { v: 'Pagamento na entrega', icon: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>' },
  { v: 'M-Pesa', icon: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>' },
  { v: 'e-Mola', icon: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>' },
  { v: 'Mkesh', icon: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' },
  { v: 'Transferência Bancária', icon: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="21" x2="21" y2="21"/><line x1="5" y1="21" x2="5" y2="10"/><line x1="9" y1="21" x2="9" y2="10"/><line x1="15" y1="21" x2="15" y2="10"/><line x1="19" y1="21" x2="19" y2="10"/><polygon points="12 3 3 8 21 8"/></svg>' },
];
function payGridHtml(name, selected) {
  selected = selected || PAY_OPTIONS[0].v;
  return `<div class="pay-grid" role="radiogroup" aria-label="Método de pagamento">${PAY_OPTIONS.map(o => `
    <label class="pay-opt${o.v === selected ? ' checked' : ''}">
      <input type="radio" name="${name}" value="${esc(o.v)}"${o.v === selected ? ' checked' : ''} onchange="selectPayOption(this)">
      ${o.icon}<span>${esc(o.v)}</span>
    </label>`).join('')}</div>`;
}
function selectPayOption(radio) {
  const grid = radio.closest('.pay-grid');
  grid.querySelectorAll('.pay-opt').forEach(l => l.classList.remove('checked'));
  radio.closest('.pay-opt').classList.add('checked');
}
function getPayGridValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || PAY_OPTIONS[0].v;
}

// NOTA: esta função estava a ser chamada em dashboard.html e profile.html
// mas nunca tinha sido definida em lado nenhum — isso causava um
// ReferenceError não apanhado ao montar o dashboard do vendedor, que
// interrompia o render depois dos dados já terem chegado da API,
// deixando o spinner preso no ecrã para sempre.
function userPhoto(user) {
  return user?.avatarUrl || null;
}

// ─── ICON SYSTEM (outline, stroke-based — substitui emojis na UI de navegação) ──
// Uso: icon('bell', 18) devolve um <svg> inline herdando currentColor.
const ICONS = {
  undo:        '<path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 1 2.6 6.4"/>',
  redo:        '<path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 0-2.6 6.4"/>',
  menu:        '<path d="M4 6h16M4 12h16M4 18h16"/>',
  bell:        '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  cart:        '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  user:        '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  userMinus:   '<circle cx="9" cy="8" r="4"/><path d="M1 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/><line x1="17" y1="11" x2="23" y2="11"/>',
  slash:       '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  moon:        '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  home:        '<path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10h14V10"/>',
  store:       '<path d="M3 9 4.5 4h15L21 9"/><path d="M3 9v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9"/><path d="M3 9h18"/><path d="M9 20v-6h6v6"/>',
  box:         '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  tag:         '<path d="M20.6 12.6 12.6 20.6a2 2 0 0 1-2.8 0L3 13.8V3h10.8l6.8 6.8a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/>',
  grid:        '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  chat:        '<path d="M21 11.5a8.4 8.4 0 0 1-1.1 4.2L21 20l-4.4-1.1a8.5 8.5 0 1 1 4.4-7.4Z"/>',
  wallet:      '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 14.5h2"/>',
  link:        '<path d="M9 13a4.5 4.5 0 0 0 6 0l3-3a4.5 4.5 0 1 0-6-6l-1 1"/><path d="M15 11a4.5 4.5 0 0 0-6 0l-3 3a4.5 4.5 0 1 0 6 6l1-1"/>',
  heart:       '<path d="M12 20.5s-7.5-4.6-10-9.3C0.3 7.8 1.8 4 5.6 3.4 8 3 10 4 12 6.5 14 4 16 3 18.4 3.4 22.2 4 23.7 7.8 22 11.2 19.5 15.9 12 20.5 12 20.5Z"/>',
  settings:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  support:     '<circle cx="12" cy="12" r="9"/><path d="M12 16v-1.5c0-1 .6-1.5 1.3-2 .8-.6 1.4-1.1 1.4-2.1A2.7 2.7 0 0 0 12 7.7a2.7 2.7 0 0 0-2.7 2.7"/><circle cx="12" cy="18.3" r="0.6" fill="currentColor" stroke="none"/>',
  logout:      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  pulse:       '<path d="M3 12h4l2 8 4-16 2 8h6"/>',
  flag:        '<path d="M5 21V4"/><path d="M5 4h14l-3 4 3 4H5"/>',
  megaphone:   '<path d="M3 11v2a2 2 0 0 0 2 2h1l3 5 1-5h2l8 4V6l-8 4H6a2 2 0 0 0-2 2v-1"/>',
  bars:        '<path d="M5 21V10"/><path d="M12 21V4"/><path d="M19 21v-7"/>',
  clipboard:   '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 11h6"/><path d="M9 15h6"/>',
  envelope:    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  sparkle:     '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  percent:     '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  calendar:    '<rect x="3" y="4.5" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/>',
  pencil:      '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  bulb:        '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.3 1 2.3h6c0-1 .3-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
  folder:      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  lock:        '<rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/>',
  trash:       '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/>',
  alertTriangle: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  helpCircle: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  refresh:     '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  flame:       '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  trophy:      '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 6h3a2 2 0 0 1-2 4M7 6H4a2 2 0 0 0 2 4"/>',
  star:        '<path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7-5.4-4.7 7.1-.7z"/>',
  check:       '<path d="M20 6 9 17l-5-5"/>',
  clock:       '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  close:       '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  qrcode:      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1v1h-1zM14 20h1v1h-1zM18 18h3v3h-3z"/>',
  image:       '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  camera:      '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  compass:     '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" stroke="none"/>',
  pin:         '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  arrowRight:  '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  play:        '<polygon points="6 3 20 12 6 21 6 3"/>',
  video:       '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M23 7l-7 5 7 5V7z"/>',
  share:       '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  plus:        '<path d="M12 5v14M5 12h14"/>',
  bookmark:    '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
  volumeOn:    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  volumeOff:   '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  send:        '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  more:        '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  eye:         '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:      '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.6 20.6 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a20.6 20.6 0 0 1-3.22 4.42"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  // ── Reacções (estilo Facebook) — Gosto/Riso/Uau/Triste/Ira/Coragem;
  // "Adoro" continua a usar o ícone `heart` já existente acima. ──────
  thumbsUp:    '<path d="M7 11v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3z"/><path d="M7 11l4.5-8a2 2 0 0 1 2 2l-1 5h5.5a2 2 0 0 1 2 2.4l-1.6 7A2 2 0 0 1 16.4 21H10a3 3 0 0 1-3-3"/>',
  // Riso/Uau/Triste/Ira deixaram de ser caras redondas com "olhinhos"
  // (ficavam com ar de emoji de desenho animado) — agora são símbolos
  // abstratos únicos, ao estilo Apple Tapback: mais discretos e премium.
  laugh:       '<path d="M5 10c0 3.9 3.1 7 7 7s7-3.1 7-7"/><path d="M5 10c0-1 .8-1.5 1.6-1M19 10c0-1-.8-1.5-1.6-1"/>',
  wow:         '<circle cx="12" cy="13" r="3.4"/><path d="M12 5.5v2.4"/>',
  sad:         '<path d="M5 15c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
  angry:       '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  muscle:      '<path d="M2.5 14.2c1-.9 2.3-1 3.2.1l.9 1.1c.5-2.1 2-3.8 4.1-4.6V7.3a1.8 1.8 0 0 1 1.8-1.8h.8a1.8 1.8 0 0 1 1.8 1.8v1.4c1.5-.2 3 .3 3.9 1.5.9 1.1 1.2 2.5.8 3.9l-.7 2.7a3 3 0 0 1-2.9 2.2H10a4 4 0 0 1-3-1.4l-3.3-3.7"/>',
};
const icon = Bazares.Utils.memoize((name, size = 18, strokeWidth = 1.8) => {
  const body = ICONS[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" style="display:block">${body}</svg>`;
});

// ─── BOTTOM TAB NAVIGATION (mobile) ──────────────────────────────────
// Barra fixa inferior, no estilo de apps nativos. `active` é a chave da
// aba corrente (home|categorias|vender|chat|perfil); `role` decide para
// onde o botão central "Vender" leva, já que cada tipo de conta tem uma
// ação central diferente.
function _bnCenterTarget(role) {
  if (role === 'SELLER') return () => openCreateSheet();
  if (role === 'REVENDEDOR') return () => go('referrals.html');
  return () => go('my-bazar.html'); // BUYER/ADMIN: convida a começar a vender
}

// ─── Folha de criação unificada ("+" central da barra inferior) ─────
// Ao estilo Instagram/Facebook: um único botão de publicar que depois
// pergunta o quê. Quatro coisas diferentes, com nomes e descrições que
// não se confundem entre si:
//   • Post  — uma publicação de texto/foto no feed (novidade, promoção)
//   • Produto  — um artigo à venda na loja (fotos, preço, categoria)
//   • História — uma foto que desaparece em 24h
//   • Reel     — um vídeo curto vertical, ao estilo Instagram/TikTok
// As quatro estão disponíveis para qualquer vendedor; só precisam de já
// ter um bazar criado (Post, História e Reel publicam-se dentro do bazar).
async function openCreateSheet() {
  let hasBazar = false;
  try {
    hasBazar = !!(await api.get('/bazars/me'))?.data?.bazar;
  } catch (e) { /* ainda não criou o bazar — leva a criar primeiro */ }

  const item = (iconName, title, subtitle, onclick) => `
    <button class="cs-item" onclick="${onclick}">
      <div class="cs-item-ico">${icon(iconName, 22)}</div>
      <div class="cs-item-body"><div class="cs-item-title">${title}</div><div class="cs-item-sub">${subtitle}</div></div>
      <svg class="cs-item-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

  const goOrSetup = (dest) => hasBazar ? `closeModal();go(${dest})` : "closeModal();go('my-bazar.html')";

  openModal(`
    <div class="modal-hd"><h3>O que queres publicar?</h3><button class="modal-x" onclick="closeModal()">${icon('close', 18, 2)}</button></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${item('megaphone', 'Post', 'Uma publicação no feed — texto e foto, para os teus seguidores verem', goOrSetup("'anuncio.html'"))}
      ${item('box', 'Produto', 'Um artigo à venda na tua loja — fotos, preço e categoria', "closeModal();go('novoproduto.html')")}
      ${item('clock', 'História', 'Uma foto que desaparece em 24 horas', goOrSetup("'historia.html'"))}
      ${item('video', 'Reel', 'Um vídeo curto vertical — aparece nos Reels', goOrSetup("'newreels.html'"))}
    </div>
  `);
}
function renderBottomNav(active = 'home', role = 'BUYER', unread = 0) {
  const item = (key, label, iconName, href) => `
    <button class="bn-item${active === key ? ' active' : ''}" onclick="go('${href}')" aria-label="${label}">
      ${key === 'chat' && unread ? `<span class="badge-dot">${unread}</span>` : ''}
      ${icon(iconName, 21)}<span>${label}</span>
    </button>`;
  return `
    <nav class="bottom-nav">
      ${item('home', 'Início', 'home', 'home.html')}
      ${item('descobrir', 'Descobrir', 'compass', 'explorar.html')}
      <button class="bn-item bn-item-main" onclick="_bnGoCenter()" aria-label="Vender">
        <div class="bn-item-main-ico">+</div><span>Vender</span>
      </button>
      ${item('chat', 'Mensagens', 'chat', 'chat.html')}
      ${item('perfil', 'Perfil', 'user', 'profile.html')}
    </nav>`;
}
let _bnRole = 'BUYER';
function _bnGoCenter() { _bnCenterTarget(_bnRole)(); }
function mountBottomNav(active, role, unread = 0) {
  _bnRole = role;
  document.body.classList.add('has-bottom-nav');
  let root = document.getElementById('bottom-nav-root');
  if (!root) { root = document.createElement('div'); root.id = 'bottom-nav-root'; document.body.appendChild(root); }
  root.innerHTML = renderBottomNav(active, role, unread);
}

// ─── BRAND MARK (loja/bazar — assinatura visual Bazares) ────────────────────
// Redesenho premium: toldo de loja (awning) com listras em verde/dourado
// sobre uma fachada simples com porta — lê-se como "loja" mesmo em tamanhos
// pequenos (favicon, avatar de app), mantendo a paleta da marca.
function brandMark(size = 38) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 76 76" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0">
    <defs>
      <linearGradient id="bzMarkGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#00E043"/><stop offset="1" stop-color="#00B837"/>
      </linearGradient>
      <clipPath id="bzMarkClip"><rect width="76" height="76" rx="19"/></clipPath>
    </defs>
    <rect width="76" height="76" rx="19" fill="url(#bzMarkGrad)"/>
    <g clip-path="url(#bzMarkClip)">
      <!-- toldo (awning) com listras alternadas -->
      <path d="M14 30 17 17a4 4 0 0 1 4-3h30a4 4 0 0 1 4 3l3 13z" fill="#fff"/>
      <path d="M17.6 30 21 17h6l-2 13z" fill="#F59E0B"/>
      <path d="M31 30l2-13h6l-1 13z" fill="#00922F"/>
      <path d="M38 30l1-13h6l1 13z" fill="#F59E0B"/>
      <path d="M46 30l-1-13h6l3 13z" fill="#00922F"/>
      <path d="M14 30h48v3.4a2.6 2.6 0 0 1-2.6 2.6H16.6A2.6 2.6 0 0 1 14 33.4z" fill="#fff"/>
    </g>
    <!-- fachada -->
    <path d="M19 36v20a3 3 0 0 0 3 3h30a3 3 0 0 0 3-3V36" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M31 59V47a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// Versão compacta do símbolo (sem retângulo de fundo), para uso sobre
// superfícies que já têm a cor de marca — ex. rodapé escuro.
function brandGlyph(size = 24, color = '#fff') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0">
    <path d="M4 9.5 5 4h14l1 5.5"/>
    <path d="M4 9.5h16v1.3A1.7 1.7 0 0 1 18.3 12.5H5.7A1.7 1.7 0 0 1 4 10.8Z"/>
    <path d="M6 12.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6.5"/>
    <path d="M10 20v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4"/>
  </svg>`;
}

// ─── TOAST ──────────────────────────────────────────────────────
// Banner no topo do ecrã: ícone animado (chip colorido, com um
// pequeno "pop" de entrada — confetti extra no tipo "ok") à
// esquerda, mensagem clara ao lado e um botão fechar (X) — sem
// barra de progresso. Desaparece sozinho ao fim de `dur` (fade
// suave), ou logo ao tocar no X / arrastar na horizontal.
function toast(msg, type = 'ok', dur = 3800) {
  let root = document.getElementById('toast-root');
  if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
  const icons = {
    ok:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    err:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  const el = document.createElement('div');
  el.className = `toast t-${type} toast-el`;
  el.innerHTML = `<span class="t-ico">${icons[type] || icons.ok}</span><span class="t-msg">${msg}</span><button type="button" class="t-close" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;

  const dismiss = (swipeTx) => {
    if (el._dismissed) return;
    el._dismissed = true;
    if (swipeTx != null) {
      el.style.setProperty('--tx', swipeTx > 0 ? '120%' : '-120%');
      el.style.animation = 'toastSwipeOut .22s ease forwards';
    } else {
      el.classList.add('leaving');
    }
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  // Deslizar (arrastar) na horizontal para dispensar mais depressa.
  let startX = null, curX = 0, dragging = false;
  const onStart = (x) => { startX = x; dragging = true; el.style.transition = 'none'; };
  const onMove = (x) => {
    if (!dragging || startX == null) return;
    curX = x - startX;
    el.style.transform = `translateX(${curX}px)`;
    el.style.opacity = String(Math.max(1 - Math.abs(curX) / 140, .15));
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(curX) > 70) { dismiss(curX); return; }
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
  };
  el.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX), { passive: true });
  el.addEventListener('touchmove',  (e) => onMove(e.touches[0].clientX),  { passive: true });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('click', (e) => { if (!dragging && Math.abs(curX) < 4 && !e.target.closest('.t-close')) dismiss(); });
  el.querySelector('.t-close').addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });

  root.appendChild(el);
  setTimeout(() => dismiss(), dur);
}

// ─── MODAL MANAGER ──────────────────────────────────────────────
// Bazares.Modal formaliza o que openModal()/closeModal() já faziam,
// e acrescenta uma coisa que faltava: empilhamento a sério. Antes,
// abrir um confirmDialog() por cima de um modal já aberto SUBSTITUÍA
// o conteúdo desse modal (mesmo <div id="modal-root">) — ao fechar a
// confirmação, o modal original desaparecia com ela, mesmo que o
// utilizador só quisesse confirmar algo e voltar ao formulário.
// Agora confirm() (usado por confirmDialog) abre numa camada própria,
// por cima de tudo o que já estiver aberto — fechar essa camada volta
// a mostrar exactamente o que lá estava antes.
// openModal()/closeModal()/confirmDialog() continuam a existir tal
// como sempre existiram (ver o resto da app, 60+ chamadas) — são só
// invólucros finos à volta disto, para não obrigar a mudar nada mais.
// ─── MODAL / SURFACE MANAGER ────────────────────────────────────
// Bazares.Modal é o motor por baixo de TODAS as superfícies flutuantes
// da app — diálogos centrados (o que já existia), e agora também
// drawers (gaveta lateral) e bottom sheets (folha que sobe de baixo).
// Todas partilham o mesmo empilhamento, fundo escuro e integração com
// o histórico (voltar atrás fecha a de cima) — só mudam a "moldura"
// visual à volta do conteúdo. openModal()/closeModal()/confirmDialog()
// continuam a existir tal como sempre (60+ chamadas na app) — o resto
// desta fase (Bazares.Dialog/Drawer/Sheet, mais abaixo) são só nomes
// mais explícitos para o mesmo motor.
Bazares.Modal = (() => {
  const stack = []; // camadas empilhadas (stack:true) — modal-root não entra aqui

  const VARIANTS = {
    dialog: (html, large) => `<div class="modal-bd"><div class="modal${large ? ' modal-lg' : ''}" role="dialog" aria-modal="true">${html}</div></div>`,
    'drawer-left': (html) => `<div class="drawer-bd drawer-left"><div class="drawer-panel" role="dialog" aria-modal="true">${html}</div></div>`,
    'drawer-right': (html) => `<div class="drawer-bd drawer-right"><div class="drawer-panel" role="dialog" aria-modal="true">${html}</div></div>`,
    sheet: (html) => `<div class="sheet-bd"><div class="sheet-panel" role="dialog" aria-modal="true"><div class="sheet-drag-handle" aria-hidden="true"></div>${html}</div></div>`
  };
  const BACKDROP_SEL = '.modal-bd, .drawer-bd, .sheet-bd';

  // Bottom sheets ganham arrastar-para-fechar pelo puxador — gesto
  // mínimo, só para este caso (o Touch Gestures genérico fica para
  // outra fase). Arrastar >90px ou com velocidade alta fecha; menos
  // do que isso volta à posição.
  function _attachSheetDrag(panel, onClose) {
    const handle = panel.querySelector('.sheet-drag-handle');
    if (!handle) return;
    let startY = null, lastY = 0, lastT = 0, velocity = 0;
    const onStart = (y) => { startY = y; lastY = y; lastT = Date.now(); panel.style.transition = 'none'; };
    const onMove = (y) => {
      if (startY == null) return;
      const dy = Math.max(0, y - startY);
      const now = Date.now();
      const dt = now - lastT || 16;
      velocity = (y - lastY) / dt;
      lastY = y; lastT = now;
      panel.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = () => {
      if (startY == null) return;
      const dy = Math.max(0, lastY - startY);
      panel.style.transition = '';
      if (dy > 90 || velocity > 0.6) { onClose(); }
      else { panel.style.transform = ''; }
      startY = null;
    };
    handle.addEventListener('touchstart', (e) => onStart(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchmove', (e) => onMove(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchend', onEnd);
  }

  // Remove só a camada do topo, SEM mexer no histórico — usado pelo
  // "closer" registado no History Manager (chamado depois do browser
  // já ter consumido a entrada de histórico sozinho, ao voltar atrás).
  function _removeTopLayer() {
    if (stack.length) { stack.pop().remove(); return true; }
    const r = document.getElementById('modal-root');
    if (r && r.innerHTML.trim()) { r.innerHTML = ''; return true; }
    return false;
  }

  function open(html, opts = {}) {
    const { large = false, stack: doStack = false, variant = 'dialog' } = opts;
    const build = VARIANTS[variant] || VARIANTS.dialog;
    if (doStack) {
      const layer = document.createElement('div');
      layer.className = 'modal-root-layer';
      layer.innerHTML = build(html, large);
      const bd = layer.querySelector(BACKDROP_SEL);
      bd.addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
      if (variant === 'sheet') _attachSheetDrag(layer.querySelector('.sheet-panel'), close);
      document.body.appendChild(layer);
      stack.push(layer);
      Bazares.History.openOverlay();
      return;
    }
    let root = document.getElementById('modal-root');
    if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.appendChild(root); }
    const wasEmpty = !root.innerHTML.trim(); // troca de conteúdo com o modal já aberto não deve empilhar outra entrada de histórico
    root.innerHTML = build(html, large);
    root.querySelector(BACKDROP_SEL).addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
    if (variant === 'sheet') _attachSheetDrag(root.querySelector('.sheet-panel'), close);
    if (wasEmpty) Bazares.History.openOverlay();
  }

  // Fecho explícito (botão, ESC, toque fora) — consome a entrada de
  // histórico que a abertura tinha armado.
  function close() {
    if (_removeTopLayer()) Bazares.History.consumeOverlayGuard();
  }

  function isOpen() {
    return stack.length > 0 || !!document.getElementById('modal-root')?.innerHTML.trim();
  }

  // Substitui o confirm() nativo do browser — devolve Promise<boolean>.
  // Empilha por defeito (stack:true): pode ser chamado com um modal já
  // aberto por baixo sem o perder.
  function confirm(message, opts = {}) {
    const {
      title = 'Confirmar ação',
      confirmLabel = 'Confirmar',
      cancelLabel = 'Cancelar',
      danger = false,
    } = opts;
    return new Promise((resolve) => {
      const cleanup = (val) => { close(); resolve(val); };
      const html = `<div class="card" style="max-width:380px;text-align:center;padding:28px 24px">
        <div style="width:46px;height:46px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;background:${danger ? 'rgba(238,20,20,.1)' : 'var(--b-50)'};color:${danger ? 'var(--r-500)' : 'var(--g-green)'}">
          ${icon(danger ? 'alertTriangle' : 'helpCircle', 22, 2)}
        </div>
        <h3 style="margin-bottom:8px">${esc(title)}</h3>
        <p style="font-size:13px;color:var(--t3);line-height:1.5;margin-bottom:22px">${esc(message)}</p>
        <div style="display:flex;gap:10px">
          <button type="button" class="btn btn-ghost" style="flex:1" onclick="window.__confirmDialogResolve(false)">${esc(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" style="flex:1" onclick="window.__confirmDialogResolve(true)">${esc(confirmLabel)}</button>
        </div>
      </div>`;
      window.__confirmDialogResolve = (val) => { delete window.__confirmDialogResolve; cleanup(val); };
      open(html, { stack: true });
    });
  }

  return { open, close, isOpen, confirm, _removeTopLayer };
})();

// Fecha a camada de modal aberta (a que estiver mais por cima) ao
// premir Escape — não existia antes (só os lightboxes tinham isto).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && Bazares.Modal.isOpen()) Bazares.Modal.close();
});

// Regista-se no History Manager (runtime.js) para o botão/gesto voltar
// continuar a fechar o modal antes de sair da página — mesmo mecanismo
// dos outros overlays, ver Bazares.History.registerOverlayCloser.
Bazares.History.registerOverlayCloser('modal', () => Bazares.Modal.isOpen(), () => Bazares.Modal._removeTopLayer());

function openModal(html, large = false) { Bazares.Modal.open(html, { large }); }
function closeModal() { Bazares.Modal.close(); }

// ─── DIALOGS / DRAWERS / BOTTOM SHEETS ──────────────────────────
// Nomes explícitos para os três "moldura" que Bazares.Modal sabe
// desenhar — cada um chama-se pelo que É, em vez de tudo continuar a
// aparecer como "modal" no código de quem o usa. Todos herdam
// empilhamento, fundo escuro, Escape e integração com o botão voltar
// do Bazares.Modal — não há nada novo a aprender além do nome.
Bazares.Dialog = {
  open: (html, opts = {}) => Bazares.Modal.open(html, { ...opts, variant: 'dialog' }),
  close: () => Bazares.Modal.close(),
  confirm: (message, opts) => Bazares.Modal.confirm(message, opts)
};

// side: 'left' (por defeito) ou 'right'. Empilha sempre (stack:true)
// — uma gaveta de navegação normalmente abre por cima do que já lá
// está, nunca o substitui.
Bazares.Drawer = {
  open: (html, opts = {}) => Bazares.Modal.open(html, { ...opts, stack: true, variant: opts.side === 'right' ? 'drawer-right' : 'drawer-left' }),
  close: () => Bazares.Modal.close()
};

// Folha que sobe do fundo do ecrã, com puxador arrastável para
// fechar. Substitui o padrão antigo de meter `.sheet-handle`/`.sheet-
// list` dentro de um modal centrado (ver openFeedKebab mais abaixo,
// já convertido) — visualmente o correcto (ancorado ao fundo, não ao
// centro do ecrã) e ganha o arrastar-para-fechar de borla.
Bazares.Sheet = {
  open: (html, opts = {}) => Bazares.Modal.open(html, { ...opts, stack: true, variant: 'sheet' }),
  close: () => Bazares.Modal.close()
};

// ─── CONFIRMAÇÃO ESTILIZADA ────────────────────────────────────────
// Substitui o confirm() nativo do browser (feio e inconsistente em
// PWA/iOS) por um modal com a identidade visual da app. Devolve uma
// Promise<boolean>, para poder usar-se como `if (!await confirmDialog(...)) return;`
// exactamente como o confirm() nativo.
function confirmDialog(message, opts = {}) { return Bazares.Modal.confirm(message, opts); }

// ─── BOTÃO/GESTO VOLTAR DO ANDROID vs. OVERLAYS ────────────────────
// Sem isto, o botão/gesto voltar do telemóvel saía sempre da app,
// mesmo com uma foto/lightbox ou modal aberto por cima da página.
// Truque: sempre que um overlay abre, empurramos uma entrada extra no
// histórico (mesmo URL); o botão voltar consome essa entrada primeiro
// (fechando só o overlay) antes de alguma vez sair da página. Se o
// overlay for fechado pelo próprio botão "X" (não pelo voltar), também
// consumimos essa entrada nós próprios, para não deixar um "voltar
// morto" pendente. Na Home, sem nada aberto, o voltar passa a pedir
// confirmação em vez de sair logo da app.
let _bzSuppressNextPopstate = false;
let _bzExitConfirmed = false;
function _bzOpenOverlay() {
  history.pushState({ bzOverlay: true }, '', location.href);
}
function _bzConsumeOverlayGuard() {
  if (history.state && history.state.bzOverlay) {
    _bzSuppressNextPopstate = true;
    history.back();
  }
}
// Remove o nó do overlay da página E consome a entrada de histórico que
// ele tinha aberto — usar isto em vez de `el.remove()` directo em
// qualquer botão "Fechar"/toque-fora/Escape de um overlay guardado.
function _bzCloseOverlayEl(el) {
  el?.remove();
  _bzConsumeOverlayGuard();
}
// Usado no início de openImageLightbox/openVideoLightbox para limpar uma
// instância anterior (troca directa foto→vídeo, etc.) sem deixar uma
// entrada de histórico órfã por trás — se já existia um destes overlays
// aberto, a entrada que ele tinha armado é consumida aqui também.
function _bzReplaceOverlayRoot(id) {
  const existing = document.getElementById(id);
  if (existing) { existing.remove(); _bzConsumeOverlayGuard(); }
}
// Fecha o overlay visível de maior prioridade (o mais "por cima"),
// sem mexer no histórico — chamado quando é o PRÓPRIO botão voltar a
// disparar o fecho (o browser já geriu o histórico sozinho nesse caso).
// Os "closers" por defeito, um por overlay conhecido, registados no
// Bazares.History (runtime.js) por ordem de prioridade — o mesmo
// comportamento de sempre, só que agora um overlay novo regista-se
// com Bazares.History.registerOverlayCloser(...) em vez de crescer
// este ficheiro. closeTopmostOverlay() fica como alias fino, porque
// é chamada directamente nalguns sítios da app.
Bazares.History.registerOverlayCloser('post-viewer',
  () => !!document.getElementById('post-viewer-root'),
  () => document.getElementById('post-viewer-root').remove());
Bazares.History.registerOverlayCloser('img-lightbox',
  () => !!document.getElementById('img-lightbox-root'),
  () => document.getElementById('img-lightbox-root').remove());
Bazares.History.registerOverlayCloser('share-sheet',
  () => !!document.getElementById('share-sheet-root'),
  () => document.getElementById('share-sheet-root').remove());
Bazares.History.registerOverlayCloser('comments',
  () => !!document.getElementById('cmts-root'),
  () => {
    document.getElementById('cmts-root').remove();
    _cmModal = { targetType: null, targetId: null, replyTo: null, isOwner: false, onCountChange: null, sort: 'top', myReaction: 0 };
  });
Bazares.History.registerOverlayCloser('story-viewer',
  () => !!document.getElementById('story-viewer-root'),
  () => {
    clearTimeout(_storyState?.timer);
    document.getElementById('story-viewer-root').remove();
    renderStoriesBar(_storiesBarId);
  });
Bazares.History.registerOverlayCloser('video-editor',
  () => { const ve = document.getElementById('ve-root'); return !!(ve && !(typeof _veState !== 'undefined' && _veState?.polling)); },
  () => {
    const ve = document.getElementById('ve-root');
    if (typeof _veState !== 'undefined' && _veState?.objUrl) URL.revokeObjectURL(_veState.objUrl);
    const onCancel = typeof _veState !== 'undefined' ? _veState?.onCancel : null;
    ve.remove(); if (typeof _veState !== 'undefined') _veState = null;
    if (onCancel) onCancel();
  });
Bazares.History.registerOverlayCloser('image-editor',
  () => !!document.getElementById('ie-root'),
  () => {
    const ie = document.getElementById('ie-root');
    if (typeof _ieState !== 'undefined' && _ieState?.blobUrl) URL.revokeObjectURL(_ieState.blobUrl);
    const onCancel = typeof _ieState !== 'undefined' ? _ieState?.onCancel : null;
    ie.remove(); if (typeof _ieState !== 'undefined') _ieState = null;
    if (onCancel) onCancel();
  });

function closeTopmostOverlay() {
  return Bazares.History.closeTop();
}
function _bzIsHomePath() {
  const seg = location.pathname.split('/').pop();
  return seg === '' || seg === 'home.html';
}
window.addEventListener('popstate', () => {
  if (_bzSuppressNextPopstate) { _bzSuppressNextPopstate = false; return; }
  if (closeTopmostOverlay()) return;
  if (!_bzIsHomePath() || _bzExitConfirmed) return;
  // Não precisamos de rearmar nós próprios: confirmDialog() abre um modal,
  // e openModal() já arma a sua própria entrada de histórico — o que
  // também tem a vantagem de o voltar fechar só a pergunta (sem sair)
  // se o utilizador voltar a tocar em voltar antes de decidir.
  confirmDialog('Queres sair da Bazares?', { title: 'Sair da aplicação', confirmLabel: 'Sair', cancelLabel: 'Cancelar', danger: true })
    .then(ok => {
      if (!ok) return;
      _bzExitConfirmed = true;
      _bzSuppressNextPopstate = true;
      history.back();
      try { window.close(); } catch (e) {}
    });
});
// Garante que, mesmo ao entrar directamente na Home (abrir a app de
// fresco), já há uma entrada extra à espera — sem isto, o 1º toque no
// voltar sairia logo da app em vez de mostrar a confirmação.
if (_bzIsHomePath()) _bzOpenOverlay();

// ─── INTERAÇÃO SOCIAL COMPRADOR-VENDEDOR ──────────────────────────
// Ferramentas reutilizáveis em qualquer página: sugerir a um amigo,
// negociar preço de forma estruturada e prova social partilhável.

function waLink(text, phone) {
  const base = phone ? `https://wa.me/${String(phone).replace(/\D/g, '')}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

// Sugerir um produto/loja a um amigo específico — usa o partilhar nativo
// do telefone quando disponível, com fallback directo para o WhatsApp.
function suggestToFriend(title, url) {
  const text = `Olha o que encontrei no Bazares: ${title}\n${url}`;
  if (navigator.share) {
    navigator.share({ title, text, url }).catch(() => {});
  } else {
    window.open(waLink(text), '_blank');
  }
}

// Guarda um rascunho de mensagem para a próxima vez que o chat com este
// vendedor for aberto (lido por chat.html). Nunca envia nada sozinho —
// o comprador revê e confirma antes de enviar.
function setChatDraft(sellerId, text) {
  try { sessionStorage.setItem('bz_chat_draft_' + sellerId, text); } catch (e) {}
}

async function contactSellerWithDraft(sid, draft) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  if (draft) setChatDraft(sid, draft);
  try {
    const r = await api.get(`/chat/with/${sid}`);
    go('chat.html', { with: sid, chatId: r?.data?.chat?.id || '' });
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
}

// ─── Modo Regatear — proposta de preço estruturada, enviada pelo chat ──
function openOfferModal(sellerId, productName, price) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  window._offerCtx = { sellerId, productName, price };
  const suggestions = [5, 10, 15];
  openModal(`
    <div class="modal-hd"><h3>Propor um preço</h3><button class="modal-x" onclick="closeModal()"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <p style="font-size:13px;color:var(--t3);margin-bottom:14px">Preço atual: <strong>${fmtMT(price)}</strong>. Escolha um desconto ou proponha o seu valor — a proposta é enviada ao vendedor pelo chat, para combinarem em conjunto.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${suggestions.map(pct => `<button type="button" class="btn btn-soft btn-sm" onclick="pickOfferPct(${pct})">-${pct}%</button>`).join('')}
    </div>
    <div class="fg" style="margin-bottom:14px">
      <label>O seu valor proposto (MT)</label>
      <input type="number" id="offer-val" min="1" value="${Math.round(price * 0.9)}">
    </div>
    <div style="display:flex;gap:9px">
      <button class="btn btn-terra" onclick="sendOffer()"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg> Enviar proposta</button>
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    </div>`);
}
function pickOfferPct(pct) {
  const ctx = window._offerCtx; if (!ctx) return;
  const val = document.getElementById('offer-val');
  if (val) val.value = Math.round(ctx.price * (1 - pct / 100));
}
function sendOffer() {
  const ctx = window._offerCtx; if (!ctx) return;
  const val = parseFloat(document.getElementById('offer-val')?.value) || ctx.price;
  const draft = `Olá! Gostava de propor ${fmtMT(val)} por "${ctx.productName}" (preço atual ${fmtMT(ctx.price)}). Podemos combinar?`;
  closeModal();
  contactSellerWithDraft(ctx.sellerId, draft);
}

// ─── Selo partilhável "Compra Feliz" — gerado no dispositivo, sem passar
// pelo servidor. Prova social autêntica que o comprador pode publicar no
// WhatsApp Status depois de uma avaliação 5 estrelas.
async function shareHappyBuyBadge(product, rating, imgUrl) {
  try {
    const W = 1000, H = 1250;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#16A34A'); grad.addColorStop(1, '#0B5C26');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    if (imgUrl) {
      try {
        const img = await _loadImageCORS(imgUrl);
        const size = 760, x = (W - size) / 2, y = 140;
        ctx.save();
        _roundRectPath(ctx, x, y, size, size, 28);
        ctx.clip();
        _drawImageCover(ctx, img, x, y, size, size);
        ctx.restore();
      } catch (e) {}
    }
    ctx.fillStyle = '#F59E0B'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('★'.repeat(Math.max(1, Math.min(5, rating))), W / 2, 990);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 46px sans-serif';
    _wrapCanvasText(ctx, product.name || '', W / 2, 1060, 860, 54);
    ctx.font = '600 32px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText('Comprei no Bazares 🇲🇿', W / 2, H - 55);

    canvas.toBlob(async blob => {
      if (!blob) { toast('Não foi possível gerar o selo agora.', 'err'); return; }
      const file = new File([blob], 'compra-feliz-bazares.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Compra Feliz no Bazares', text: 'Comprei no Bazares!' }); return; } catch (e) {}
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'compra-feliz-bazares.png'; a.click();
      toast('Imagem guardada — partilhe no seu WhatsApp Status!', 'ok');
    }, 'image/png');
  } catch (e) { toast('Não foi possível gerar o selo agora.', 'err'); }
}
function _loadImageCORS(src) {
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => res(img); img.onerror = rej; img.src = src;
  });
}
function _drawImageCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height, tr = w / h;
  let sw = img.width, sh = img.height, sx = 0, sy = 0;
  if (ir > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; }
  else { sh = img.width / tr; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
function _roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function _wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' '); let line = '', lines = [];
  for (const w of words) {
    const test = line + w + ' ';
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w + ' '; }
    else line = test;
  }
  lines.push(line);
  lines = lines.slice(0, 2);
  const startY = y - (lines.length - 1) * lineHeight / 2;
  lines.forEach((l, i) => ctx.fillText(l.trim(), x, startY + i * lineHeight));
}

// ─── ONBOARDING (pós-registo, qualquer via — email, Google, Facebook, Apple) ──
// Mostra-se sempre que user.onboardedAt vier null do backend. "Agora não"
// também marca onboardedAt (não promove a SELLER), para não voltar a
// aparecer sempre que a pessoa entra.
function showOnboardingModal() {
  window._onboardingState = { intent: null, hasStore: null, source: '' };
  openModal(`
    <div class="modal-hd"><h3>Bem-vindo ao Bazares! <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M6 13.5V11a2 2 0 0 0-4 0c0 4 2 9 8 9h1c4.5 0 7-2.5 7-7v-3"/></svg></h3></div>
    <p style="font-size:13px;color:var(--t3);margin-bottom:18px">Só mais um instante — ajuda-nos a conhecer-te melhor.</p>

    <div style="margin-bottom:16px">
      <p style="font-weight:600;margin-bottom:8px;font-size:14px">O que pretende fazer no Bazares?</p>
      <div style="display:flex;gap:9px" id="ob-intent">
        <button type="button" class="btn btn-ghost" style="flex:1" onclick="pickOnboardingIntent('BUY', this)">Comprar</button>
        <button type="button" class="btn btn-ghost" style="flex:1" onclick="pickOnboardingIntent('SELL', this)">Vender</button>
      </div>
    </div>

    <div id="ob-store-wrap" style="display:none;margin-bottom:16px">
      <p style="font-weight:600;margin-bottom:8px;font-size:14px">Já tem uma loja física?</p>
      <div style="display:flex;gap:9px" id="ob-store">
        <button type="button" class="btn btn-ghost" style="flex:1" onclick="pickOnboardingStore(true, this)">Sim</button>
        <button type="button" class="btn btn-ghost" style="flex:1" onclick="pickOnboardingStore(false, this)">Não</button>
      </div>
    </div>

    <div style="margin-bottom:20px">
      <p style="font-weight:600;margin-bottom:8px;font-size:14px">Onde ouviu falar do Bazares?</p>
      <select id="ob-source" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--b-200,#ccc);font-family:inherit;font-size:14px" onchange="window._onboardingState.source=this.value">
        <option value="">Seleccione (opcional)</option>
        <option value="Facebook">Facebook</option>
        <option value="WhatsApp">WhatsApp</option>
        <option value="Amigo ou familiar">Amigo ou familiar</option>
        <option value="Google">Google</option>
        <option value="Outro">Outro</option>
      </select>
    </div>

    <div style="display:flex;gap:9px">
      <button class="btn btn-primary" style="flex:1" id="ob-submit" onclick="submitOnboarding()">Concluir</button>
      <button class="btn btn-ghost" style="flex:1" onclick="skipOnboarding()">Agora não</button>
    </div>`);
}

function pickOnboardingIntent(val, el) {
  window._onboardingState.intent = val;
  document.querySelectorAll('#ob-intent button').forEach(b => b.classList.remove('btn-primary'));
  el.classList.add('btn-primary');
  document.getElementById('ob-store-wrap').style.display = val === 'SELL' ? 'block' : 'none';
}

function pickOnboardingStore(val, el) {
  window._onboardingState.hasStore = val;
  document.querySelectorAll('#ob-store button').forEach(b => b.classList.remove('btn-primary'));
  el.classList.add('btn-primary');
}

async function submitOnboarding() {
  const btn = document.getElementById('ob-submit');
  setLoading(btn, true);
  const { intent, hasStore, source } = window._onboardingState || {};
  const payload = {};
  if (intent) payload.intent = intent;
  if (intent === 'SELL' && hasStore !== null) payload.hasPhysicalStore = hasStore;
  if (source) payload.referralSource = source;

  try {
    const res = await api.put('/users/me/onboarding', payload);
    if (res?.data?.user && Session._user) Object.assign(Session._user, res.data.user);
    closeModal();
    if (intent === 'SELL') {
      toast('Perfeito! A sua conta foi actualizada para vendedor.', 'info');
      setTimeout(() => location.reload(), 700);
    } else {
      toast('Obrigado! Boas compras no Bazares.', 'info');
    }
  } catch (err) {
    setLoading(btn, false);
    toast(apiErrorMessage(err), 'err');
  }
}

async function skipOnboarding() {
  closeModal();
  try {
    const res = await api.put('/users/me/onboarding', {});
    if (res?.data?.user && Session._user) Object.assign(Session._user, res.data.user);
  } catch {}
}

// ─── LOADING ────────────────────────────────────────────────────
function setLoading(selector, loading) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!el) return;
  if (loading) {
    el._orig = el.innerHTML;
    el.disabled = true;
    el.innerHTML = `<span class="spinner"></span>`;
  } else {
    el.disabled = false;
    if (el._orig !== undefined) { el.innerHTML = el._orig; delete el._orig; }
  }
}

// ─── TOPBAR builder ─────────────────────────────────────────────
// ─── TEMA PREMIUM (dourado/laranja em toda a app) ────────────────────
// Chamado em cada initPage(). A fonte de verdade é o backend
// (premiumService.isActive, já reflectida em user.isPremium a cada
// login/refresh) — aqui só espelhamos isso no atributo do <html> para
// o CSS reagir globalmente (ver bloco [data-premium="true"] no
// style.css).
function applyPremiumTheme(user) {
  if (user && user.isPremium) {
    document.documentElement.setAttribute('data-premium', 'true');
    localStorage.setItem('bz_premium_hint', '1');
  } else {
    document.documentElement.removeAttribute('data-premium');
    // Só remove a "dica" quando já sabemos com certeza (resposta do
    // backend) que a conta não é premium — nunca a remover só por
    // ainda não termos a resposta ainda (isso reintroduziria o flash).
    if (user) localStorage.removeItem('bz_premium_hint');
  }
}

function buildTopbar(activePage = '') {
  const user = Session.user;
  const cartCount = parseInt(sessionStorage.getItem('bz_cart_count') || '0');
  // Na home pública (visitante, ainda sem sessão) o topbar é transparente e
  // faz parte da imagem do hero — ver body.pg-landing no style.css. Nesse
  // caso a caixa de pesquisa dá lugar a um simples botão de lupa, para não
  // pesar visualmente sobre a foto.
  const isLandingHero = activePage === 'index.html' && !user;

  // Setinha de voltar — substitui o ícone de menu em todas as páginas
  // excepto as 5 que são destino directo da bottom-nav (Início/Descobrir/
  // Mensagens/Perfil) e a landing pública (index.html): nessas "voltar"
  // não faz sentido, são o destino final de uma aba, não um passo de um
  // fluxo. Central aqui em vez de em cada página — uma só alteração cobre
  // as 50+ páginas da app.
  const TB_ROOT_PAGES = ['index.html', 'home.html', 'explorar.html', 'chat.html', 'profile.html'];
  const isRootPage = TB_ROOT_PAGES.includes(activePage);

  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  document.body.classList.toggle('pg-landing', isLandingHero);

  topbar.innerHTML = `
    ${isRootPage
      ? `<button class="tb-btn tb-menu-btn" onclick="toggleSidebar()" aria-label="Menu">${icon('menu', 20)}</button>`
      : `<button class="tb-btn tb-menu-btn" onclick="goBack()" aria-label="Voltar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button>`}
    <button class="tb-logo" onclick="go('index.html')" aria-label="Bazares">
      ${brandMark(38)}
      <div class="tb-logo-text">
        <span class="tb-logo-name">BAZ<span>ARES</span></span>
        <span class="tb-logo-tagline">Marketplace Moçambicano</span>
      </div>
    </button>
    ${isLandingHero ? `
    <div class="tb-spacer"></div>
    <button class="tb-btn" onclick="go('search.html')" aria-label="Pesquisar" title="Pesquisar">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    </button>` : `
    <div class="tb-search" id="tb-search-wrap">
      <span class="si"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
      <input id="gsearch" placeholder="Pesquisar produtos, lojas e pessoas..." autocomplete="off">
      <div id="search-dd"></div>
    </div>`}
    <div class="tb-actions">
      ${user ? `<button class="tb-btn" id="notif-btn" onclick="toggleNotifPanel()" title="Notificações">
        ${icon('bell', 19)}<span class="tb-badge" id="notif-count" style="display:none"></span>
      </button>` : ''}
      ${user ? `<button class="tb-btn tb-opt" onclick="go('chat.html')" title="Mensagens">
        ${icon('chat', 19)}<span class="tb-badge" id="tb-chat-count" style="display:none"></span>
      </button>` : ''}
      ${user && user.role === 'BUYER' ? `<button class="tb-btn tb-cart-btn" onclick="go('cart.html')" title="Carrinho" style="position:relative">
        ${icon('cart', 19)}${cartCount > 0 ? `<span style="position:absolute;top:2px;right:2px;background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:10px">${cartCount}</span>` : ''}
      </button>` : ''}
      <button class="tb-btn tb-darkmode" onclick="toggleDark()" title="Modo escuro">${icon('moon', 18)}</button>
      ${user ? `<span class="tb-div" aria-hidden="true"></span><button class="tb-btn tb-profile-btn" onclick="go('profile.html')" title="Perfil">${user.isPremium ? `<span class="av-premium-ring">${avatar(user.name, 26, userPhoto(user))}</span>` : avatar(user.name, 28, userPhoto(user))}<span class="online-dot"></span></button>` : `
        <button class="btn btn-ghost btn-sm" ${isLandingHero ? `style="color:#fff;border-color:rgba(255,255,255,.3)"` : ''} onclick="go('login.html')">Entrar</button>
        <button class="btn btn-terra btn-sm" onclick="go('register.html')">Criar conta</button>
      `}
    </div>
  `;

  // Live search
  const si = document.getElementById('gsearch');
  const dd = document.getElementById('search-dd');
  if (si) {
    const debouncedSearch = Bazares.Utils.debounce((q) => doGlobalSearch(q, dd), 350);
    si.addEventListener('input', () => {
      const q = si.value.trim();
      if (q.length < 2) { debouncedSearch.cancel(); dd.style.display = 'none'; return; }
      debouncedSearch(q);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#tb-search-wrap')) dd.style.display = 'none';
    });
  }

  // Notifications dot
  if (user) { refreshNotifDot(); refreshChatBadge(); }
}

async function doGlobalSearch(q, dd) {
  try {
    // Usa o endpoint dedicado de pesquisa com sugestões rápidas
    const res = await api.get('/search/suggestions', { q });
    const suggestions = res?.data?.suggestions || [];
    if (!suggestions.length) {
      dd.innerHTML = `<div style="padding:12px;color:var(--t4);font-size:13px">Sem resultados para "${esc(q)}" — <a href="search.html?q=${encodeURIComponent(q)}" style="color:var(--b-500);font-weight:600">ver todos</a></div>`;
    } else {
      const bazars = suggestions.filter(s => s.type === 'bazar');
      const products = suggestions.filter(s => s.type === 'product');
      dd.innerHTML =
        (bazars.length ? `<div style="padding:7px 12px 3px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t4)">Bazares</div>
          ${bazars.map(b => `<div class="sdd-item" onclick="go('bazar.html',{id:'${escJsAttr(b.slug || b.id)}'})">
            ${storeAvatar(b.label, 28, b.logoUrl || null)}<span style="font-size:13px;font-weight:600">${esc(b.label)}</span></div>`).join('')}` : '') +
        (products.length ? `<div style="padding:7px 12px 3px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t4)">Produtos</div>
          ${products.map(p => `<div class="sdd-item" onclick="go('product.html',{id:'${p.id}'})">
            <div style="width:30px;height:30px;border-radius:6px;background:var(--surf3);display:flex;align-items:center;justify-content:center;color:var(--t3)">${icon('box', 15)}</div>
            <div><div style="font-size:13px;font-weight:600">${esc(p.label)}</div><div style="font-size:11px;color:var(--t4)">${esc(p.sub||'')}</div></div>
          </div>`).join('')}` : '') +
        `<div style="padding:8px 12px;border-top:1px solid var(--brd);text-align:center">
          <a href="search.html?q=${encodeURIComponent(q)}" style="font-size:12px;color:var(--b-500);font-weight:600">Ver todos os resultados para "${esc(q)}" <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></a>
        </div>`;
    }
    dd.style.display = 'block';
  } catch {}
}

// ─── SIDEBAR builder ────────────────────────────────────────────
let _sbOpen = false;
function toggleSidebar() {
  _sbOpen = !_sbOpen;
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  if (sb) sb.classList.toggle('open', _sbOpen);
  if (ov) ov.classList.toggle('show', _sbOpen);
  document.body.classList.toggle('sidebar-open', _sbOpen);
}
function closeSidebar() {
  _sbOpen = false;
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('show');
  document.body.classList.remove('sidebar-open');
}

function buildSidebar(active = '') {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  const user = Session.user;

  const sellerLinks = [
    ['home.html', 'home', 'Home'],
    ['explorar.html', 'compass', 'Explorar'],
    ['meufeed.html', 'grid', 'Meu Feed'],
    ['notifications.html', 'bell', 'Notificações'],
    ['dashboard.html', 'pulse', 'Dashboard'],
    ['premium.html', 'star', 'Premium'],
    ['my-bazar.html', 'store', 'Meu Bazar'],
    ['my-products.html', 'box', 'Produtos'],
    ['my-orders.html', 'cart', 'Encomendas'],
    ['chat.html', 'chat', 'Mensagens'],
    ['wallet.html', 'wallet', 'Wallet'],
    ['finance.html', 'bars', 'Financeiro'],
    ['ranking.html', 'trophy', 'Ranking'],
    ['referrals.html', 'link', 'Referências']
  ];
  const buyerLinks = [
    ['home.html', 'home', 'Home'],
    ['explorar.html', 'compass', 'Explorar'],
    ['notifications.html', 'bell', 'Notificações'],
    ['dashboard.html', 'pulse', 'Dashboard'],
    ['premium.html', 'star', 'Premium'],
    ['my-orders.html', 'cart', 'Encomendas'],
    ['cart.html', 'cart', 'Carrinho'],
    ['chat.html', 'chat', 'Mensagens'],
    ['favorites.html', 'heart', 'Favoritos'],
    ['wallet.html', 'wallet', 'Wallet'],
    ['ranking.html', 'trophy', 'Ranking'],
    ['referrals.html', 'link', 'Referências']
  ];
  const revLinks = [
    ['home.html', 'home', 'Home'],
    ['explorar.html', 'compass', 'Explorar'],
    ['notifications.html', 'bell', 'Notificações'],
    ['dashboard.html', 'pulse', 'Dashboard'],
    ['premium.html', 'star', 'Premium'],
    ['wallet.html', 'wallet', 'Wallet'],
    ['referrals.html', 'link', 'Referências']
  ];
  const adminLinks = [
    ['admin.html', 'pulse', 'Visão Geral'],
    ['admin-users.html', 'user', 'Utilizadores'],
    ['admin-products.html', 'box', 'Produtos'],
    ['admin-orders.html', 'cart', 'Encomendas'],
    ['admin-finance.html', 'bars', 'Financeiro'],
    ['admin-premium.html', 'star', 'Códigos Premium'],
    ['wallet.html', 'wallet', 'A minha Wallet'],
    ['admin-wallet.html', 'wallet', 'Contribuições'],
    ['admin-broadcast.html', 'megaphone', 'Avisos'],
    ['admin-reports.html', 'bars', 'Relatórios'],
    ['admin-logs.html', 'clipboard', 'Auditoria'],
    ['admin-denuncias.html', 'flag', 'Denúncias']
  ];

  const roleLinks = user
    ? ({ SELLER: sellerLinks, BUYER: buyerLinks, REVENDEDOR: revLinks, ADMIN: adminLinks }[user.role] || [])
    : [];

  const link = (href, ico, lbl) =>
    `<button class="sb-lnk${active === href ? ' active' : ''}" onclick="go('${href}')">
      <span class="ico">${icon(ico, 17, 1.7)}</span>${lbl}
    </button>`;

  sb.innerHTML = `
    ${user ? `<div class="sb-user">${user.isPremium ? `<span class="av-premium-ring">${avatar(user.name, 38, userPhoto(user))}</span>` : avatar(user.name, 38, userPhoto(user))}<div><div class="sb-name">${esc(user.name)}${user.isPremium ? `<span class="premium-chip">${icon('star',9,2.5)} PREMIUM</span>` : ''}</div><div class="sb-role">${ROLE_LABEL[user.role] || user.role}</div></div></div>` : ''}
    <nav class="sb-nav">
      ${user ? `
        <div class="sb-sec">${ROLE_LABEL[user.role] || ''}</div>
        ${roleLinks.map(([h, i, l]) => link(h, i, l)).join('')}
        <div class="sb-sec">Conta</div>
        ${link('profile.html', 'user', 'Perfil')}
        ${link('settings.html', 'settings', 'Definições')}
        ${link('support.html', 'support', 'Suporte')}
        <button class="sb-lnk" style="color:var(--red)" onclick="doLogout()"><span class="ico">${icon('logout', 17, 1.7)}</span>Terminar sessão</button>
      ` : `
        <div class="sb-sec">Navegação</div>
        ${link('index.html', 'home', 'Início')}
        ${link('bazars.html', 'store', 'Bazares')}
        ${link('products.html', 'box', 'Produtos')}
        ${link('explorar.html', 'compass', 'Explorar')}
        ${link('reels.html', 'play', 'Reels')}
        <hr style="margin:8px;border-color:var(--brd)">
        ${link('login.html', 'user', 'Entrar')}
        ${link('register.html', 'sparkle', 'Criar conta')}`}
    </nav>`;
}

async function doLogout() {
  if (typeof disablePushNotifications === 'function') { try { await disablePushNotifications(true); } catch {} }
  await Session.logout();
  localStorage.removeItem('bz_premium_hint');
  toast('Sessão terminada.', 'info');
  sessionStorage.removeItem('bz_cart_count');
  setTimeout(() => go('index.html'), 800);
}

// ─── NOTIFICATIONS ──────────────────────────────────────────────
let _notifPanelOpen = false;

// Contagens de por-ler persistidas + sincronizadas entre separadores
// (Bazares.State, ver runtime.js): ao abrir uma página nova já
// pintamos o badge com o último valor conhecido (sem esperar pela
// rede), e se outra aba aberta marcar tudo como lido, esta aba
// actualiza-se sozinha, sem precisar de recarregar nem de sondar.
Bazares.State.sync('unreadNotif');
Bazares.State.sync('unreadChat');

function _paintBadge(elId, unread) {
  const badge = document.getElementById(elId);
  if (badge) { badge.textContent = unread > 99 ? '99+' : unread; badge.style.display = unread > 0 ? '' : 'none'; }
}
Bazares.State.subscribe('unreadNotif', (v) => _paintBadge('notif-count', v || 0));
Bazares.State.subscribe('unreadChat', (v) => _paintBadge('tb-chat-count', v || 0));

async function refreshNotifDot() {
  const cached = Bazares.State.get('unreadNotif');
  if (cached !== undefined) _paintBadge('notif-count', cached);
  try {
    const res = await api.get('/notifications', { unreadOnly: 'true', limit: 1 });
    const unread = res?.data?.unreadCount || 0;
    Bazares.State.set('unreadNotif', unread);
    _paintBadge('notif-count', unread); // garante pintura mesmo que o valor não tenha mudado (set() não dispara nesse caso)
  } catch {}
}

async function refreshChatBadge() {
  const cached = Bazares.State.get('unreadChat');
  if (cached !== undefined) _paintBadge('tb-chat-count', cached);
  try {
    const res = await api.get('/chat/unread-count');
    const unread = res?.data?.count || 0;
    Bazares.State.set('unreadChat', unread);
    _paintBadge('tb-chat-count', unread);
  } catch {}
}

function toggleNotifPanel() {
  _notifPanelOpen = !_notifPanelOpen;
  let panel = document.getElementById('notif-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.className = 'notif-panel';
    panel.innerHTML = `
      <div style="padding:14px 16px;border-bottom:1px solid var(--brd);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--surf)">
        <strong style="font-size:14px">Notificações</strong>
        <button class="btn-xs btn-soft" onclick="markAllNotifsRead()">Marcar lidas</button>
      </div>
      <div id="notif-list"><div style="text-align:center;padding:30px"><span class="spinner spinner-dark"></span></div></div>
      <div style="padding:10px;text-align:center;border-top:1px solid var(--brd);position:sticky;bottom:0;background:var(--surf)">
        <a href="notifications.html" style="font-size:12.5px;font-weight:700;color:var(--b-600)">Ver todas as notificações</a>
      </div>`;
    document.body.appendChild(panel);
    loadNotifications();
  }
  panel.classList.toggle('open', _notifPanelOpen);
}

// Detecta o link de destino com base no tipo/título da notificação
function notifDestination(n) {
  const title = (n.title || '').toLowerCase();
  const msg   = (n.message || '').toLowerCase();
  const link  = n.link || '';

  // Link explícito do backend tem prioridade
  if (link && link !== '#') return link;

  // Mensagens <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg> chat
  if (title.includes('mensagem') || msg.includes('mensagem'))
    return 'chat.html';

  // Encomendas
  if (title.includes('encomenda') || title.includes('pedido') ||
      msg.includes('encomenda')   || msg.includes('pedido'))
    return 'my-orders.html';

  // Pagamento / financeiro
  if (title.includes('pagamento') || title.includes('taxa') ||
      title.includes('contribui')  || title.includes('financ'))
    return 'finance.html';

  // Verificação / conta
  if (title.includes('verific') || title.includes('conta'))
    return 'profile.html';

  // Avaliação / review
  if (title.includes('avaliaç') || title.includes('review'))
    return 'my-orders.html';

  // Produto em destaque
  if (title.includes('destaque') || title.includes('produto'))
    return 'my-products.html';

  // Bazar
  if (title.includes('bazar'))
    return 'my-bazar.html';

  return null; // sem destino <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg> só fecha o painel
}

const NOTIF_ICONS = {
  mensagem: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>', encomenda: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>', pedido: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  pagamento: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2"/><circle cx="12" cy="13.5" r="2.5"/></svg>', taxa: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2"/><circle cx="12" cy="13.5" r="2.5"/></svg>', contribui: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2"/><circle cx="12" cy="13.5" r="2.5"/></svg>',
  verific: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>', conta: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', avaliaç: '<svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  destaque: '<svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>', produto: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>', bazar: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-6h16l1 6"/><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 21v-6h6v6"/></svg>',
};
function notifIcon(n) {
  const t = (n.title || '').toLowerCase();
  for (const [k, v] of Object.entries(NOTIF_ICONS)) {
    if (t.includes(k)) return v;
  }
  return '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
}

async function loadNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  try {
    const res = await api.get('/notifications', { limit: 30 });
    const notifs = res?.data?.notifications || [];
    if (!notifs.length) {
      list.innerHTML = `<div class="empty" style="padding:40px"><div class="empty-ico"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div><p>Sem notificações</p></div>`;
    } else {
      list.innerHTML = notifs.map(n => {
        const dest = notifDestination(n);
        const ico  = notifIcon(n);
        return `
        <div class="ni${n.read ? '' : ' unread'}" onclick="handleNotifClick('${n.id}','${dest||''}',this)" style="${dest?'cursor:pointer':''}">
          <div style="font-size:20px;flex-shrink:0;line-height:1">${ico}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px">
              <span>${esc(n.title)}</span>
              ${dest ? `<span style="font-size:16px;color:var(--t4)">›</span>` : ''}
            </div>
            <div style="font-size:12.5px;color:var(--t2);margin-top:2px">${esc(n.message)}</div>
            <div style="font-size:10px;color:var(--t4);margin-top:4px">${fmtDate(n.createdAt)}</div>
          </div>
          ${!n.read ? `<div style="width:8px;height:8px;border-radius:50%;background:#2563EB;flex-shrink:0;margin-top:6px"></div>` : ''}
        </div>`;
      }).join('');
    }
  } catch { list.innerHTML = '<div class="empty" style="padding:40px"><p>Falha ao carregar notificações.</p></div>'; }
}

async function handleNotifClick(id, dest, el) {
  // Marca como lida
  try { await api.patch(`/notifications/${id}/read`); } catch {}
  if (el) el.classList.remove('unread');
  refreshNotifDot();
  // Navega se tiver destino
  if (dest) {
    _notifPanelOpen = false;
    const panel = document.getElementById('notif-panel');
    if (panel) panel.classList.remove('open');
    go(dest);
  }
}

async function markNotifRead(id, el) {
  try { await api.patch(`/notifications/${id}/read`); } catch {}
  if (el) el.classList.remove('unread');
  refreshNotifDot();
}

async function markAllNotifsRead() {
  try { await api.patch('/notifications/read-all'); } catch {}
  document.querySelectorAll('.ni.unread').forEach(e => e.classList.remove('unread'));
  const badge = document.getElementById('notif-count');
  if (badge) badge.style.display = 'none';
  toast('Todas as notificações marcadas como lidas.', 'info');
}

// ─── DARK MODE ──────────────────────────────────────────────────
// ─── Micro-animação de sucesso — pequeno "pulso" num botão depois de
// uma acção confirmada (comprar, publicar, adicionar ao carrinho...).
// Uso: pulseSuccess(event.currentTarget)
function pulseSuccess(el) {
  if (!el) return;
  el.classList.remove('pulse-success');
  void el.offsetWidth; // reinicia a animação mesmo em cliques repetidos
  el.classList.add('pulse-success');
  el.addEventListener('animationend', () => el.classList.remove('pulse-success'), { once: true });
}

function toggleDark() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('bz_theme', next);
  // Mantém o interruptor de Definições sincronizado, quer o utilizador
  // active o modo escuro pela lua na TopBar quer pelo próprio interruptor.
  const sw = document.getElementById('dark-switch');
  if (sw) sw.checked = (next === 'dark');
}
(function initTheme() {
  const saved = localStorage.getItem('bz_theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

// ─── BFCACHE GUARD ────────────────────────────────────────────────
// Antes: qualquer regresso a uma página (botão "voltar") forçava um
// location.reload() completo — o que apagava scroll, listas em cache e
// tudo o resto, mesmo sem motivo (ex: perder de vista um produto na 4ª
// prateleira só porque se voltou atrás). Agora só volta a validar a
// sessão em silêncio; um reload só acontece se a identidade realmente
// mudou entretanto (ex: logout/login noutra aba) — nesse caso concreto
// é mesmo necessário, para nunca mostrar a UI da conta errada. Em
// qualquer outro regresso, a página fica exactamente como estava.
// Actualizar dados fica só a cargo do gesto de puxar para actualizar.
window.addEventListener('pageshow', async (e) => {
  // Corrige o "ecrã trava ao voltar atrás": quando a página anterior foi
  // deixada a meio de um go() (véu de transição ligado), o browser pode
  // guardá-la no bfcache exactamente nesse estado — véu sólido e cliques
  // bloqueados — e restaurá-la assim ao premir "voltar". O véu nunca mais
  // se apagava sozinho. Por isso o desligamos aqui sempre, de imediato e
  // de forma síncrona, antes de qualquer await, independentemente de e.persisted.
  const veil = document.getElementById('pt-veil');
  if (veil) veil.classList.remove('show');

  if (!e.persisted) return;
  const prevUserId = Session.user?.id || null;
  await Session.bootstrap();
  const nowUserId = Session.user?.id || null;
  if (prevUserId !== nowUserId) location.reload();
});

// ─── PAGE INIT HELPER ────────────────────────────────────────────
/**
 * Call at the top of every page script.
 * 1. Bootstraps session (silent token refresh)
 * 2. Enforces role guard if provided
 * 3. Builds shared topbar + sidebar
 * 4. Calls onReady callback
 */
// ─── MEMÓRIA DE SCROLL (universal — qualquer página) ────────────────
// Guarda continuamente a posição de scroll da página actual, associada
// ao URL exacto (caminho + query). Ao voltar a esse mesmo URL (botão
// "voltar" do browser, ou até revisitar a página), a posição é
// restaurada automaticamente depois do conteúdo carregar — sem cada
// página precisar de implementar isto à parte.
try { history.scrollRestoration = 'manual'; } catch (e) {}
function _scrollMemKey() { return 'bz_scrollY_' + location.pathname + location.search; }
let _scrollMemT;
window.addEventListener('scroll', () => {
  clearTimeout(_scrollMemT);
  _scrollMemT = setTimeout(() => {
    try { sessionStorage.setItem(_scrollMemKey(), String(window.scrollY)); } catch (e) {}
  }, 120);
}, { passive: true });
function _restorePageScroll() {
  try {
    const raw = sessionStorage.getItem(_scrollMemKey());
    if (raw == null) return;
    const y = parseInt(raw, 10) || 0;
    if (!y) return;
    const apply = () => window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    requestAnimationFrame(() => requestAnimationFrame(apply));
    // Reforços: cartões/imagens que ainda estão a carregar podem empurrar
    // o layout e desviar o scroll já aplicado, por isso repetimos.
    setTimeout(apply, 300);
    setTimeout(apply, 800);
  } catch (e) {}
}

// ─── CACHE DE LISTAGEM (voltar sem "reiniciar" a página) ────────────
// Guarda o HTML já renderizado de uma listagem em sessionStorage. Ao
// voltar ao mesmo URL, pinta esse HTML de imediato — sem spinner nem
// pedido novo à API — dando sensação de instantâneo em vez de recarregar.
// Actualizar dados fica a cargo do gesto "puxar para actualizar".
function saveListCache(key, html, meta) {
  try {
    sessionStorage.setItem('bz_cache_' + key, JSON.stringify({
      html, meta, url: location.pathname + location.search, t: Date.now()
    }));
  } catch (e) {}
}
function getListCache(key, maxAgeMs = 10 * 60 * 1000) {
  try {
    const raw = sessionStorage.getItem('bz_cache_' + key);
    if (!raw) return null;
    const st = JSON.parse(raw);
    if (st.url !== location.pathname + location.search) return null;
    if (Date.now() - st.t > maxAgeMs) return null;
    return st;
  } catch (e) { return null; }
}

// ─── PUXAR PARA ACTUALIZAR (pull-to-refresh) ────────────────────────
// Gesto mobile: arrastar para baixo no topo da página dispara onRefresh.
// Só actua quando a página já está no topo (scrollY 0), para não
// interferir com o scroll normal do conteúdo.
function initPullToRefresh(onRefresh) {
  const THRESHOLD = 68, MAXPULL = 100;
  let startY = 0, dragging = false, ready = false;
  const el = document.createElement('div');
  el.className = 'ptr-indicator';
  el.innerHTML = '<span class="spinner spinner-dark"></span>';
  document.body.appendChild(el);

  const setY = (px) => { el.style.transform = `translate(-50%, ${-60 + px}px)`; };

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0) { dragging = false; return; }
    startY = e.touches[0].clientY;
    dragging = true; ready = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { el.classList.remove('ptr-show', 'ptr-ready'); setY(0); return; }
    const dist = Math.min(dy * 0.5, MAXPULL);
    el.classList.add('ptr-show');
    ready = dist > THRESHOLD;
    el.classList.toggle('ptr-ready', ready);
    setY(dist);
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!dragging) return;
    dragging = false;
    if (ready) {
      el.classList.add('ptr-loading');
      setY(56);
      try { await onRefresh(); } finally {
        el.classList.remove('ptr-loading', 'ptr-show', 'ptr-ready');
        setY(0);
      }
    } else {
      el.classList.remove('ptr-show', 'ptr-ready');
      setY(0);
    }
    ready = false;
  });
}

async function initPage({ active = '', requireAuth = false, roles = null, guestOnly = false, onReady } = {}) {
  // Bootstrap runs every page load to restore session from cookie
  await Session.bootstrap();
  const user = Session.user;
  applyPremiumTheme(user);
  if (user && typeof refreshPushTokenIfGranted === 'function') refreshPushTokenIfGranted().catch(() => {});
  if (user && typeof maybePromptPushPermission === 'function') {
    // Pequeno atraso — deixa a página assentar antes de mostrar o
    // banner, para não competir com o layout a carregar.
    setTimeout(() => maybePromptPushPermission(), 1200);
  }

  // Mesma verificação usada pelo BazaresRouter antes de trocar de página
  // em SPA (ver Bazares.RouteGuard, runtime.js) — um único sítio para
  // esta regra, em vez de duas cópias que podiam divergir com o tempo.
  const guard = Bazares.RouteGuard.check({ requireAuth, roles, guestOnly, user });
  if (!guard.ok) { go(guard.redirect, guard.params); return; }

  // Em computador (ecrã largo) o menu lateral começa sempre aberto —
  // não faz sentido reservar o espaço dele (como acontecia antes) sem
  // o mostrar, obrigando a clicar no botão de menu só para ele aparecer.
  // Em mobile continua a arrancar fechado, como um menu normal.
  if (window.innerWidth > 900) {
    _sbOpen = true;
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.add('open');
    document.body.classList.add('sidebar-open');
  }

  buildTopbar(active);
  buildSidebar(active);
  if (window.Bazares?.Breadcrumbs) Bazares.Breadcrumbs.render();

  const overlay = document.getElementById('overlay');
  if (overlay) overlay.addEventListener('click', closeSidebar);

  // ── Ripple effect on all .btn clicks ───────────────────────────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const wave = document.createElement('span');
    wave.className = 'ripple-wave';
    const r = btn.getBoundingClientRect();
    wave.style.left = (e.clientX - r.left) + 'px';
    wave.style.top  = (e.clientY - r.top)  + 'px';
    btn.appendChild(wave);
    wave.addEventListener('animationend', () => wave.remove(), { once: true });
  });

  // ── Lazy image load — fade in once loaded ──────────────────────
  const lazyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      img.classList.add('img-loading');
      const tmp = new Image();
      tmp.onload  = () => { img.src = tmp.src; img.classList.replace('img-loading','img-loaded'); };
      tmp.onerror = () => img.classList.remove('img-loading');
      tmp.src = img.dataset.src || img.src;
      lazyObserver.unobserve(img);
    });
  }, { rootMargin: '120px' });
  document.querySelectorAll('img[data-src]').forEach(img => lazyObserver.observe(img));

  if (onReady) await onReady(user);

  // Restaura a posição de scroll guardada para este URL exacto (se houver),
  // agora que o conteúdo da página já foi renderizado.
  _restorePageScroll();

  // ── Stagger .anim-item cards that already exist in DOM ─────────
  animateItems(document.getElementById('view') || document.body);

  // ── Scroll reveal for .reveal elements ──────────────────────────
  // Corre DEPOIS do onReady de propósito: a maioria das páginas injecta
  // o HTML da secção dentro do próprio onReady, e um observer registado
  // antes disso nunca encontra os elementos .reveal (ficam sempre a 0
  // opacidade). initReveal() fica exposto para quem injectar conteúdo
  // mais tarde (ex.: cartões que só chegam depois de um fetch).
  initReveal();
}

/**
 * (Re)regista o scroll-reveal para qualquer .reveal ainda não observado
 * dentro de `container`. Chamar depois de injectar HTML novo com secções
 * marcadas `class="reveal"` (ver .reveal em style.css).
 */
function initReveal(container) {
  if (!window._revealObserver) {
    window._revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); window._revealObserver.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  }
  (container || document).querySelectorAll('.reveal:not(.in)').forEach(el => window._revealObserver.observe(el));
}

// ─── PRODUCT CARD ────────────────────────────────────────────────

/**
 * Stagger-animate .anim-item children inside a container.
 * Call this after injecting new DOM content (product grids, search
 * results, etc.) so each card slides in with a cascade delay.
 */
function animateItems(container) {
  if (!container) return;
  // Progressive enhancement apenas: os .anim-item já ficam visíveis
  // sozinhos via animação CSS (ver style.css). Isto só acrescenta um
  // atraso escalonado para um efeito de cascata quando é chamado a tempo
  // — nunca é exigido para os cartões aparecerem.
  //
  // O atraso é TAMPADO nos primeiros 6 itens: sem isto, uma grelha de
  // 24+ produtos (bazar.html, products.html, explorar) fazia o último
  // cartão só começar a animar mais de 1 segundo depois da página
  // aparecer — é o que dava a sensação de app lenta a abrir páginas
  // com muitos produtos. Agora o atraso máximo é sempre ~240ms, não
  // importa quantos itens existam.
  const items = container.querySelectorAll('.anim-item');
  items.forEach((el, i) => {
    el.style.animationDelay = (Math.min(i, 6) * 40) + 'ms';
  });
}

/**
 * Render N skeleton card placeholders into a container while
 * data is loading — replaces the old spinner-only pattern.
 * Usage: skeletonCards(container, 6)
 */
function skeletonCards(container, n = 6) {
  if (!container) return;
  container.innerHTML = Array.from({ length: n }, () => `
    <div class="skel-card">
      <div class="skel skel-img"></div>
      <div style="padding:10px 0 4px">
        <div class="skel skel-text" style="width:55%"></div>
        <div class="skel skel-title" style="width:80%"></div>
        <div class="skel skel-text" style="width:40%"></div>
      </div>
    </div>`).join('');
}

/**
 * Render N skeleton row placeholders inside a table body.
 */
function skeletonTable(tbody, cols = 5, n = 5) {
  if (!tbody) return;
  tbody.innerHTML = Array.from({ length: n }, () =>
    `<tr>${Array.from({ length: cols }, (_, i) =>
      `<td><div class="skel skel-text" style="width:${[70,90,55,45,60][i] || 70}%"></div></td>`
    ).join('')}</tr>`
  ).join('');
}


function productCard(p) {
  const imgUrl = cldImg(p.images?.[0]?.url || '', 500);
  const verified = !!(p.bazar?.seller?.verifiedSeller || p.bazar?.verified);
  const premiumSeller = !!(p.bazar?.seller?.isPremium);
  const oldPrice = p.oldPrice || p.comparePrice || 0;
  const hasDiscount = oldPrice > p.price;
  const discountPct = hasDiscount ? Math.round((1 - p.price / oldPrice) * 100) : 0;
  return `
    <div class="p-card anim-item${premiumSeller ? ' p-card--premium' : ''}" id="pcard-${p.id}" onclick="go('product.html',{id:'${escJsAttr(p.slug || p.id)}'})">
      <div class="p-img">
        ${(hasDiscount || p.featured || premiumSeller) ? `<div class="p-badges">
          ${hasDiscount ? `<span class="p-badge p-badge-disc">-${discountPct}%</span>` : ''}
          ${p.featured ? `<span class="p-badge p-badge-feat"><svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Destaque</span>` : ''}
          ${premiumSeller ? `<span class="p-badge p-badge-premium"><svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7-5.4-4.7 7.1-.7z"/></svg> Produto Premium</span>` : ''}
        </div>` : ''}
        ${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(p.name)}" loading="lazy" onload="this.classList.add('loaded');this.closest('.p-img').classList.add('loaded')" onerror="imgFallback(this)">` : `<span style="color:var(--t4);font-size:12px"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Sem foto</span>`}
        ${Session.user?.role === 'BUYER' ? `<button class="p-fav" onclick="event.stopPropagation();toggleFavorite('${p.id}',this)">${p.isFavorite ? '<svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'}</button>` : ''}
        <button class="p-more" style="top:${Session.user?.role==='BUYER'?'48px':'10px'}" onclick="event.stopPropagation();openProductMoreMenu('${p.id}','${p.sellerId||''}','${escJsAttr(p.slug||'')}')" aria-label="Mais opcoes">${icon('more',16,2)}</button>
      </div>
      <div class="p-body">
        <div class="p-store">${storeAvatar(p.bazar?.name, 16, bazarLogo(p.bazar))}<span class="p-store-name">${esc(p.bazar?.name || '')}</span>${verified ? `<span class="p-verified" title="Vendedor verificado"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>` : ''}${p.createdAt ? `<span style="color:var(--t4);font-weight:400"> · ${timeAgo(p.createdAt)}</span>` : ''}</div>
        <div class="p-name">${esc(p.name)}</div>
        ${p.ratingCount ? `<div style="font-size:11px;margin-bottom:2px">${stars(p.rating)} ${p.rating?.toFixed(1)} (${p.ratingCount})</div>` : ''}
        ${p.location ? `<div class="p-loc"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(p.location)}</div>` : ''}
        <div class="p-price-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
          <div>${hasDiscount ? `<span class="p-price-old">${fmtMT(oldPrice)}</span>` : ''}<span class="p-price">${fmtMT(p.price)}</span></div>
          ${p.stock > 0 && p.stock <= 3 ? `<span class="stock-low">Só ${p.stock} rest.</span>` : `<span style="font-size:10px;font-weight:600;color:${p.stock > 0 ? 'var(--grn)' : 'var(--red)'}">${p.stock > 0 ? p.stock + ' un.' : 'Esgotado'}</span>`}
        </div>
      </div>
    </div>`;
}

// ─── "Produtos para ti" (Home) — mesmo cartão de productCard(), 100%
// igual (badges, loja com foto+nome+verificado, avaliação, localização,
// preço com desconto/stock, engagement), só redimensionado para caber
// na faixa horizontal (ver CSS `.reco-strip .pc-compact`). ──────
function productCardCompact(p) {
  const imgUrl = cldImg(p.images?.[0]?.url || '', 400);
  const verified = !!(p.bazar?.seller?.verifiedSeller || p.bazar?.verified);
  const premiumSeller = !!(p.bazar?.seller?.isPremium);
  const oldPrice = p.oldPrice || p.comparePrice || 0;
  const hasDiscount = oldPrice > p.price;
  const discountPct = hasDiscount ? Math.round((1 - p.price / oldPrice) * 100) : 0;
  return `
    <div class="p-card pc-compact anim-item${premiumSeller ? ' p-card--premium' : ''}" id="pcard-${p.id}" onclick="go('product.html',{id:'${escJsAttr(p.slug || p.id)}'})">
      <div class="p-img">
        ${(hasDiscount || p.featured || premiumSeller) ? `<div class="p-badges">
          ${hasDiscount ? `<span class="p-badge p-badge-disc">-${discountPct}%</span>` : ''}
          ${p.featured ? `<span class="p-badge p-badge-feat"><svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Destaque</span>` : ''}
          ${premiumSeller ? `<span class="p-badge p-badge-premium"><svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7-5.4-4.7 7.1-.7z"/></svg> Produto Premium</span>` : ''}
        </div>` : ''}
        ${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(p.name)}" loading="lazy" onload="this.classList.add('loaded');this.closest('.p-img').classList.add('loaded')" onerror="imgFallback(this)">` : `<span style="color:var(--t4);font-size:11px">Sem foto</span>`}
        ${Session.user?.role === 'BUYER' ? `<button class="p-fav" onclick="event.stopPropagation();toggleFavorite('${p.id}',this)">${p.isFavorite ? '<svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'}</button>` : ''}
        <button class="p-more" style="top:${Session.user?.role==='BUYER'?'48px':'10px'}" onclick="event.stopPropagation();openProductMoreMenu('${p.id}','${p.sellerId||''}','${escJsAttr(p.slug||'')}')" aria-label="Mais opcoes">${icon('more',16,2)}</button>
      </div>
      <div class="p-body">
        <div class="p-store">${storeAvatar(p.bazar?.name, 16, bazarLogo(p.bazar))}<span class="p-store-name">${esc(p.bazar?.name || '')}</span>${verified ? `<span class="p-verified" title="Vendedor verificado"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>` : ''}</div>
        <div class="p-name">${esc(p.name)}</div>
        ${p.ratingCount ? `<div style="font-size:11px;margin-bottom:2px">${stars(p.rating)} ${p.rating?.toFixed(1)} (${p.ratingCount})</div>` : ''}
        ${p.location ? `<div class="p-loc"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(p.location)}</div>` : ''}
        <div class="p-price-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
          <div>${hasDiscount ? `<span class="p-price-old">${fmtMT(oldPrice)}</span>` : ''}<span class="p-price">${fmtMT(p.price)}</span></div>
          ${p.stock > 0 && p.stock <= 3 ? `<span class="stock-low">Só ${p.stock} rest.</span>` : `<span style="font-size:10px;font-weight:600;color:${p.stock > 0 ? 'var(--grn)' : 'var(--red)'}">${p.stock > 0 ? p.stock + ' un.' : 'Esgotado'}</span>`}
        </div>
      </div>
    </div>`;
}

async function reactProductCard(productId, value, event){
  if(event) event.stopPropagation();
  if(!Session.isLoggedIn()){ go('login.html'); return; }
  try{
    const r = await api.post(`/feed/PRODUCT/${productId}/react`, { value });
    const { likeCount, myReaction } = r?.data || {};
    if(event?.currentTarget){
      const el = event.currentTarget;
      el.classList.toggle('active', myReaction===1);
      el.querySelector('svg')?.setAttribute('fill', myReaction===1?'currentColor':'none');
      const countNode = [...el.childNodes].find(n=>n.nodeType===3);
      if(countNode) countNode.textContent = likeCount||'';
    }
  }catch(e){ toast(apiErrorMessage(e),'err'); }
}

// ─── MEDALHAS (Bronze/Prata/Ouro) ───────────────────────────────────
// Espelha getBadgeTier() do backend (src/utils/helpers.js), usado como
// fallback caso a resposta da API ainda não traga o campo `badge`.
function badgeInfo(monthlySales = 0) {
  if (monthlySales > 50) return { tier: 'OURO', label: 'Ouro', icon: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>' };
  if (monthlySales >= 30) return { tier: 'PRATA', label: 'Prata', icon: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>' };
  return { tier: 'BRONZE', label: 'Bronze', icon: '<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>' };
}
function badgeChip(badge) {
  if (!badge) return '';
  return `<span class="medal-chip medal-${badge.tier.toLowerCase()}">${badge.icon} ${esc(badge.label)}</span>`;
}

// ─── POLEGAR PARA CIMA/BAIXO ─────────────────────────────────────────
// Widget de recomendação rápida do vendedor, independente das estrelas.
function renderThumbs(sellerId, thumbsUp = 0, thumbsDown = 0, myVote = null) {
  if (!sellerId) return '';
  return `
    <div class="thumb-btns" id="thumbs-${sellerId}">
      <button class="thumb-btn${myVote === 'up' ? ' on-up' : ''}" onclick="sendThumb('${sellerId}','up')"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> <span class="tu">${thumbsUp}</span></button>
      <button class="thumb-btn${myVote === 'down' ? ' on-down' : ''}" onclick="sendThumb('${sellerId}','down')"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg> <span class="td">${thumbsDown}</span></button>
    </div>`;
}
async function sendThumb(sellerId, thumb) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  if (Session.user?.id === sellerId) { toast('Não pode votar na sua própria loja.', 'warn'); return; }
  try {
    const res = await api.post(`/users/${sellerId}/thumb`, { thumb });
    const wrap = document.getElementById(`thumbs-${sellerId}`);
    if (wrap && res?.data) {
      wrap.querySelector('.tu').textContent = res.data.thumbsUp ?? 0;
      wrap.querySelector('.td').textContent = res.data.thumbsDown ?? 0;
      wrap.querySelectorAll('.thumb-btn').forEach(b => b.classList.remove('on-up', 'on-down'));
      wrap.querySelector(thumb === 'up' ? '.thumb-btn:first-child' : '.thumb-btn:last-child').classList.add(thumb === 'up' ? 'on-up' : 'on-down');
    }
    toast(thumb === 'up' ? 'Obrigado pelo feedback! <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>' : 'Feedback registado.', 'info');
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
}

async function toggleFavorite(productId, btn) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  const heartPath = '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>';
  const iconHtml = (fav) => fav
    ? `<svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none">${heartPath}</svg>`
    : `<svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${heartPath}</svg>`;
  const wasFav = btn?.querySelector('svg')?.getAttribute('fill') === 'currentColor';

  // Aplica já — sem esperar pela rede.
  if (btn) btn.innerHTML = iconHtml(!wasFav);

  try {
    const res = await api.post(`/products/${productId}/favorite`);
    const isFav = res?.data?.isFavorite;
    if (btn && isFav !== !wasFav) btn.innerHTML = iconHtml(isFav); // reconcilia se o servidor discordar
    toast(isFav ? 'Adicionado aos favoritos! <svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : 'Removido dos favoritos.', isFav ? 'ok' : 'info');
  } catch (e) {
    if (btn) btn.innerHTML = iconHtml(wasFav); // repõe o estado anterior
    toast(apiErrorMessage(e), 'err');
  }
}

// ─── Menu "..." (pontinhos horizontais) do cartão de produto — fica por
// baixo do coração de favoritos (ou no lugar dele, se não for BUYER).
// Mesmo trio de opções do menu do feed (ver openFeedMoreMenu): ocultar
// o cartão, copiar ligação, denunciar — reaproveitando openQuickReportModal.
function openProductMoreMenu(productId, sellerId, slug){
  const link = buildShareUrl('product.html',{id: slug || productId});
  openModal(`<div class="modal-hd"><h3>Mais opcoes</h3><button class="modal-x" onclick="closeModal()">${icon('close',18,2)}</button></div>
    <div style="display:flex;flex-direction:column;gap:9px">
      <button class="btn btn-ghost btn-block" onclick="closeModal();document.getElementById('pcard-${productId}')?.remove();toast('Vais ver menos produtos como este.','ok')">${icon('eyeOff',17,1.8)} Não tenho interesse</button>
      <button class="btn btn-ghost btn-block" onclick="copyToClipboard('${link}');closeModal()">${icon('link',17,1.8)} Copiar ligação</button>
      ${sellerId?`<button class="btn btn-ghost btn-block" style="color:var(--r-600)" onclick="closeModal();confirmBlockUser('${sellerId}')">${icon('slash',17,1.8)} Bloquear vendedor</button>`:''}
      <button class="btn btn-danger btn-block" onclick="closeModal();openQuickReportModal('PRODUCT','${productId}')">${icon('flag',17,1.8)} Denunciar produto</button>
    </div>`);
}

// ─── Ícone de guardar (bookmark) na barra de reações do feed — mesmo
// endpoint de favoritos de produto, só muda o botão-alvo (data-fav-btn
// em vez de .p-fav, para não colidir com o botão do cartão de produto). ──
async function toggleFeedFavorite(productId, btn) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  const svg = btn?.querySelector('svg');
  const wasFav = svg?.getAttribute('fill') === 'currentColor';
  const apply = (fav) => {
    if (!btn) return;
    btn.classList.toggle('saved', fav);
    if (svg) svg.setAttribute('fill', fav ? 'currentColor' : 'none');
  };

  apply(!wasFav); // aplica já — sem esperar pela rede

  try {
    const res = await api.post(`/products/${productId}/favorite`);
    const isFav = res?.data?.isFavorite;
    if (isFav !== !wasFav) apply(isFav); // reconcilia se o servidor discordar
  } catch (e) {
    apply(wasFav); // repõe o estado anterior
    toast(apiErrorMessage(e), 'err');
  }
}

// ─── CAT STRIP ───────────────────────────────────────────────────
function renderCatStrip(container, activeCat, onSelect) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) return;
  // NOTA: usamos sempre _catPick (função global fixa) — nunca embutir o
  // código-fonte de uma função dentro de um atributo onclick="...". Isso
  // já causou um bug visível: JSON.stringify(fn.toString()) produz aspas
  // duplas que fecham o atributo demasiado cedo e o resto do código
  // aparece como texto solto na página.
  el.innerHTML = `
    <div class="cat-chip${!activeCat ? ' on' : ''}" onclick="_catPick(this,'')">
      <div class="ci"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></div><div class="cl">Tudo</div>
    </div>
    ${CATS.map(c => `<div class="cat-chip${activeCat === c.l ? ' on' : ''}" onclick="_catPick(this,'${esc(c.l)}')">
      <div class="ci" style="color:${c.color||'inherit'}">${c.ico}</div><div class="cl">${c.l.slice(0, 10)}</div>
    </div>`).join('')}`;
  el._onSelect = onSelect;
}
window._catPick = function(el, cat) {
  document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  const strip = el.closest('.cat-strip');
  if (strip?._onSelect) strip._onSelect(cat);
};

// ─── STAR PICKER ─────────────────────────────────────────────────
function starPicker(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return 0;
  let val = 0;
  el.innerHTML = [1,2,3,4,5].map(i => `<span data-v="${i}" onclick="_starSet('${containerId}',${i})" style="font-size:26px;cursor:pointer;color:var(--brd2)"><svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>`).join('');
  el._getValue = () => val;
  window._starSet = function(id, v) {
    val = v;
    document.querySelectorAll(`#${id} span`).forEach(s => {
      s.style.color = parseInt(s.dataset.v) <= v ? '#D97706' : 'var(--brd2)';
    });
  };
  return { getValue: () => val };
}

// ─── PAGINATION ──────────────────────────────────────────────────
function renderPagination(container, meta, onPage) {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el || !meta || meta.pages <= 1) { if (el) el.innerHTML = ''; return; }
  // NOTA: mesmo cuidado que em renderCatStrip — nunca serializar o código
  // da função no onclick (qualquer aspas dupla dentro dela quebra o atributo
  // e o resto do código aparece como texto na página). Guardamos a função
  // no próprio elemento e usamos um handler global fixo (_pagePick).
  el._onPage = onPage;
  const btns = [];
  for (let p = 1; p <= meta.pages; p++) {
    btns.push(`<button class="btn btn-xs${p === meta.page ? ' btn-primary' : ' btn-ghost'}" onclick="_pagePick(this,${p})">${p}</button>`);
  }
  el.innerHTML = `<div style="display:flex;gap:6px;justify-content:center;margin-top:18px">${btns.join('')}</div>`;
}
window._pagePick = function(el, p) {
  let node = el;
  while (node && !node._onPage) node = node.parentElement;
  if (node && node._onPage) node._onPage(p);
};

// ══════════════════════════════════════════════════════════════════
// MÓDULO SOCIAL PARTILHADO — reações, comentários e histórias.
// Usado por home.html (feed), explorar.html e reels.html, para que
// gostos/comentários/partilhas e o visualizador de histórias sejam
// exactamente os mesmos em qualquer sítio da app onde apareçam.
// ══════════════════════════════════════════════════════════════════

// ─── Reações (like único, ao estilo Instagram — sem "dislike") ─────
// ─── Carrossel de imagens (várias fotos por publicação) — partilhado
// entre a Home e Meus Posts ──────────────────────────────────────
function imgFrameHtml(url, clickHandler){
  return `<div class="fc-img-frame">
    <div class="fc-img-bg" style="background-image:url('${esc(url)}')"></div>
    <img src="${esc(url)}" alt="" loading="lazy" class="fc-img-fg" onclick="${clickHandler}">
  </div>`;
}
// galleryImages, se indicado, faz cada foto abrir a galeria em ecrã
// inteiro (com setas + download) já na foto certa que está a ser vista
// no carrossel — antes disto, tocar em qualquer foto abria sempre a
// primeira, mesmo estando a ver a 2ª ou 3ª.
function carouselHtml(images, clickHandler, galleryImages, postCardId) {
  if (!images.length) return '';
  const galleryJson = galleryImages ? esc(JSON.stringify(galleryImages)) : null;
  const frame = (u, i) => galleryJson
    ? `<div class="fc-img-frame">
        <div class="fc-img-bg" style="background-image:url('${esc(u)}')"></div>
        <img src="${esc(u)}" alt="" loading="lazy" class="fc-img-fg" data-lb-images='${galleryJson}' onclick="${postCardId ? `openFeedPostViewer('${postCardId}',${i})` : `openImageLightboxAt(this,${i})`}">
      </div>`
    : imgFrameHtml(u, clickHandler);
  if (images.length === 1) {
    return frame(images[0], 0);
  }
  return `
    <div class="fc-carousel-track">
      ${images.map(frame).join('')}
    </div>
    <div class="fc-carousel-count">1/${images.length}</div>
    <div class="fc-carousel-dots">${images.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')}</div>`;
}
// Lê a galeria guardada no data-attribute da imagem tocada e abre-a já
// no índice certo — ver nota em carouselHtml.
function openImageLightboxAt(imgEl, index) {
  try {
    const images = JSON.parse(imgEl.dataset.lbImages || '[]');
    openImageLightbox(images, index);
  } catch (e) {
    openImageLightbox(imgEl.src);
  }
}

// ─── Vista de post em ecrã inteiro (ao tocar numa foto do feed) ─────
// Ao contrário de openImageLightbox (genérico — produtos, avatares,
// etc., que continua a ser só a foto + descarregar), tocar numa foto
// de um POST do feed abre isto: fundo preto, a foto grande, e por
// baixo o mesmo cabeçalho/legenda/reações já visíveis no cartão —
// ao estilo do visualizador de fotos do Facebook. Reaproveita os nós
// já renderizados no cartão (clonados) em vez de os reconstruir, para
// nunca desalinhar do que está mesmo a ser mostrado (contagens,
// reacção própria, etc.) — e continuam ligados aos mesmos onclick
// globais, por isso reagir/comentar aqui actualiza o cartão por trás
// também (e vice-versa).
function openFeedPostViewer(cardId, tappedIndex) {
  const card = document.getElementById(cardId);
  if (!card) return;
  _bzReplaceOverlayRoot('post-viewer-root');

  const imgEl = card.querySelector('.fc-img-fg');
  let images = [];
  try { images = JSON.parse(imgEl?.dataset.lbImages || '[]'); } catch { images = []; }
  if (!images.length && imgEl?.src) images = [imgEl.src];
  if (!images.length) return;
  let idx = Math.min(Math.max(tappedIndex || 0, 0), images.length - 1);

  const headerNode = card.querySelector('.fc-post-header');
  const captionNode = card.querySelector('.fc-caption-block');
  const reactNode = card.querySelector('.fc-reactions-wrap');

  const root = document.createElement('div');
  root.id = 'post-viewer-root';
  root.className = 'post-viewer';

  root.innerHTML = `
    <div class="pv-topbar">
      <button type="button" class="pv-icon-btn pv-close" aria-label="Fechar">${icon('close', 19, 2.2)}</button>
      <button type="button" class="pv-icon-btn pv-more" aria-label="Mais opções">${icon('more', 18, 2)}</button>
    </div>
    <div class="pv-stage">
      <div class="pv-track">
        ${images.map(u => `<div class="pv-slide"><img src="${esc(u)}" alt="" loading="lazy" decoding="async"></div>`).join('')}
      </div>
      ${images.length > 1 ? `<div class="pv-count">${idx + 1}/${images.length}</div>` : ''}
    </div>
    <div class="pv-info"></div>
  `;
  const track = root.querySelector('.pv-track');
  const countEl = root.querySelector('.pv-count');
  root.querySelector('.pv-close').onclick = () => _bzCloseOverlayEl(root);
  root.querySelector('.pv-more').onclick = (e) => {
    e.stopPropagation();
    openModal(`<div style="display:flex;flex-direction:column;gap:9px">
      <button class="btn btn-ghost btn-block" onclick="closeModal();downloadImageUrl('${esc(images[idx])}')"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M12 3v13"/><polyline points="7 12 12 17 17 12"/><path d="M5 21h14"/></svg> Descarregar foto</button>
    </div>`);
  };
  if (images.length > 1) {
    // Arrasta horizontalmente para ver as fotos seguintes (scroll-snap) —
    // aqui só actualizamos o índice/contador ao fim do gesto, sem
    // recriar o DOM, para o arrastar ficar fluido.
    track.addEventListener('scroll', Bazares.Utils.throttle(() => {
      idx = Math.round(track.scrollLeft / track.clientWidth);
      if (countEl) countEl.textContent = `${idx + 1}/${images.length}`;
    }, 80), { passive: true });
    // Abre já na foto tocada, sem animação (precisa do layout aplicado
    // para conhecer a largura da faixa).
    requestAnimationFrame(() => { track.scrollLeft = idx * track.clientWidth; });
  }
  const info = root.querySelector('.pv-info');
  if (headerNode) info.appendChild(headerNode.cloneNode(true));
  if (captionNode) info.appendChild(captionNode.cloneNode(true));
  if (reactNode) info.appendChild(reactNode.cloneNode(true));

  document.addEventListener('keydown', function onKey(e) {
    if (!document.body.contains(root)) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Escape') _bzCloseOverlayEl(root);
    else if (e.key === 'ArrowLeft' && images.length > 1) { idx = Math.max(idx - 1, 0); track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' }); }
    else if (e.key === 'ArrowRight' && images.length > 1) { idx = Math.min(idx + 1, images.length - 1); track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' }); }
  });
  document.body.appendChild(root);
  _bzOpenOverlay();
}
function onCarouselScroll(e) {
  const track = e.target;
  if (!track.classList?.contains('fc-carousel-track')) return;
  const idx = Math.round(track.scrollLeft / track.clientWidth);
  const wrap = track.parentElement;
  const dots = wrap.querySelectorAll('.fc-carousel-dots span');
  dots.forEach((d, i) => d.classList.toggle('on', i === idx));
  const countEl = wrap.querySelector('.fc-carousel-count');
  if (countEl) countEl.textContent = `${idx + 1}/${dots.length}`;
}
function toggleCaption(btn) {
  const p = btn.previousElementSibling;
  const truncated = p.classList.toggle('truncated');
  btn.textContent = truncated ? 'Ver mais' : 'Ver menos';
}

// ─── Cabeçalho de cartão do feed, ao estilo Instagram ────────────────
// Usado por feedCardHtml() (home.html) e por outras listagens que
// mostrem PRODUCT/ANNOUNCEMENT: avatar, nome+selo, e à direita um
// botão "Seguir" (lojas de outros) OU um menu de gerir (a tua própria
// loja) — nunca os dois ao mesmo tempo, como no Instagram.
function feedFollowBtnHtml(bazarId, following){
  return `<button type="button" class="btn ${following?'btn-follow-on':'btn-follow-off'} btn-xs" id="ff-${bazarId}" onclick="event.stopPropagation();feedToggleFollow('${bazarId}',this)" style="border-radius:var(--pill);padding:5px 14px">${following?'A seguir':'Seguir'}</button>`;
}
async function feedToggleFollow(bazarId, btn){
  if(!Session.isLoggedIn()){ go('login.html'); return; }
  btn.disabled = true;
  try{
    const r = await api.post(`/bazars/${bazarId}/follow`, {});
    const following = !!r?.data?.following;
    btn.textContent = following ? 'A seguir' : 'Seguir';
    btn.classList.toggle('btn-follow-on', following);
    btn.classList.toggle('btn-follow-off', !following);
  }catch(e){ toast(apiErrorMessage(e),'err'); }
  finally{ btn.disabled = false; }
}
function feedKebabBtnHtml(targetType, targetId, bazarId){
  return `<button type="button" class="btn-kebab" onclick="event.stopPropagation();openFeedKebab('${targetType}','${targetId}','${bazarId}')" aria-label="Mais opcoes"><svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>`;
}
// Botao "..." (pontinhos horizontais) ao lado do Seguir, para publicacoes
// de OUTRAS lojas — ao contrario do feedKebabBtnHtml acima (Editar/Apagar,
// so para a tua propria loja), este e o menu ao estilo Facebook que
// qualquer visitante ve: deixar de seguir/ocultar/copiar ligacao/
// bloquear/denunciar.
function feedMoreBtnHtml(targetType, targetId, bazarId, sellerId, following){
  return `<button type="button" class="btn-kebab" onclick="event.stopPropagation();openFeedMoreMenu('${targetType}','${targetId}','${bazarId}','${sellerId||''}',${!!following})" aria-label="Mais opcoes">${icon('more',18,2)}</button>`;
}
function openFeedMoreMenu(targetType, targetId, bazarId, sellerId, following){
  const isProduct = targetType === 'PRODUCT';
  const isReel = targetType === 'REEL';
  // Reels ainda não têm página própria de detalhe — a ligação partilhável
  // aponta para a loja (bazar.html, separador Reels), tal como o resto
  // da app faz para conteúdo sem URL dedicado.
  const link = isProduct ? buildShareUrl('product.html',{id:targetId})
    : isReel ? buildShareUrl('bazar.html',{id:bazarId})
    : buildShareUrl('home.html',{announcement:targetId});
  const reportType = isProduct ? 'PRODUCT' : 'BAZAR';
  const reportTarget = isProduct ? targetId : bazarId;
  const reportLabel = isProduct ? 'produto' : isReel ? 'reel' : 'publicação';
  Bazares.Sheet.open(`<div class="sheet-list">
      ${following?`<button type="button" class="sheet-item" onclick="closeModal();feedUnfollowFromMenu('${bazarId}')">${icon('userMinus',19,1.8)} Deixar de seguir</button>`:''}
      <button type="button" class="sheet-item" onclick="closeModal();feedHideCard('${targetType}','${targetId}')">${icon('eyeOff',19,1.8)} Não quero ver isto</button>
      <button type="button" class="sheet-item" onclick="copyToClipboard('${link}');closeModal()">${icon('link',19,1.8)} Copiar ligação</button>
      ${sellerId?`<button type="button" class="sheet-item sheet-item--danger" onclick="closeModal();confirmBlockUser('${sellerId}')">${icon('slash',19,1.8)} Bloquear loja</button>`:''}
      <div class="sheet-divider"></div>
      <button type="button" class="sheet-item sheet-item--danger" onclick="closeModal();openQuickReportModal('${reportType}','${reportTarget}')">${icon('flag',19,1.8)} Denunciar ${reportLabel}</button>
    </div>`);
}
async function feedUnfollowFromMenu(bazarId){
  try{
    await api.post(`/bazars/${bazarId}/follow`, {}); // toggle — já sabemos que following=true aqui
    toast('Deixaste de seguir esta loja.','ok');
    document.querySelectorAll(`#ff-${bazarId}`).forEach(btn=>{
      btn.textContent = 'Seguir';
      btn.classList.remove('btn-follow-on');
      btn.classList.add('btn-follow-off');
    });
  }catch(e){ toast(apiErrorMessage(e),'err'); }
}
function feedHideCard(targetType, targetId){
  document.getElementById(`feed-${targetType}-${targetId}`)?.remove();
  toast('Vais ver menos publicações como esta.','ok');
}
function buildShareUrl(page, params){
  const pretty = prettyUrl(page, params);
  if (pretty) return `${location.origin}${pretty}`;
  const qs = Object.entries(params).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
  return `${location.origin}/${page}${qs?`?${qs}`:''}`;
}
async function copyToClipboard(text){
  try{ await navigator.clipboard.writeText(text); toast('Ligação copiada.','ok'); }
  catch(e){ toast('Não foi possível copiar a ligação.','err'); }
}
// ─── Bloquear utilizador ───────────────────────────────────────────
// Usado pelo menu do feed e pelo menu "..." dos cartões de produto.
// Ao bloquear: deixas de ver o conteúdo dele (e ele o teu) no feed,
// deixam de se seguir um ao outro, e fica impedido de vos enviar
// mensagens (tudo aplicado no backend — ver blockController/blockService).
function confirmBlockUser(userId){
  openModal(`<div class="modal-hd"><h3>Bloquear</h3><button class="modal-x" onclick="closeModal()">${icon('close',18,2)}</button></div>
    <p style="font-size:13.5px;color:var(--t2);margin:0 0 14px">Depois de bloquear, deixam de ver as publicações um do outro e não vos podem enviar mensagens. Pode desbloquear mais tarde em Definições.</p>
    <div style="display:flex;gap:9px"><button class="btn btn-danger" style="flex:1" onclick="submitBlockUser('${userId}')">Bloquear</button><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button></div>`);
}
async function submitBlockUser(userId){
  if(!Session.isLoggedIn()){ go('login.html'); return; }
  try{
    await api.post(`/users/${userId}/block`, {});
    closeModal();
    toast('Utilizador bloqueado.','ok');
    // remove imediatamente qualquer cartão dessa loja/vendedor visível
    document.querySelectorAll(`[data-seller-id="${userId}"]`).forEach(el=>el.closest('.feed-card,.p-card')?.remove());
  }catch(e){ toast(apiErrorMessage(e),'err'); }
}
// Denuncia rapida e partilhada — usada tanto pelo menu do feed como pelo
// menu "..." dos cartoes de produto, para nao duplicar o mesmo modal em
// varios sitios (ao contrario do openReportModal/openProductReport locais
// de bazar.html/product.html, que ja existiam antes disto).
function openQuickReportModal(type, targetId){
  if(!Session.isLoggedIn()){ go('login.html'); return; }
  openModal(`<div class="modal-hd"><h3>Denunciar</h3><button class="modal-x" onclick="closeModal()">${icon('close',18,2)}</button></div>
    <div class="fg"><label>Motivo</label><select id="qr-r"><option>Comportamento inadequado</option><option>Fraude</option><option>Spam</option><option>Conta falsa</option><option>Outro</option></select></div>
    <div class="fg"><label>Descrição</label><textarea id="qr-d" rows="3" placeholder="Descreva o problema..."></textarea></div>
    <div style="display:flex;gap:9px"><button class="btn btn-danger" onclick="submitQuickReport('${type}','${targetId}')">Enviar</button><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button></div>`);
}
async function submitQuickReport(type, targetId){
  const reason = document.getElementById('qr-r')?.value;
  const description = document.getElementById('qr-d')?.value?.trim();
  if(!description){ toast('Descreva o problema.','warn'); return; }
  try{ await api.post('/reports',{type,targetId,reason,description}); closeModal(); toast('Denúncia enviada.','ok'); }
  catch(e){ toast(apiErrorMessage(e),'err'); }
}
// Menu kebab - so aparece com opcoes reais quando o conteudo e da tua
// propria loja (Editar/Apagar); nos restantes casos nao faz nada (o
// botao Seguir ja cobre a interaccao principal com lojas de terceiros).
function openFeedKebab(targetType, targetId, bazarId){
  const isOwn = window._myBazarId === bazarId;
  if(!isOwn) return;
  const isProduct = targetType === 'PRODUCT';
  const isReel = targetType === 'REEL';
  // Editar leva sempre a uma página igual à de publicar (com as fotos
  // já preenchidas, incluindo dar para trocá-las) — não a um popup
  // só com o texto.
  const editAction = isProduct ? `go('my-products.html',{edit:'${targetId}'})`
    : isReel ? `go('newreels.html',{edit:'${targetId}',bazar:'${bazarId}'})`
    : `go('anuncio.html',{edit:'${targetId}'})`;
  Bazares.Sheet.open(`<div class="sheet-list">
      <button type="button" class="sheet-item" onclick="closeModal();${editAction}">${icon('settings',19,1.8)} Editar</button>
      <button type="button" class="sheet-item sheet-item--danger" onclick="feedDeleteItem('${targetType}','${targetId}','${bazarId}')">${icon('close',19,2)} Apagar</button>
    </div>`);
}
async function feedDeleteItem(targetType, targetId, bazarId){
  try{
    if(targetType === 'PRODUCT') await api.delete(`/products/${targetId}`);
    else if(targetType === 'ANNOUNCEMENT') await api.delete(`/bazars/${bazarId}/announcements/${targetId}`);
    else if(targetType === 'REEL') await api.delete(`/bazars/${bazarId}/reels/${targetId}`);
    closeModal();
    document.getElementById(`feed-${targetType}-${targetId}`)?.remove();
    toast('Removido.','ok');
  }catch(e){ toast(apiErrorMessage(e),'err'); }
}

// ─── Barra de reações (Gostei / Comentar / Partilhar) ─────────────
// Visual ao estilo Facebook: resumo (reacção · comentários) e uma
// fila de 3 botões iguais por baixo. Usa sempre os mesmos handlers —
// reactFeed/shareFeed/toggleFeedComments — e os mesmos atributos
// data-like-btn/data-like-count/data-share-count de que essas funções
// já dependem, para nada deixar de funcionar.
//
// `myReaction` é agora um número (0 = sem reacção; 1-7 = ver REACTIONS).
// Um toque normal alterna "Adoro"; premir e segurar abre o selector com
// as 7 reacções (Adoro/Like/Riso/Uau/Triste/Grr/Aplaudir).
// Os emoji são os nativos do telefone (não SVG desenhado à mão) — para
// ficar exactamente como o Facebook/Instagram em vez de ícones a
// traço demasiado "cartoon". `icon` fica só como recurso de reserva
// (ex: quando o emoji não carrega) e para o estado "sem reacção".
const REACTIONS = [
  { value:1, label:'Adoro',    color:'#E1306C', icon:'heart',    emoji:'❤️' },
  { value:2, label:'Like',     color:'#0866FF', icon:'thumbsUp', emoji:'👍' },
  { value:3, label:'Riso',     color:'#F7B125', icon:'laugh',    emoji:'😆' },
  { value:4, label:'Uau',      color:'#F7B125', icon:'wow',      emoji:'😮' },
  { value:5, label:'Triste',   color:'#8E9CB3', icon:'sad',      emoji:'😢' },
  { value:6, label:'Grr',      color:'#E9710F', icon:'angry',    emoji:'😡' },
  { value:7, label:'Aplaudir', color:'#42B72A', icon:'muscle',   emoji:'👏' },
];
const reactionMeta = Bazares.Utils.memoize((value) => REACTIONS.find(r => r.value === value) || null);
// O "Like" do Facebook não é o polegar 👍 amarelo/tom-de-pele do
// teclado — é sempre um círculo AZUL sólido, para se distinguir bem
// das outras reações (que são mesmo caras/emoji). Por isso só esta
// reação usa um SVG a preencher a cor; as restantes 6 usam o emoji
// nativo do telefone tal e qual.
function reactionGlyphInner(r, size) {
  if (r.value === 2) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="${r.color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}" style="display:block">${ICONS.thumbsUp}</svg>`;
  }
  return r.emoji;
}
// `live`: quando true, a animação engraçada da reacção corre logo (2
// voltas e pára) — usado quando a reacção acaba de ser escolhida/mostrada.
// Nos botões do selector (ainda por escolher), a animação só corre ao
// passar o dedo/rato por cima (ver CSS), para o feed não ficar todo a
// mexer sozinho durante o scroll.
function reactionIconSvg(value, size = 20, live = false) {
  const r = reactionMeta(value);
  if (!r) return icon('heart', size, 2);
  return `<span class="rx-emoji rx-anim-${r.value}${live ? ' rx-live' : ''}" style="font-size:${size}px">${reactionGlyphInner(r, size)}</span>`;
}

function feedReactionBar(cardId, targetType, targetId, myReaction, likeCount, shareCount, commentCount, isOwner, isProduct, isFavorite) {
  myReaction = myReaction === true ? 1 : (myReaction || 0); // compat: chamadas antigas passavam booleano
  likeCount = likeCount || 0;
  shareCount = shareCount || 0;
  commentCount = commentCount || 0;
  const rMeta = reactionMeta(myReaction);
  const saveBtn = isProduct
    ? `<button class="fc-r-save${isFavorite?' saved':''}" data-fav-btn="${cardId}" onclick="event.stopPropagation();toggleFeedFavorite('${targetId}',this)" title="Guardar">
        <svg viewBox="0 0 24 24" fill="${isFavorite?'currentColor':'none'}" stroke="currentColor" stroke-width="2" width="20" height="20">${ICONS.bookmark}</svg>
      </button>`
    : `<button class="fc-r-save" onclick="event.stopPropagation();toast('Guardar posts — em breve!','info')" title="Guardar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">${ICONS.bookmark}</svg>
      </button>`;
  return `
    <div class="fc-reactions-wrap">
      ${likeCount > 0 ? `<button type="button" class="fc-reaction-summary" onclick="event.stopPropagation();openReactorsModal('${targetType}','${targetId}')">
        <span class="fc-rs-ico">${reactionIconSvg(myReaction || 1, 15)}</span>
        <span>${likeCount}</span>
      </button>` : ''}
      <div class="fc-reactions-row">
        <button class="fc-r-item feed-like-btn${rMeta?' liked':''}" data-like-btn="${cardId}" data-reaction="${myReaction}"
          style="${rMeta?`color:${rMeta.color}`:''}"
          onpointerdown="reactionPressStart(event,'${cardId}','${targetType}','${targetId}')"
          onpointerup="reactionPressEnd()" onpointerleave="reactionPressEnd()" onpointercancel="reactionPressEnd()"
          onclick="reactFeedTap(event,'${targetType}','${targetId}')">
          <span data-like-ico="${cardId}" style="display:inline-flex">${reactionIconSvg(myReaction, 20, true)}</span>
          <span data-like-label="${cardId}">${rMeta?rMeta.label:''}</span>
          <span data-like-count="${cardId}">${likeCount}</span>
        </button>
        <button class="fc-r-item" onclick="openCommentsModal('${targetType}','${targetId}',{isOwner:${!!isOwner}})">${icon('chat',20,2)} <span>${commentCount}</span></button>
        <button class="fc-r-item" onclick="openShareSheet('${targetType}','${targetId}')">${icon('share',20,2)} <span data-share-count="${cardId}">${shareCount}</span></button>
        ${saveBtn}
      </div>
    </div>`;
}

// ─── Selector de reacções — premir e segurar no botão "Adoro/Gosto/…"
// abre uma fila flutuante com as 7 reacções (estilo Facebook). ───────
let _reactionPressTimer = null, _reactionLongPressed = false;
function reactionPressStart(ev, cardId, targetType, targetId) {
  ev.stopPropagation();
  clearTimeout(_reactionPressTimer);
  _reactionLongPressed = false;
  const btn = ev.currentTarget;
  _reactionPressTimer = setTimeout(() => {
    _reactionLongPressed = true;
    openReactionPicker(cardId, targetType, targetId, btn);
    if (navigator.vibrate) navigator.vibrate(12);
  }, 420);
}
function reactionPressEnd() { clearTimeout(_reactionPressTimer); }
function reactFeedTap(ev, targetType, targetId) {
  ev.stopPropagation();
  if (_reactionLongPressed) { _reactionLongPressed = false; return; }
  reactFeed(targetType, targetId, 1);
}
function openReactionPicker(cardId, targetType, targetId, anchorEl) {
  closeReactionPicker();
  const rect = anchorEl.getBoundingClientRect();
  const root = document.createElement('div');
  root.id = 'reaction-picker-root';
  root.className = 'fc-reaction-picker';
  const width = REACTIONS.length * 40 + 12;
  const left = Math.min(Math.max(8, rect.left - 8), window.innerWidth - width - 8);
  root.style.left = left + 'px';
  root.style.top = Math.max(8, rect.top - 56) + 'px';
  root.innerHTML = REACTIONS.map(r => `
    <button type="button" class="fc-reaction-opt" title="${r.label}" onclick="event.stopPropagation();pickReaction('${cardId}','${targetType}','${targetId}',${r.value})">
      <span class="rx-emoji rx-anim-${r.value}" style="font-size:26px">${reactionGlyphInner(r, 26)}</span>
    </button>`).join('');
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('on'));
  setTimeout(() => document.addEventListener('click', closeReactionPicker, { once: true }), 0);
  setTimeout(closeReactionPicker, 5000);
}
function closeReactionPicker() { document.getElementById('reaction-picker-root')?.remove(); }
async function pickReaction(cardId, targetType, targetId, value) {
  closeReactionPicker();
  await reactFeed(targetType, targetId, value);
}

// ─── "Quem reagiu" — ao tocar na fila "❤️👍 2" por cima dos botões,
// abre esta folha com separadores por tipo de reação (ao estilo
// Facebook) e a lista de pessoas, com a reação que cada uma deixou.
// Pode haver centenas/milhares de reações — a lista vem paginada (30
// de cada vez) e carrega mais sozinha ao chegar perto do fundo, tal
// como o scroll infinito do feed. ──────────────────────────────────
let _rxModal = { targetType: null, targetId: null, value: null, page: 1, pages: 1, loading: false };
async function openReactorsModal(targetType, targetId, value = null) {
  _rxModal = { targetType, targetId, value, page: 1, pages: 1, loading: false };
  openModal(`
    <div class="modal-hd"><h3>Reações</h3><button class="modal-x" onclick="closeModal()">${icon('close',18,2)}</button></div>
    <div id="rx-tabs" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;margin-bottom:6px;border-bottom:1px solid var(--brd)"></div>
    <div id="rx-list" style="display:flex;flex-direction:column;gap:2px;max-height:60vh;overflow-y:auto">
      <div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">A carregar…</div>
    </div>`, true);
  document.getElementById('rx-list').addEventListener('scroll', Bazares.Utils.throttle(onReactorsScroll, 150));
  await refreshReactorsModal();
}
function onReactorsScroll(e) {
  const el = e.target;
  if (_rxModal.loading || _rxModal.page >= _rxModal.pages) return;
  if (el.scrollTop + el.clientHeight > el.scrollHeight - 120) loadMoreReactors();
}
async function refreshReactorsModal() {
  const { targetType, targetId, value } = _rxModal;
  _rxModal.page = 1;
  try {
    const qs = value ? `?value=${value}&page=1` : '?page=1';
    const r = await api.get(`/feed/${targetType}/${targetId}/reactors${qs}`);
    const { reactors, counts, meta } = r?.data || { reactors: [], counts: {}, meta: {} };
    _rxModal.pages = meta?.pages || 1;
    renderReactorTabs(counts);
    const list = document.getElementById('rx-list');
    if (!list) return;
    if (!reactors.length) { list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">Ainda ninguém reagiu.</div>`; return; }
    list.innerHTML = reactors.map(reactorRowHtml).join('') + (_rxModal.pages > 1 ? `<div id="rx-load-more" style="text-align:center;padding:14px;color:var(--t3);font-size:12.5px">A carregar mais…</div>` : '');
    if (_rxModal.pages <= 1) document.getElementById('rx-load-more')?.remove();
  } catch (e) {
    const list = document.getElementById('rx-list');
    if (list) list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">${esc(apiErrorMessage(e))}</div>`;
  }
}
async function loadMoreReactors() {
  const { targetType, targetId, value, page } = _rxModal;
  _rxModal.loading = true;
  try {
    const nextPage = page + 1;
    const qs = value ? `?value=${value}&page=${nextPage}` : `?page=${nextPage}`;
    const r = await api.get(`/feed/${targetType}/${targetId}/reactors${qs}`);
    const { reactors, meta } = r?.data || { reactors: [], meta: {} };
    _rxModal.page = nextPage;
    _rxModal.pages = meta?.pages || _rxModal.pages;
    const list = document.getElementById('rx-list');
    if (!list) return;
    document.getElementById('rx-load-more')?.remove();
    list.insertAdjacentHTML('beforeend', reactors.map(reactorRowHtml).join('') + (_rxModal.page < _rxModal.pages ? `<div id="rx-load-more" style="text-align:center;padding:14px;color:var(--t3);font-size:12.5px">A carregar mais…</div>` : ''));
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
  _rxModal.loading = false;
}
function renderReactorTabs(counts) {
  const tabs = document.getElementById('rx-tabs');
  if (!tabs) return;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const allTab = `<button type="button" class="rx-tab${!_rxModal.value?' on':''}" onclick="switchReactorsTab(null)">Todas <b>${total}</b></button>`;
  const valueTabs = REACTIONS.filter(r2 => counts[r2.value] > 0).map(r2 =>
    `<button type="button" class="rx-tab${_rxModal.value===r2.value?' on':''}" onclick="switchReactorsTab(${r2.value})" style="${_rxModal.value===r2.value?`color:${r2.color}`:''}">${r2.emoji} <b>${counts[r2.value]}</b></button>`
  ).join('');
  tabs.innerHTML = allTab + valueTabs;
}
function reactorRowHtml(rx) {
  const rMeta = reactionMeta(rx.value);
  return `<div style="display:flex;align-items:center;gap:10px;padding:8px 2px">
    <span style="position:relative;display:flex;flex-shrink:0">
      ${avatar(rx.user.name, 40, rx.user.avatarUrl)}
      <span style="position:absolute;bottom:-3px;right:-3px;font-size:15px;background:var(--surf);border-radius:50%;line-height:1;padding:1px;display:flex">${rMeta ? reactionGlyphInner(rMeta, 15) : '❤️'}</span>
    </span>
    <div style="flex:1;min-width:0">
      <div style="font-size:13.5px;font-weight:700;display:flex;align-items:center;gap:4px">${esc(rx.user.name)}${rx.user.isPremium?`<span class="fc-verified" title="Premium"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="12" height="12"><path d="M12 2l2.4 1.2 2.6-.6 1.4 2.3 2.5.9-.2 2.7 1.7 2.1-1.7 2.1.2 2.7-2.5.9-1.4 2.3-2.6-.6L12 22l-2.4-1.2-2.6.6-1.4-2.3-2.5-.9.2-2.7L1.6 13.6l1.7-2.1-.2-2.7 2.5-.9 1.4-2.3 2.6.6z"/><path d="M9 12.5l2 2 4-4.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`:''}</div>
    </div>
  </div>`;
}
function switchReactorsTab(value) {
  _rxModal.value = value;
  document.getElementById('rx-list').innerHTML = `<div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">A carregar…</div>`;
  refreshReactorsModal();
}

// Lê o estado actual directamente do DOM (em vez de guardar estado
// paralelo em JS que podia desincronizar) para calcular, sem esperar
// pela rede, qual vai ser o próximo estado — e poder repor exactamente
// o anterior se o pedido falhar.
function computeOptimisticReaction(cardId, value) {
  const btn = document.querySelector(`[data-like-btn="${cardId}"]`);
  const current = btn ? (parseInt(btn.dataset.reaction, 10) || 0) : 0;
  const countEl = document.querySelector(`[data-like-count="${cardId}"]`);
  const currentCount = countEl ? (parseInt(countEl.textContent, 10) || 0) : 0;
  // value=0 = remover explicitamente (vem do modal de comentários);
  // valor igual ao actual = alternar (toque normal desliga a mesma reacção).
  const newReaction = value === 0 ? 0 : (current === value ? 0 : value);
  let delta = 0;
  if (current === 0 && newReaction !== 0) delta = 1;       // ninguém reagia, agora reage
  else if (current !== 0 && newReaction === 0) delta = -1; // reagia, agora deixou de reagir
  // trocar de reacção (ex: Adoro → Riso) não muda a contagem de pessoas
  return { current, currentCount, newReaction, newCount: Math.max(0, currentCount + delta) };
}

function applyReactionUI(cardId, myReaction, likeCount) {
  const rMeta = reactionMeta(myReaction);
  document.querySelectorAll(`[data-like-count="${cardId}"]`).forEach(el => el.textContent = likeCount || '');
  document.querySelectorAll(`[data-like-label="${cardId}"]`).forEach(el => el.textContent = rMeta ? rMeta.label : '');
  document.querySelectorAll(`[data-like-ico="${cardId}"]`).forEach(el => el.innerHTML = reactionIconSvg(myReaction, 20, true));
  document.querySelectorAll(`[data-like-btn="${cardId}"]`).forEach(btn => {
    btn.classList.toggle('liked', !!rMeta);
    btn.dataset.reaction = myReaction || 0;
    btn.style.color = rMeta ? rMeta.color : '';
  });
}

async function reactFeed(targetType, targetId, value = 1) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  const cardId = `feed-${targetType}-${targetId}`;
  const { current, currentCount, newReaction, newCount } = computeOptimisticReaction(cardId, value);

  // Aplica já — sem esperar pela rede — para sentir instantâneo, como
  // o Instagram/Facebook. O pedido HTTP só confirma em segundo plano.
  applyReactionUI(cardId, newReaction, newCount);
  if (newReaction) heartBurst(cardId, newReaction);

  try {
    const { likeCount, myReaction } = await syncReactionToServer({ targetType, targetId, value, cardId });
    return { likeCount, myReaction };
  } catch (e) {
    if (e?.networkError && window.ActionQueue) {
      // Sem rede — mantém a reacção aplicada no ecrã (não reverte) e
      // fica à espera de reenviar sozinha quando a ligação voltar
      // (mesmo que a página seja recarregada entretanto — o payload
      // fica guardado, não uma função em memória).
      ActionQueue.enqueue(`react:${cardId}`, 'react', { targetType, targetId, value, cardId }, 'reacção');
      toast('Sem ligação — a reacção vai ser enviada quando a internet voltar.', 'warn', 4000);
      return;
    }
    // Falhou por outro motivo (não é de rede) — repõe exactamente o
    // estado anterior, para não ficar "presa" numa reacção que nunca
    // chegou a ser guardada no servidor.
    applyReactionUI(cardId, current, currentCount);
    toast(apiErrorMessage(e), 'err');
  }
}

// Só a parte de rede de uma reacção — sem tocar em "qual é o estado
// actual no ecrã" (isso já foi decidido por computeOptimisticReaction
// no momento do toque). Reutilizada pelo replay da ActionQueue, que
// precisa de reenviar exactamente o mesmo pedido sem recalcular nada
// (chamar reactFeed outra vez trocaria a reacção para o lado
// contrário, porque reavaliaria a alternância a partir do estado já
// aplicado no ecrã).
async function syncReactionToServer({ targetType, targetId, value, cardId }) {
  const r = await api.post(`/feed/${targetType}/${targetId}/react`, { value });
  const { likeCount, myReaction } = r?.data || {};
  applyReactionUI(cardId, myReaction, likeCount);
  if (window.ActionQueue) ActionQueue.dequeue(`react:${cardId}`);
  return { likeCount, myReaction };
}
if (window.ActionQueue) ActionQueue.registerHandler('react', syncReactionToServer);

// Duplo-toque na imagem (estilo Instagram) — anima a reacção escolhida
// (ou o coração, por omissão) por cima da foto; nunca faz "unreact" no
// duplo-toque, só confirma ou mostra a animação se já tiver reagido.
function heartBurst(cardId, reaction = 1) {
  const host = document.querySelector(`[data-heart-host="${cardId}"]`);
  if (!host) return;
  const rMeta = reactionMeta(reaction) || REACTIONS[0];
  const hb = document.createElement('div');
  hb.className = 'heart-burst';
  hb.innerHTML = `<span class="rx-emoji rx-anim-${rMeta.value} rx-live" style="font-size:84px">${reactionGlyphInner(rMeta, 84)}</span>`;
  host.appendChild(hb);
  hb.addEventListener('animationend', () => hb.remove(), { once: true });
}
function doubleTapLike(el, targetType, targetId, alreadyLiked) {
  const cardId = `feed-${targetType}-${targetId}`;
  if (!alreadyLiked) reactFeed(targetType, targetId, 1);
  else heartBurst(cardId, 1); // já tem reacção — só mostra a animação, sem alterar
}

async function shareFeed(targetType, targetId) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  try {
    const r = await api.post(`/feed/${targetType}/${targetId}/share`, {});
    const { shareCount } = r?.data || {};
    const cardId = `feed-${targetType}-${targetId}`;
    document.querySelectorAll(`[data-share-count="${cardId}"]`).forEach(el => el.textContent = shareCount || '');
    toast('Partilhado no teu feed!', 'ok');
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
}

// ─── FOLHA DE PARTILHA ("Partilhar no feed" + apps externas) ────────
// Estilo Facebook/Instagram: repartilhar dentro do Bazares no topo, e
// por baixo uma fila de destinos externos (WhatsApp, Messenger, copiar
// ligação, mais opções via partilha nativa do telefone).
function shareTargetUrl(targetType, targetId, extra = {}) {
  const base = location.origin;
  if (targetType === 'PRODUCT') return `${base}/product/${encodeURIComponent(extra.slug || targetId)}`;
  if (targetType === 'ANNOUNCEMENT') return `${base}/home.html?announcement=${targetId}`;
  return `${base}/reels.html?reel=${targetId}`;
}
function openShareSheet(targetType, targetId, opts = {}) {
  const title = opts.title || 'Bazares';
  const url = opts.url || shareTargetUrl(targetType, targetId, opts);
  const text = `${title} — vê no Bazares!`;
  const canRepost = Session.isLoggedIn() && opts.allowRepost !== false;
  let root = document.getElementById('share-sheet-root');
  const wasClosed = !root;
  if (!root) { root = document.createElement('div'); root.id = 'share-sheet-root'; document.body.appendChild(root); }
  root.innerHTML = `
    <div class="cmts-bd" id="share-sheet-bd" onclick="if(event.target===this)closeShareSheet()">
      <div class="cmts-sheet" style="max-height:none">
        <div class="cmts-hd"><b>Partilhar</b><button class="modal-x" onclick="closeShareSheet()">${icon('close', 18, 2)}</button></div>
        <div style="padding:16px">
          ${canRepost ? `
          <button class="btn btn-soft btn-block" style="margin-bottom:14px;justify-content:flex-start;gap:10px" onclick="shareFeed('${targetType}','${targetId}');closeShareSheet()">
            ${icon('share', 18, 2)} Partilhar no feed do Bazares
          </button>` : ''}
          <div style="display:flex;gap:18px;overflow-x:auto;padding-bottom:4px">
            <a class="share-ext-btn" href="${waLink(text + '\n' + url)}" target="_blank" rel="noopener">
              <span class="share-ext-ico" style="background:#25D366">${icon('chat', 20, 2)}</span><span>WhatsApp</span>
            </a>
            <a class="share-ext-btn" href="fb-messenger://share?link=${encodeURIComponent(url)}" onclick="setTimeout(()=>{window.location='${url}'},600)">
              <span class="share-ext-ico" style="background:#0084FF">${icon('send', 20, 2)}</span><span>Messenger</span>
            </a>
            <button type="button" class="share-ext-btn" onclick="copyShareLink('${url.replace(/'/g, "\\'")}')">
              <span class="share-ext-ico" style="background:var(--t4)">${icon('link', 20, 2)}</span><span>Copiar link</span>
            </button>
            ${navigator.share ? `
            <button type="button" class="share-ext-btn" onclick="nativeShare('${title.replace(/'/g, "\\'")}','${text.replace(/'/g, "\\'")}','${url.replace(/'/g, "\\'")}')">
              <span class="share-ext-ico" style="background:var(--b-500)">${icon('more', 20, 2)}</span><span>Mais</span>
            </button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  if (wasClosed) _bzOpenOverlay();
}
function closeShareSheet() {
  const had = document.getElementById('share-sheet-root');
  had?.remove();
  if (had) _bzConsumeOverlayGuard();
}
async function copyShareLink(url) {
  try { await navigator.clipboard.writeText(url); toast('Ligação copiada!', 'ok'); }
  catch { toast('Não foi possível copiar.', 'err'); }
  closeShareSheet();
}
function nativeShare(title, text, url) {
  if (navigator.share) navigator.share({ title, text, url }).catch(() => {});
  closeShareSheet();
}

// ─── COMENTÁRIOS — modal partilhado (produtos, posts e reels) ────
// Ecrã cheio ao estilo Facebook: lista com gosto + resposta por
// comentário (thread de 1 nível), apagar (autor ou dono da publicação)
// e um campo de escrita fixo em baixo. Usado por home.html, reels.html,
// newreels.html, anuncios.html e product.html — uma só implementação.
let _cmModal = { targetType: null, targetId: null, replyTo: null, isOwner: false, onCountChange: null, sort: 'top', myReaction: 0 };

function openCommentsModal(targetType, targetId, opts = {}) {
  const cardId = `feed-${targetType}-${targetId}`;
  // Se o cartão já estiver na página por trás do modal, lê a reacção
  // actual dele para a barra de "Reações rápidas" abrir já assinalada.
  const existingBtn = document.querySelector(`[data-like-btn="${cardId}"]`);
  const myReaction = opts.myReaction != null ? opts.myReaction : Number(existingBtn?.dataset.reaction || 0);
  _cmModal = { targetType, targetId, replyTo: null, isOwner: !!opts.isOwner, onCountChange: opts.onCountChange || null, sort: 'top', myReaction };
  const loggedIn = Session.isLoggedIn();
  let root = document.getElementById('cmts-root');
  const wasClosed = !root; // só arma o botão voltar na abertura real — trocar de publicação com a folha já aberta não deve empilhar outra entrada
  if (!root) { root = document.createElement('div'); root.id = 'cmts-root'; document.body.appendChild(root); }
  root.innerHTML = `
    <div class="cmts-bd" id="cmts-bd" onclick="if(event.target===this)closeCommentsModal()">
      <div class="cmts-sheet">
        <div class="cmts-drag"></div>
        <div class="cmts-hd"><b>Comentários <span class="cmts-count-badge" id="cmts-count-badge">0</span></b><button class="modal-x" onclick="closeCommentsModal()">${icon('close', 18, 2)}</button></div>
        <div class="cmts-tabs">
          <button type="button" class="cmts-tab on" id="cmts-tab-top" onclick="setCommentsSort('top')">Todos</button>
          <button type="button" class="cmts-tab" id="cmts-tab-recent" onclick="setCommentsSort('recent')">Mais recentes ${icon('arrowRight',13,2.4)}</button>
          <button type="button" class="cmts-sort-btn" title="Ordenar" onclick="setCommentsSort(_cmModal.sort==='recent'?'top':'recent')">${icon('bars', 17, 2)}</button>
        </div>
        <div id="cmts-list" class="cmts-list"><div style="text-align:center;padding:30px"><span class="spinner spinner-dark"></span></div></div>
        ${loggedIn ? `
        <div id="cmts-replyto" style="display:none;padding:6px 16px 0;font-size:11.5px;color:var(--t4)"></div>
        <div class="cmts-input-bar">
          ${avatar(Session.user?.name, 32, Session.user?.avatarUrl || null)}
          <input id="cmts-input" placeholder="Escreve um comentário..." maxlength="500" onkeydown="if(event.key==='Enter'){event.preventDefault();submitModalComment();}">
          <div class="cmts-input-icons">
            <button type="button" title="Anexar foto" onclick="toast('Fotos em comentários — em breve!','info')">${icon('image', 19, 2)}</button>
            <button type="button" title="Enviar" onclick="submitModalComment()">${icon('send', 20, 2)}</button>
          </div>
        </div>
        <div class="cmts-quick">
          <span class="cmts-quick-label">Reações rápidas</span>
          <div class="cmts-quick-row" id="cmts-quick-row">${reactionQuickRowHtml(targetType, targetId, myReaction)}</div>
        </div>` : `
        <div style="padding:12px 16px calc(env(safe-area-inset-bottom,0px) + 12px);border-top:1px solid var(--brd)">
          <button class="btn btn-ghost btn-block btn-sm" onclick="go('login.html')">Inicia sessão para comentar</button>
        </div>`}
      </div>
    </div>`;
  if (loggedIn) { const input = document.getElementById('cmts-input'); if (input) attachMentionAutocomplete(input); }
  refreshCommentsModal();
  if (wasClosed) _bzOpenOverlay();
}
function closeCommentsModal() {
  const had = document.getElementById('cmts-root');
  had?.remove();
  _cmModal = { targetType: null, targetId: null, replyTo: null, isOwner: false, onCountChange: null, sort: 'top', myReaction: 0 };
  if (had) _bzConsumeOverlayGuard();
}
function setCommentsSort(mode) {
  if (_cmModal.sort === mode) return;
  _cmModal.sort = mode;
  document.getElementById('cmts-tab-top')?.classList.toggle('on', mode === 'top');
  document.getElementById('cmts-tab-recent')?.classList.toggle('on', mode === 'recent');
  refreshCommentsModal();
}
// ─── "Reações rápidas" — as 7 reacções (mesmas de feedReactionBar),
// para reagir à publicação sem sair da folha de comentários. Reutiliza
// reactFeed(), que já actualiza sozinho o cartão por trás do modal.
function reactionQuickRowHtml(targetType, targetId, myReaction) {
  return REACTIONS.map(r => `
    <button type="button" class="cmts-qr-btn${myReaction === r.value ? ' on' : ''}" id="cmts-qr-${r.value}"
      style="background:${r.color}1F" title="${r.label}"
      onclick="modalPickReaction('${targetType}','${targetId}',${r.value})">
      <span class="rx-emoji rx-anim-${r.value}" style="font-size:19px">${reactionGlyphInner(r, 19)}</span>
    </button>`).join('');
}
async function modalPickReaction(targetType, targetId, value) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  const already = _cmModal.myReaction === value;
  const res = await reactFeed(targetType, targetId, already ? 0 : value); // toque na já-escolhida remove
  const applied = already ? 0 : (res?.myReaction ?? value);
  _cmModal.myReaction = applied;
  document.querySelectorAll('#cmts-quick-row .cmts-qr-btn').forEach(b => b.classList.remove('on'));
  if (applied) document.getElementById(`cmts-qr-${applied}`)?.classList.add('on');
}
async function refreshCommentsModal() {
  const list = document.getElementById('cmts-list');
  const badge = document.getElementById('cmts-count-badge');
  if (!list || !_cmModal.targetId) return;
  try {
    const r = await api.get(`/feed/${_cmModal.targetType}/${_cmModal.targetId}/comments`, { limit: 50 });
    let comments = r?.data?.comments || [];
    if (_cmModal.sort === 'recent') {
      comments = [...comments].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    const total = comments.reduce((s, c) => s + 1 + (c.replyCount || 0), 0);
    if (badge) badge.textContent = total;
    list.innerHTML = comments.length ? comments.map(c => cmtModalRowHtml(c, false)).join('') : `
      <div class="cmts-empty">
        <div class="cmts-empty-ico">${icon('chat', 30, 1.8)}</div>
        <h3>Seja o próximo a comentar!</h3>
        <p>Partilha a tua opinião.</p>
      </div>`;
    if (_cmModal.onCountChange) _cmModal.onCountChange(total);
  } catch { list.innerHTML = `<div class="cmts-empty"><p>Não foi possível carregar os comentários.</p></div>`; }
}
function cmtModalRowHtml(c, isReply) {
  const replies = c.replies || [];
  const isMine = Session.user && c.userId === Session.user.id;
  const canDelete = Session.user && (isMine || _cmModal.isOwner);
  const extraReplies = (c.replyCount || 0) - replies.length;
  return `
  <div class="cmt-row${isReply ? ' is-reply' : ''}" id="cmt-${c.id}">
    <div class="cmt-avatar">${avatar(c.user?.name, isReply ? 28 : 36, c.user?.avatarUrl || null)}</div>
    <div class="cmt-body">
      <div class="cmt-name-line"><span class="cmt-name">${esc(c.user?.name || '')}</span>${c.user?.role && ROLE_LABEL[c.user.role] ? `<span class="cmt-role-badge cmt-role-badge--${c.user.role.toLowerCase()}">${ROLE_LABEL[c.user.role]}</span>` : ''}</div>
      <p class="cmt-text" id="cmt-text-${c.id}">${escWithMentions(c.text)}${c.editedAt ? ` <span style="color:var(--t4);font-size:11px">(editado)</span>` : ''}</p>
      <div class="cmt-meta">
        <span>${c.createdAt ? timeAgo(c.createdAt) : ''}</span>
        ${Session.isLoggedIn() ? `<button type="button" onclick="replyToModalComment('${isReply ? (c.parentId || c.id) : c.id}','${esc((c.user?.name || '').replace(/'/g, "\\'"))}')">Responder</button>` : ''}
        ${isMine ? `<button type="button" onclick="editModalComment('${c.id}')">Editar</button>` : ''}
        ${canDelete ? `<button type="button" onclick="deleteModalComment('${c.id}')">Apagar</button>` : ''}
      </div>
      ${(!isReply && replies.length) ? `
      <div class="cmt-replies" id="cmt-replies-${c.id}">${replies.map(r => cmtModalRowHtml(r, true)).join('')}</div>
      ${extraReplies > 0 ? `<button type="button" class="cmt-replies-toggle" onclick="loadMoreReplies('${c.id}',this)">Ver mais ${extraReplies} resposta${extraReplies === 1 ? '' : 's'}</button>` : ''}
      ` : ''}
    </div>
    <button type="button" class="cmt-like${c.likedByMe ? ' liked' : ''}" data-cmt-like="${c.id}" onclick="toggleModalCommentLike('${c.id}')">
      ${c.likedByMe ? `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="15" height="15">${ICONS.heart}</svg>` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">${ICONS.heart}</svg>`}
      <span data-cmt-like-count="${c.id}">${c.likeCount || ''}</span>
    </button>
  </div>`;
}
function editModalComment(commentId) {
  const p = document.getElementById(`cmt-text-${commentId}`);
  if (!p) return;
  const current = p.firstChild?.textContent || '';
  p.innerHTML = `<textarea id="cmt-edit-${commentId}" maxlength="500" rows="2" style="width:100%;font:inherit;padding:6px 8px;border:1px solid var(--brd);border-radius:var(--r);resize:vertical">${esc(current)}</textarea>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button type="button" class="btn btn-primary btn-xs" onclick="saveModalComment('${commentId}')">Guardar</button>
      <button type="button" class="btn btn-ghost btn-xs" onclick="refreshCommentsModal()">Cancelar</button>
    </div>`;
  attachMentionAutocomplete(document.getElementById(`cmt-edit-${commentId}`));
}
async function saveModalComment(commentId) {
  const ta = document.getElementById(`cmt-edit-${commentId}`);
  const text = ta?.value?.trim();
  if (!text) { toast('Escreva um comentário.', 'warn'); return; }
  try {
    await api.put(`/feed/comments/${commentId}`, { text });
    await refreshCommentsModal();
    toast('Comentário actualizado.', 'ok');
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
}
async function loadMoreReplies(parentId, btn) {
  btn.textContent = 'A carregar...';
  try {
    const r = await api.get(`/feed/comments/${parentId}/replies`, { limit: 50 });
    const replies = r?.data?.replies || [];
    const wrap = document.getElementById(`cmt-replies-${parentId}`);
    if (wrap) wrap.innerHTML = replies.map(r2 => cmtModalRowHtml(r2, true)).join('');
    btn.remove();
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
}
function replyToModalComment(commentId, name) {
  _cmModal.replyTo = { id: commentId, name };
  const bar = document.getElementById('cmts-replyto');
  const input = document.getElementById('cmts-input');
  if (bar) { bar.style.display = 'flex'; bar.style.justifyContent = 'space-between'; bar.innerHTML = `<span>A responder a <strong>${esc(name)}</strong></span><button type="button" style="color:var(--t4);font-weight:700" onclick="cancelModalReply()">Cancelar</button>`; }
  if (input) { input.placeholder = `Responder a ${name}...`; input.focus(); }
}
function cancelModalReply() {
  _cmModal.replyTo = null;
  const bar = document.getElementById('cmts-replyto');
  const input = document.getElementById('cmts-input');
  if (bar) bar.style.display = 'none';
  if (input) input.placeholder = 'Escreve um comentário...';
}
async function toggleModalCommentLike(commentId) {
  if (!Session.isLoggedIn()) { go('login.html'); return; }
  const btn = document.querySelector(`[data-cmt-like="${commentId}"]`);
  const countEls = document.querySelectorAll(`[data-cmt-like-count="${commentId}"]`);
  const wasLiked = btn?.classList.contains('liked');
  const wasCount = parseInt(countEls[0]?.textContent, 10) || 0;

  const paint = (liked, count) => {
    if (btn) { btn.classList.toggle('liked', liked); btn.querySelector('svg')?.setAttribute('fill', liked ? 'currentColor' : 'none'); }
    countEls.forEach(el => el.textContent = count || '');
  };
  paint(!wasLiked, Math.max(0, wasCount + (wasLiked ? -1 : 1))); // aplica já — sem esperar pela rede

  try {
    const r = await api.post(`/feed/comments/${commentId}/like`, {});
    const { liked, likeCount } = r?.data || {};
    paint(liked, likeCount); // reconcilia com a resposta real
  } catch (e) {
    paint(wasLiked, wasCount); // repõe o estado anterior
    toast(apiErrorMessage(e), 'err');
  }
}
async function deleteModalComment(commentId) {
  const row = document.getElementById(`cmt-${commentId}`);
  if (!row) { try { await api.delete(`/feed/comments/${commentId}`); await refreshCommentsModal(); } catch (e) { toast(apiErrorMessage(e), 'err'); } return; }

  const placeholder = document.createComment(`cmt-placeholder-${commentId}`);
  row.replaceWith(placeholder);

  Bazares.Undo.perform({
    message: 'Comentário removido.',
    onUndo: () => { refreshCommentsModal(); },
    onCommit: async () => {
      placeholder.remove();
      await api.delete(`/feed/comments/${commentId}`);
      await refreshCommentsModal(); // actualiza a contagem total no cabeçalho
    }
  });
}
async function submitModalComment() {
  const input = document.getElementById('cmts-input');
  const text = input?.value?.trim();
  if (!text || !_cmModal.targetId) return;
  try {
    const body = { text };
    if (_cmModal.replyTo) body.parentId = _cmModal.replyTo.id;
    await api.post(`/feed/${_cmModal.targetType}/${_cmModal.targetId}/comments`, body);
    input.value = '';
    cancelModalReply();
    await refreshCommentsModal();
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
}

// Pré-visualização dos 2 últimos comentários directamente no cartão
// (ao estilo Facebook), sem ser preciso abrir a caixa de comentários.
async function loadCommentPreviews(items) {
  const withComments = items.filter(it => (it.commentCount || 0) > 0);
  await Promise.all(withComments.map(async it => {
    const cardId = `feed-${it.targetType}-${it.targetId}`;
    const el = document.getElementById(`${cardId}-preview`);
    if (!el) return;
    const bazarId = (it.product || it.announcement)?.bazar?.id;
    const isOwner = it.isOwner != null ? !!it.isOwner : (bazarId && bazarId === window._myBazarId);
    try {
      const r = await api.get(`/feed/${it.targetType}/${it.targetId}/comments`, { limit: 2 });
      const comments = r?.data?.comments || [];
      if (!comments.length) return;
      el.innerHTML = comments.map(c => `
        <div style="font-size:12.5px;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer" onclick="openCommentsModal('${it.targetType}','${it.targetId}',{isOwner:${!!isOwner}})">
          <strong style="color:var(--text)">${esc(c.user?.name || '')}</strong> ${escWithMentions(c.text)}
        </div>`).join('') +
        (it.commentCount > 2 ? `<button class="btn-ghost" style="background:none;border:none;padding:0;font-size:12px;color:var(--t4);cursor:pointer;font-weight:600" onclick="openCommentsModal('${it.targetType}','${it.targetId}',{isOwner:${!!isOwner}})">Ver todos os ${it.commentCount} comentários</button>` : '');
    } catch {}
  }));
}

// ─── Histórias (24h) — módulo partilhado ───────────────────────────
// Ao estilo Instagram/TikTok: barra de anéis no topo + visualizador
// em ecrã inteiro. Suporta fotos e (quando o backend fornecer
// `videoUrl`) vídeos curtos — ver nota em publishStory().
// A faixa mistura histórias reais com lojas em destaque (para nunca
// ficar vazia): anel transparente por padrão, laranja só quando a
// loja tem uma história nova por ver.
let _storyGroups = [];
let _featuredBazars = [];
let _storyState = { groupIdx: 0, storyIdx: 0, timer: null };
let _storiesBarId = 'stories-bar';
let _storiesCanAdd = false;
function setStoriesCanAdd(v) { _storiesCanAdd = !!v; }

async function loadStories(barId = 'stories-bar') {
  _storiesBarId = barId;
  const bar = document.getElementById(barId);
  if (!bar) return;
  try {
    const r = await api.get('/stories');
    _storyGroups = r?.data?.groups || [];
  } catch { _storyGroups = []; }
  try {
    const rb = await api.get('/bazars', { limit: 12 });
    _featuredBazars = rb?.data?.bazars || [];
  } catch { _featuredBazars = []; }
  renderStoriesBar(barId);
}

function renderStoriesBar(barId = _storiesBarId) {
  const bar = document.getElementById(barId);
  if (!bar) return;

  // O grupo do próprio bazar (se tiver uma história activa) fica
  // representado pelo botão "A tua história", não repetido na lista.
  const myBazarId = window._myBazarId || null;
  const ownIdx = myBazarId ? _storyGroups.findIndex(g => g.bazar?.id === myBazarId) : -1;
  const others = _storyGroups.filter((g, i) => i !== ownIdx);
  const storyBazarIds = new Set(_storyGroups.map(g => g.bazar?.id).filter(Boolean));

  // Lojas em destaque sem história activa — completam a faixa com
  // anel transparente, para nunca deixar o espaço em branco.
  const extraStores = _featuredBazars.filter(b => b.id !== myBazarId && !storyBazarIds.has(b.id));

  const ownTile = _storiesCanAdd ? `
    <div class="story-tile" style="display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0;width:78px;cursor:pointer"
      onclick="${ownIdx > -1 ? `openStoryViewer(${ownIdx},'${barId}')` : `go('historia.html')`}">
      <div style="position:relative;width:74px;height:74px">
        <div style="width:74px;height:74px;border-radius:50%;padding:4.5px;background:${ownIdx > -1 ? (_storyGroups[ownIdx].hasUnseen ? 'linear-gradient(135deg,var(--g-green),#F59E0B)' : 'var(--g-300)') : 'var(--b-300)'}">
          <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;border:2px solid var(--surf)">
            ${avatar(Session.user?.name, 68, userPhoto(Session.user))}
          </div>
        </div>
        <span style="position:absolute;bottom:0;right:0;width:22px;height:22px;border-radius:50%;background:var(--b-500);color:#fff;border:2px solid var(--surf);display:flex;align-items:center;justify-content:center;box-shadow:var(--sh1)">${icon('plus', 12, 3)}</span>
      </div>
      <span style="font-size:11px;font-weight:700;color:var(--text);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:74px">A tua história</span>
    </div>` : '';

  if (!others.length && !ownTile && !extraStores.length) {
    bar.innerHTML = '';
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';

  // Anel do círculo: 'unseen' (gradiente verde/dourado, história nova),
  // 'seen' (cinzento, já viste), 'none' (a loja não tem história activa —
  // anel colorido simples, cor sólida da marca, para não se confundir
  // com "já vista" nem desaparecer como um anel transparente).
  const ringFor = state => state === 'unseen'
    ? 'linear-gradient(135deg,var(--g-green),#F59E0B)'
    : state === 'seen' ? 'var(--g-300)' : 'var(--b-300)';

  const storyTile = (name, logoUrl, state, onclick, verified = false) => `
    <div class="story-tile" style="display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0;width:78px;cursor:pointer" onclick="${onclick}">
      <div style="width:74px;height:74px;border-radius:50%;padding:4.5px;background:${ringFor(state)}">
        <div style="width:100%;height:100%;border-radius:50%;overflow:hidden;border:2px solid var(--surf)">
          ${storeAvatar(name, 68, logoUrl || null, verified)}
        </div>
      </div>
      <span style="font-size:11px;font-weight:700;color:var(--text);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:74px">${esc(name || '')}</span>
    </div>`;

  const othersHtml = others.map(g => {
    const i = _storyGroups.indexOf(g);
    const verified = !!(g.bazar?.verified || g.bazar?.seller?.verifiedSeller);
    return storyTile(g.bazar?.name, bazarLogo(g.bazar), g.hasUnseen ? 'unseen' : 'seen', `openStoryViewer(${i},'${barId}')`, verified);
  }).join('');

  const extraHtml = extraStores.map(b => {
    const verified = !!(b.verified || b.seller?.verifiedSeller);
    return storyTile(b.name, bazarLogo(b), 'none', `go('bazar.html',{id:'${escJsAttr(b.slug || b.id)}'})`, verified);
  }).join('');

  bar.innerHTML = ownTile + othersHtml + extraHtml;
}

function openStoryViewer(groupIdx, barId = _storiesBarId) {
  _storiesBarId = barId;
  _storyState = { groupIdx, storyIdx: 0, timer: null };
  const g = _storyGroups[groupIdx];
  const firstUnseen = g?.stories.findIndex(s => !s.seen);
  if (firstUnseen > 0) _storyState.storyIdx = firstUnseen;

  let root = document.getElementById('story-viewer-root');
  const wasClosed = !root;
  if (!root) { root = document.createElement('div'); root.id = 'story-viewer-root'; document.body.appendChild(root); }
  root.innerHTML = `
    <div id="story-viewer" style="position:fixed;inset:0;background:#000;z-index:999;display:flex;flex-direction:column;animation:storyViewerIn .22s cubic-bezier(.2,.8,.2,1)">
      <div id="story-progress" style="display:flex;gap:4px;padding:10px 10px 0"></div>
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px">
        <div id="story-avatar-wrap" style="width:30px;height:30px;border-radius:50%;overflow:hidden;cursor:pointer" onclick="storyGoToBazar()"></div>
        <div style="flex:1;display:flex;align-items:center;gap:4px;cursor:pointer;min-width:0" onclick="storyGoToBazar()">
          <strong id="story-bazar-name" style="color:#fff;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></strong>
          <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" style="flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <span id="story-time" style="color:rgba(255,255,255,.7);font-size:11px"></span>
        <button id="story-mute-btn" onclick="toggleStoryMute()" style="display:none;background:none;border:none;color:#fff;padding:4px"></button>
        <button id="story-kebab-btn" onclick="openStoryKebab()" class="btn-kebab btn-kebab--light" style="display:none"><svg class="ico-inline" viewBox="0 0 24 24" fill="currentColor" stroke="none" width="18" height="18"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
        <button onclick="closeStoryViewer()" style="background:none;border:none;color:#fff;padding:4px"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden">
        <div id="story-media" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center"></div>
        <div id="story-product-chip"></div>
        <p id="story-caption" style="position:absolute;left:14px;right:14px;bottom:18px;color:#fff;font-size:13.5px;text-shadow:0 1px 4px rgba(0,0,0,.6);margin:0"></p>
        <div onpointerdown="storyPressStart(event)" onpointerup="storyPressEnd()" onpointerleave="storyPressEnd()" onpointercancel="storyPressEnd()" onclick="storyZoneClick('prev')" style="position:absolute;left:0;top:0;bottom:0;width:35%;cursor:pointer"></div>
        <div onpointerdown="storyPressStart(event)" onpointerup="storyPressEnd()" onpointerleave="storyPressEnd()" onpointercancel="storyPressEnd()" onclick="storyZoneClick('next')" style="position:absolute;right:0;top:0;bottom:0;width:65%;cursor:pointer"></div>
      </div>
      <div id="story-footer" style="padding:10px 14px 16px;flex-shrink:0"></div>
    </div>`;
  renderStoryFrame();
  if (wasClosed) _bzOpenOverlay();
}

function _isMyStory(g) { return !!(g?.bazar?.id && g.bazar.id === window._myBazarId); }

// ─── PAUSAR HISTÓRIA (pressionar e segurar) ──────────────────────
// Ao estilo Instagram/WhatsApp: premir e segurar em qualquer zona de
// navegação pausa o vídeo/temporizador; largar retoma. Um toque rápido
// (sem segurar) continua a navegar para trás/frente como antes.
let _storyHoldTimer = null;
let _storyHeld = false;
let _storySuppressClick = false;
function storyPressStart(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  clearTimeout(_storyHoldTimer);
  _storyHoldTimer = setTimeout(() => { _storyHeld = true; storyPause(); }, 180);
}
function storyPressEnd() {
  clearTimeout(_storyHoldTimer);
  if (_storyHeld) { _storyHeld = false; _storySuppressClick = true; storyResume(); }
}
function storyZoneClick(dir) {
  if (_storySuppressClick) { _storySuppressClick = false; return; }
  dir === 'prev' ? storyPrev() : storyNext();
}
function storyPause() {
  if (_storyState.paused) return;
  _storyState.paused = true;
  clearTimeout(_storyState.timer);
  document.getElementById('story-video')?.pause();
  document.querySelectorAll('.story-fill-bar').forEach(b => b.style.animationPlayState = 'paused');
  document.getElementById('story-viewer')?.classList.add('story-is-paused');
}
function storyResume() {
  if (!_storyState.paused) return;
  _storyState.paused = false;
  const vid = document.getElementById('story-video');
  if (vid) {
    vid.play().catch(() => {});
  } else {
    const bars = document.querySelectorAll('.story-fill-bar');
    const bar = bars[_storyState.storyIdx];
    let remaining = 5000;
    if (bar) {
      const track = bar.parentElement;
      const pct = track?.offsetWidth ? (bar.offsetWidth / track.offsetWidth) : 0;
      remaining = Math.max(300, 5000 * (1 - pct));
    }
    _storyState.timer = setTimeout(() => storyNext(), remaining);
  }
  document.querySelectorAll('.story-fill-bar').forEach(b => b.style.animationPlayState = 'running');
  document.getElementById('story-viewer')?.classList.remove('story-is-paused');
}

// ─── REACÇÕES RÁPIDAS NAS HISTÓRIAS ──────────────────────────────
// Fila de emojis por cima do campo de resposta — um toque envia logo
// a reacção (mesmo endpoint da resposta de texto, com o emoji como
// conteúdo), sem tirar o foco da história como escrever demoraria.
const STORY_QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];
async function sendStoryQuickReaction(storyId, emoji, btn) {
  clearTimeout(_storyState.timer);
  btn?.classList.add('sent');
  setTimeout(() => btn?.classList.remove('sent'), 550);
  try {
    await api.post(`/stories/${storyId}/reply`, { text: emoji });
    toast('Reação enviada!', 'ok');
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
  if (!_storyState.paused) _storyState.timer = setTimeout(() => storyNext(), 5000);
}

// Som das histórias em vídeo — mesmo padrão do reels.html: começa com
// som ligado, e o botão fica visível só quando a história actual é vídeo.
let _storyMuted = false;
function renderStoryMuteBtn() {
  const btn = document.getElementById('story-mute-btn');
  if (!btn) return;
  btn.innerHTML = icon(_storyMuted ? 'volumeOff' : 'volumeOn', 18, 2);
}
function toggleStoryMute() {
  _storyMuted = !_storyMuted;
  const vid = document.getElementById('story-video');
  if (vid) vid.muted = _storyMuted;
  renderStoryMuteBtn();
}

// Kebab (Editar/Eliminar) da própria história — mesma linguagem visual
// do menu "Gerir publicação" usado no feed (produtos/posts/reels).
// Editar leva à página de criar história com o conteúdo já preenchido
// (legenda, posição, hashtags e a foto/vídeo actual, com opção de
// trocar) — deixou de ser só um popup a editar a legenda.
function openStoryKebab() {
  const g = _storyGroups[_storyState.groupIdx];
  const s = g?.stories[_storyState.storyIdx];
  if (!s || !_isMyStory(g)) return;
  clearTimeout(_storyState.timer);
  openModal(`<div class="modal-hd"><h3>Gerir história</h3><button class="modal-x" onclick="closeModal()">${icon('close', 18, 2)}</button></div>
    <div style="display:flex;flex-direction:column;gap:9px">
      <button class="btn btn-ghost btn-block" onclick="closeModal();go('historia.html',{edit:'${s.id}',bazar:'${g.bazar?.id||''}'})">${icon('settings', 17, 1.8)} Editar</button>
      <button class="btn btn-danger btn-block" onclick="deleteStory('${s.id}')">${icon('close', 17, 2)} Eliminar</button>
    </div>`);
}
async function deleteStory(storyId) {
  try {
    await api.delete(`/stories/${storyId}`);
    closeModal();
    toast('História eliminada.', 'ok');
    const g = _storyGroups[_storyState.groupIdx];
    g.stories = g.stories.filter(x => x.id !== storyId);
    if (!g.stories.length) {
      _storyGroups.splice(_storyState.groupIdx, 1);
      storyNextGroup();
    } else {
      if (_storyState.storyIdx >= g.stories.length) _storyState.storyIdx = g.stories.length - 1;
      renderStoryFrame();
    }
    renderStoriesBar();
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
}

// Sair da história e ir directo à loja — a forma de "ver o bazar" sem
// perder a história a meio (ex: quando se está só de passagem a ver).
function storyGoToBazar() {
  const g = _storyGroups[_storyState.groupIdx];
  if (!g?.bazar) return;
  closeStoryViewer();
  go('bazar.html', { id: g.bazar.slug || g.bazar.id });
}

function renderStoryFooter(g, s) {
  const footer = document.getElementById('story-footer');
  if (_isMyStory(g)) {
    footer.innerHTML = `
      <button onclick="openStoryViewers('${s.id}')" style="background:rgba(255,255,255,.12);border:none;color:#fff;padding:10px 14px;border-radius:var(--pill);display:flex;align-items:center;gap:6px;font-size:12.5px">
        <svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        Ver visualizações
      </button>`;
  } else {
    footer.innerHTML = `
      <div class="story-quick-react-row">
        ${STORY_QUICK_REACTIONS.map(e => `<button type="button" class="story-quick-react" onclick="sendStoryQuickReaction('${s.id}','${e}',this)">${e}</button>`).join('')}
      </div>
      <form onsubmit="return submitStoryReply(event,'${s.id}')" style="display:flex;gap:8px;align-items:center">
        <input id="story-reply-input" placeholder="Responder à história..." maxlength="500"
          style="flex:1;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.3);border-radius:var(--pill);color:#fff;padding:10px 16px;font-size:13px"
          onfocus="clearTimeout(_storyState.timer)" onblur="if(!_storyState.paused)_storyState.timer=setTimeout(()=>storyNext(),5000)">
        <button type="submit" style="background:none;border:none;color:#fff;flex-shrink:0"><svg class="ico-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
      </form>`;
  }
}

async function submitStoryReply(e, storyId) {
  e.preventDefault();
  const input = document.getElementById('story-reply-input');
  const text = input?.value?.trim();
  if (!text) return false;
  clearTimeout(_storyState.timer);
  try {
    await api.post(`/stories/${storyId}/reply`, { text });
    input.value = '';
    toast('Resposta enviada!');
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
  _storyState.timer = setTimeout(() => storyNext(), 5000);
  return false;
}

async function openStoryViewers(storyId) {
  clearTimeout(_storyState.timer);
  try {
    const r = await api.get(`/stories/${storyId}/viewers`);
    const { count, views } = r?.data || { count: 0, views: [] };
    openModal(`
      <div class="modal-hd"><h3>${count} visualiza${count === 1 ? 'ção' : 'ções'}</h3><button class="modal-x" onclick="closeModal()">${icon('close', 18, 2)}</button></div>
      <div style="display:flex;flex-direction:column;gap:10px;max-height:50vh;overflow-y:auto">
        ${views.length ? views.map(v => `
          <div style="display:flex;align-items:center;gap:10px">
            ${avatar(v.user.name, 32, v.user.avatarUrl || null)}
            <div style="flex:1"><div style="font-size:13px;font-weight:600">${esc(v.user.name)}</div></div>
            <span style="font-size:11px;color:var(--t4)">${timeAgo(v.createdAt)}</span>
          </div>`).join('') : `<p style="color:var(--t4);font-size:13px;text-align:center;padding:20px 0">Ainda ninguém viu esta história.</p>`}
      </div>
    `);
  } catch (e) { toast(apiErrorMessage(e), 'err'); }
}

function renderStoryFrame() {
  const g = _storyGroups[_storyState.groupIdx];
  if (!g) { closeStoryViewer(); return; }
  const s = g.stories[_storyState.storyIdx];
  if (!s) { storyNextGroup(); return; }

  _storyState.paused = false;
  document.getElementById('story-viewer')?.classList.remove('story-is-paused');

  document.getElementById('story-progress').innerHTML = g.stories.map((_, i) => `
    <div style="flex:1;height:2.5px;background:rgba(255,255,255,.35);border-radius:2px;overflow:hidden">
      <div class="story-fill-bar" style="height:100%;background:#fff;width:${i < _storyState.storyIdx ? '100%' : '0%'};${i === _storyState.storyIdx ? 'animation:story-fill 5s linear forwards' : ''}"></div>
    </div>`).join('');
  document.getElementById('story-avatar-wrap').innerHTML = storeAvatar(g.bazar?.name, 30, bazarLogo(g.bazar));
  document.getElementById('story-bazar-name').textContent = g.bazar?.name || '';
  document.getElementById('story-time').textContent = timeAgo(s.createdAt);

  // Suporte a vídeo (quando o backend indicar s.videoUrl) além de foto.
  // Som ligado por padrão (tal como nos reels) — só cai para mudo se o
  // browser bloquear o autoplay com som.
  const media = document.getElementById('story-media');
  const muteBtn = document.getElementById('story-mute-btn');
  clearTimeout(_storyState.timer);
  if (s.videoUrl) {
    media.innerHTML = `<video id="story-video" src="${esc(s.videoUrl)}" autoplay playsinline style="max-width:100%;max-height:100%;object-fit:contain"></video>`;
    const vid = document.getElementById('story-video');
    vid.muted = _storyMuted;
    vid.addEventListener('ended', () => storyNext(), { once: true });
    vid.play().catch(() => {
      if (!vid.muted) { vid.muted = true; _storyMuted = true; vid.play().catch(() => {}); }
      renderStoryMuteBtn();
    });
    muteBtn.style.display = 'flex';
    renderStoryMuteBtn();
  } else {
    media.innerHTML = `<img id="story-img" src="${esc(cldImg(s.imageUrl,1080))}" alt="" decoding="async" style="max-width:100%;max-height:100%;object-fit:contain">`;
    _storyState.timer = setTimeout(() => storyNext(), 5000);
    muteBtn.style.display = 'none';
  }
  document.getElementById('story-caption').textContent = s.text || '';
  const productChip = document.getElementById('story-product-chip');
  if (s.product) {
    // Preço à esquerda, botão "Comprar" à direita — por cima da legenda,
    // mesma leitura dos Reels e dos Posts com produto associado.
    productChip.innerHTML = `<div class="fc-buy-bar fc-buy-bar--story" style="left:0;right:0;bottom:${s.text ? '46px' : '0'}" onclick="event.stopPropagation()">
      <span class="fc-buy-price">${fmtMT(s.product.price)}</span>
      <button type="button" class="fc-buy-btn" onclick="event.stopPropagation();closeStoryViewer();go('product.html',{id:'${escJsAttr(s.product.slug || s.product.id)}'})">${icon('cart',20,2.4)}<span>Comprar</span></button>
    </div>`;
  } else {
    productChip.innerHTML = '';
  }
  const kebabBtn = document.getElementById('story-kebab-btn');
  if (kebabBtn) kebabBtn.style.display = _isMyStory(g) ? 'flex' : 'none';
  renderStoryFooter(g, s);

  api.post(`/stories/${s.id}/view`, {}).catch(() => {});
  s.seen = true;
  g.hasUnseen = g.stories.some(x => !x.seen);
  renderStoriesBar();
  if (typeof window.onStorySeenChange === 'function') window.onStorySeenChange();
}

function storyNext() {
  const g = _storyGroups[_storyState.groupIdx];
  if (_storyState.storyIdx < g.stories.length - 1) {
    _storyState.storyIdx++;
    renderStoryFrame();
  } else {
    storyNextGroup();
  }
}
function storyPrev() {
  if (_storyState.storyIdx > 0) {
    _storyState.storyIdx--;
    renderStoryFrame();
  } else if (_storyState.groupIdx > 0) {
    _storyState.groupIdx--;
    _storyState.storyIdx = _storyGroups[_storyState.groupIdx].stories.length - 1;
    renderStoryFrame();
  }
}
function storyNextGroup() {
  if (_storyState.groupIdx < _storyGroups.length - 1) {
    _storyState.groupIdx++;
    _storyState.storyIdx = 0;
    renderStoryFrame();
  } else {
    closeStoryViewer();
  }
}
function closeStoryViewer() {
  clearTimeout(_storyState.timer);
  const had = document.getElementById('story-viewer-root');
  had?.remove();
  renderStoriesBar(_storiesBarId);
  if (had) _bzConsumeOverlayGuard();
}

// ─── CART COUNT CACHE ────────────────────────────────────────────
async function refreshCartCount() {
  if (!Session.isRole('BUYER')) return;
  try {
    const res = await api.get('/cart');
    const count = (res?.data?.items || []).reduce((s, i) => s + i.qty, 0);
    sessionStorage.setItem('bz_cart_count', count);
  } catch {}
}
