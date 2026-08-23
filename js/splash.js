/* ============================================================
   BAZARES — Controlo do splash de abertura (v6)
   Mostra a animação só dentro do app instalado (TWA/PWA), nunca
   no site normal do navegador. Busca os números reais de bazares
   e produtos com um limite de tempo curto — se o backend estiver
   "a dormir" (plano free do Render), usa o último valor guardado
   em vez de travar a animação à espera da rede.

   IMPORTANTE — porque é que isto usa document.write():
   Antes, o splash só era inserido no DOMContentLoaded. Mas os
   scripts do body (config.js/api.js/app.js + o initPage inline)
   correm de forma síncrona ANTES do DOMContentLoaded disparar —
   ou seja, a topbar e o conteúdo real já podiam começar a
   desenhar-se um instante antes do overlay do splash aparecer
   (o "flash" da tela real, mais visível quando tudo carrega do
   cache e portanto muito rápido). Ao correr ainda dentro do
   <head>, com document.write(), o splash entra na árvore do
   documento antes de qualquer conteúdo do body ser sequer
   analisado — por isso é sempre a primeira coisa a existir e a
   ser pintada, cache rápida ou não.

   Sequência total: 10s (ritmo mais lento e "cartoon")
     0.00s -> 4.05s  cesta ganha pernas e olhos, corre com linhas de
                      velocidade, tropeça, roda no ar e cai (tremor de
                      ecrã + estrelinhas a rodopiar)
     4.05s -> 4.60s  a cesta transforma-se no ícone da app
     4.60s -> 6.75s  "Bazares" escreve-se + slogan + chips de estatísticas
     7.40s -> 10.0s  spinner + "Loading"
============================================================ */
(function () {
  var ALREADY_SHOWN_KEY = "bazares_splash_shown";
  var STATS_CACHE_KEY = "bazares_splash_stats_cache";
  var TOTAL_DURATION_MS = 10000;
  var STATS_FETCH_TIMEOUT_MS = 4000; // temos mais folga agora (animação de 10s)

  // Deteção de contexto "app instalada". Nota: se isto falhar de forma
  // inconsistente (ex: a barra de endereço aparecer só de vez em quando),
  // a causa mais provável não está aqui — está na verificação dos Digital
  // Asset Links / configuração da TWA no lado Android, que decide se abre
  // como TWA a sério ou cai para um Custom Tab com barra de URL. Este
  // script só controla o que acontece DENTRO da página quando ela já
  // sabe que está num contexto instalado.
  var isTWA = document.referrer.indexOf("android-app://") === 0;
  var isInstalledPWA =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  if (!isTWA && !isInstalledPWA) { window.__bazaresSplashDone = Promise.resolve(); return; }
  if (sessionStorage.getItem(ALREADY_SHOWN_KEY)) { window.__bazaresSplashDone = Promise.resolve(); return; }
  sessionStorage.setItem(ALREADY_SHOWN_KEY, "1");

  // Outras páginas (ex: o redireccionamento para o dashboard quando já
  // há sessão) podem esperar por esta promise antes de navegar, para
  // nunca cortar a animação do splash a meio.
  var _resolveSplashDone;
  window.__bazaresSplashDone = new Promise(function (res) { _resolveSplashDone = res; });

  // Marca já aqui, no <head>, antes de o hero sequer existir — assim o
  // CSS pode mantê-lo escondido enquanto o splash está por cima, em vez
  // de deixá-lo terminar sozinho a sua própria entrada (rápida, ~0.35s)
  // muito antes dos 10s do splash acabarem. Sem isto, ao remover o
  // splash sobra um hero já "seco", parado, à espera — com isto, o
  // hero só entra em cena no preciso instante em que o splash se
  // dissolve, como se um revelasse o outro.
  document.documentElement.classList.add("bz-splash-active");

  function getCachedStats() {
    try {
      var raw = localStorage.getItem(STATS_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setCachedStats(stats) {
    try { localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  // Lê o total exactamente pelo mesmo caminho que o hero usa (api.get
  // devolve { success, message, data: { ..., meta: { total } } }).
  // Mantemos alguns caminhos alternativos como rede de segurança caso
  // o backend mude de formato, mas data.meta.total vem sempre primeiro.
  function extractTotal(json) {
    if (!json) return 0;
    var candidates = [
      json.data && json.data.meta && json.data.meta.total,
      json.data && json.data.meta && json.data.meta.count,
      json.meta && json.meta.total,
      json.meta && json.meta.count,
      json.pagination && json.pagination.total,
      json.total,
      json.count,
      Array.isArray(json.data && json.data.products) ? json.data.products.length : undefined,
      Array.isArray(json.data) ? json.data.length : undefined,
      Array.isArray(json) ? json.length : undefined
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === "number" && !isNaN(candidates[i])) return candidates[i];
    }
    return 0;
  }

  // Busca com timeout — nunca deixa a rede lenta atrasar a animação.
  function fetchStatsWithTimeout(timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (val) { if (!done) { done = true; resolve(val); } };
      var timer = setTimeout(function () { finish(null); }, timeoutMs);
      var base = (window.BAZARES_API_BASE || "") + "/api";

      Promise.all([
        fetch(base + "/bazars?limit=1").then(function (r) { return r.json(); }),
        fetch(base + "/products?limit=1").then(function (r) { return r.json(); })
      ]).then(function (results) {
        clearTimeout(timer);
        var bazares = extractTotal(results[0]);
        var produtos = extractTotal(results[1]);
        var stats = { bazares: bazares || 0, produtos: produtos || 0 };
        // Só grava em cache se pelo menos um número real veio preenchido —
        // assim uma falha de extração/rede não fica presa em "+0" para
        // sempre nas próximas aberturas (a cache antiga, boa, mantém-se).
        if (stats.bazares || stats.produtos) setCachedStats(stats);
        finish(stats);
      }).catch(function (err) {
        clearTimeout(timer);
        if (window.console) console.warn("[splash] falha ao buscar estatísticas:", err);
        finish(null);
      });
    });
  }

  // Conta a subir de 0 até ao valor real, em vez de aparecer estático —
  // pequeno detalhe que dá mais vida ao momento em que os números chegam.
  function animateCount(el, target, durationMs) {
    if (!el) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = "+" + target;
      return;
    }
    var start = null;
    var easeOutExpo = function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); };
    function tick(ts) {
      if (start === null) start = ts;
      var progress = Math.min((ts - start) / durationMs, 1);
      var value = Math.round(target * easeOutExpo(progress));
      el.textContent = "+" + value;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function applyStats(el, stats) {
    var statsRow = el.querySelector(".bz-stats");
    var bEl = el.querySelector('[data-chip="bazares"] b');
    var pEl = el.querySelector('[data-chip="produtos"] b');
    animateCount(bEl, stats.bazares, 900);
    animateCount(pEl, stats.produtos, 900);
    if (statsRow) statsRow.classList.remove("bz-stats--empty");
  }

  // Estilo crítico embutido: cobre o ecrã de imediato mesmo que
  // css/splash.css ainda não tenha terminado de carregar — sem isto,
  // numa rede lenta, podia haver uma fração de segundo de fundo em
  // branco antes das regras externas chegarem.
  var CRITICAL_CSS =
    '<style>#bz-splash{position:fixed;inset:0;z-index:999999;' +
    'background:linear-gradient(160deg,#00B837 0%,#00E043 55%,#1FFF62 100%);' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}</style>';

  var SPLASH_HTML =
    CRITICAL_CSS +
    '<div id="bz-splash">' +
      '<div class="bz-splash-stage">' +
        '<div class="bz-basket-shadow"></div>' +
        '<div class="bz-stars"><span>✦</span><span>✦</span><span>✦</span></div>' +
        '<div class="bz-impact"></div>' +
        '<div class="bz-impact bz-impact--2"></div>' +
        '<div class="bz-icon-glow"></div>' +
        '<div class="bz-icon"><img class="bz-icon-img" src="/icons/icon-192.png" alt="Bazares"></div>' +
        '<div class="bz-basket-rig">' +
          '<span class="bz-speedline"></span><span class="bz-speedline"></span><span class="bz-speedline"></span>' +
          '<span class="bz-dust"></span><span class="bz-dust"></span><span class="bz-dust"></span>' +
          '<div class="bz-eyes">' +
            '<div class="bz-eye"><div class="bz-pupil"></div></div>' +
            '<div class="bz-eye"><div class="bz-pupil"></div></div>' +
          '</div>' +
          '<div class="bz-basket">' +
            '<div class="bz-basket-handle"></div>' +
            '<div class="bz-basket-body"></div>' +
          '</div>' +
          '<div class="bz-leg bz-leg--l"></div>' +
          '<div class="bz-leg bz-leg--r"></div>' +
        '</div>' +
      '</div>' +
      '<div class="bz-wordmark">' +
        ["B","a","z","a","r","e","s"].map(function (ch, i) {
          var cls = i >= 3 ? " bz-gold" : ""; // "ares" em dourado, como no topo do site
          return '<span class="' + cls.trim() + '">' + ch + '</span>';
        }).join("") +
      '</div>' +
      '<div class="bz-slogan">A tua loja, o teu mercado, a tua oportunidade.</div>' +
      '<div class="bz-stats bz-stats--empty">' +
        '<div class="bz-stat-chip" data-chip="bazares"><b>+0</b><span>Bazares</span></div>' +
        '<div class="bz-stat-chip" data-chip="produtos"><b>+0</b><span>Produtos</span></div>' +
      '</div>' +
      '<div class="bz-loading">' +
        '<div class="bz-spinner"></div>' +
        '<span class="bz-loading-label">Loading</span>' +
      '</div>' +
    '</div>';

  function mount(el) {
    if (!el) return;
    var cached = getCachedStats();
    if (cached) applyStats(el, cached);

    fetchStatsWithTimeout(STATS_FETCH_TIMEOUT_MS).then(function (fresh) {
      if (fresh) applyStats(el, fresh);
    });

    setTimeout(function () {
      el.classList.add("bz-splash--hide");
      el.addEventListener("animationend", function () { el.remove(); }, { once: true });

      // 1) A topbar aparece já, assim que o splash começa a dissolver-se.
      // 2) Durante 3.5s fica visível um spinner "Loading" no lugar do hero.
      // 3) Só depois o resto do hero entra — nada de fundos a "brilhar",
      //    só o conteúdo a subir suavemente.
      document.documentElement.classList.remove("bz-splash-active");
      document.documentElement.classList.add("bz-splash-revealing");
      if (_resolveSplashDone) _resolveSplashDone();
      setTimeout(function () {
        document.documentElement.classList.remove("bz-splash-revealing");
        var heroEl = document.querySelector(".hero");
        if (heroEl) heroEl.classList.add("bz-reveal");
      }, 3500);
    }, TOTAL_DURATION_MS);
  }

  // Caminho principal: o script ainda está a correr dentro do <head>,
  // antes de o <body> sequer existir — document.write() insere o splash
  // no ponto exacto em que o parser está, tornando-o a primeíssima coisa
  // do body, garantidamente antes de qualquer script do resto da página
  // ter oportunidade de desenhar conteúdo real.
  if (document.body === null && document.readyState === "loading") {
    document.write(SPLASH_HTML);
    mount(document.getElementById("bz-splash"));
  } else {
    // Caminho defensivo: só usado se este ficheiro alguma vez passar a
    // ser carregado de outra forma (ex: injectado dinamicamente depois
    // do body já existir). NUNCA usar document.write() aqui — chamá-lo
    // depois da página estar carregada apagaria o documento inteiro.
    var attach = function () {
      var wrapper = document.createElement("div");
      wrapper.innerHTML = SPLASH_HTML;
      var styleTag = wrapper.querySelector("style");
      var splashEl = wrapper.querySelector("#bz-splash");
      if (styleTag) document.head.appendChild(styleTag);
      if (splashEl) {
        document.body.prepend(splashEl);
        mount(splashEl);
      }
    };
    if (document.body) attach();
    else document.addEventListener("DOMContentLoaded", attach);
  }
})();
