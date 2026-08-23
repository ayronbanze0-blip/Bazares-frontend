/* ============================================================
   BAZARES — SPA Router (Fase 1: router + estrutura)
   ------------------------------------------------------------
   Vanilla JS, sem bundler, sem framework. Objectivo: navegação
   entre páginas SEM reload completo, mantendo cada página como
   um ficheiro .html real e independente (deep link, SEO via
   Cloudflare Functions, PWA e cache do sw.js continuam a
   funcionar exactamente como hoje).

   COMO FUNCIONA (padrão "pjax" — fetch + swap + pushState):
     1. Ao clicar num <a> interno para outra página SPA, em vez
        de deixar o browser recarregar, faz fetch() do HTML
        dessa página, extrai o conteúdo de dentro de #main e o
        <title>, e troca isso no DOM da página actual.
     2. Regista a nova URL no histórico via pushState — sem
        reload, o botão voltar/avançar do Android continua a
        funcionar de forma nativa e previsível.
     3. Volta a correr os <script> inline da página nova (que o
        innerHTML NÃO executa sozinho) — é assim que initPage()
        da página de destino corre na mesma.

   SEGURANÇA DA MIGRAÇÃO GRADUAL — is­to é o mais importante:
     Uma página só entra neste fluxo se tiver sido explicitamente
     registada com BazaresRouter.register('nome.html'). Se a
     página ACTUAL ou a de DESTINO não estiver registada, o
     click segue o comportamento nativo de sempre (recarregamento
     completo) — ou seja, este ficheiro pode estar presente numa
     página sem mudar nada nela até essa página (e o destino) 
     serem convertidas de propósito. Zero risco de quebrar
     páginas ainda não migradas.

   INTEGRAÇÃO COM O QUE JÁ EXISTE (não duplica nada):
     - go() (app.js) passa a delegar para BazaresRouter.navigate()
       quando este está carregado e ambas as páginas estão
       registadas; senão mantém o comportamento actual (véu +
       location.href) sem qualquer alteração.
     - Bazares.Loading / Bazares.Breadcrumbs (core.js) são
       reutilizados tal como estão — chamados depois de cada
       navegação SPA, não recriados.
     - O popstate do router só actua em entradas de histórico
       próprias (history.state.spa === true). A guarda de
       overlays/modais já existente em app.js (history.state.
       bzOverlay) usa uma forma diferente de state e continua a
       ser tratada pelo SEU próprio listener, sem conflito — os
       dois coexistem porque cada um ignora o state que não é seu.

   Carregar DEPOIS de core.js e ANTES de app.js (mesma ordem de
   sempre) — só nas páginas que forem sendo convertidas (fase 2).

   Ronda 30b: fundido com o ramo de depuração que isolou o fetch()
   de navegação (Accept:text/html, ver fetchHtml) — o RouteGuard da
   Ronda 30 é mantido, o toast de depuração e a remoção temporária
   do guard NÃO entram (eram só para isolar a causa durante o teste).
   ============================================================ */
window.BazaresRouter = (function () {
  'use strict';

  const SPA_PAGES = new Set();     // preenchido por register() — só páginas já convertidas
  const htmlCache = new Map();     // url -> texto HTML já pedido (evita re-fetch ao voltar atrás)
  let navSeq = 0;                  // protege contra respostas fora de ordem (nav rápida A→B→C)

  function register(pages) {
    (Array.isArray(pages) ? pages : [pages]).forEach((p) => SPA_PAGES.add(p));
  }

  function fileOf(pathname) {
    return pathname.split('/').pop() || 'index.html';
  }

  function currentFile() {
    return fileOf(location.pathname);
  }

  function isSpaPage(file) {
    return SPA_PAGES.has(file);
  }

  // Só os <script> inline (sem src) do <body> da página de destino —
  // os partilhados (config/api/core/app.js etc.) já estão carregados e
  // não devem voltar a correr. JSON-LD (SEO) e scripts marcados
  // data-spa-skip também ficam de fora.
  // Selectores dos meta tags de SEO que trocam por página — mantidos
  // num só sítio para o swap do head (abaixo) e a extracção usarem
  // sempre a mesma lista.
  const SEO_TAGS = [
    ['meta[name="description"]', 'content'],
    ['link[rel="canonical"]', 'href'],
    ['meta[name="robots"]', 'content'],
    ['meta[property="og:type"]', 'content'],
    ['meta[property="og:title"]', 'content'],
    ['meta[property="og:description"]', 'content'],
    ['meta[property="og:image"]', 'content'],
    ['meta[property="og:url"]', 'content'],
    ['meta[name="twitter:title"]', 'content'],
    ['meta[name="twitter:description"]', 'content'],
    ['meta[name="twitter:image"]', 'content']
  ];

  function extractParts(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const main = doc.getElementById('main');
    const title = doc.querySelector('title');
    const scripts = Array.from(doc.querySelectorAll('body script:not([src])')).filter(
      (s) => s.getAttribute('type') !== 'application/ld+json' && !s.hasAttribute('data-spa-skip')
    );
    // SEO estático do <head> de destino (definido por página — ver
    // inject_seo). O JSON-LD dinâmico de produto/loja (setProduct/
    // setStore em js/seo.js) NÃO vem daqui — é recriado pelo próprio
    // script da página de destino depois de buscar os dados na API.
    const seo = {};
    SEO_TAGS.forEach(([sel, attr]) => {
      const el = doc.querySelector(sel);
      seo[sel] = el ? el.getAttribute(attr) : null;
    });
    const jsonLdBlocks = Array.from(
      doc.querySelectorAll('head script[type="application/ld+json"]')
    ).map((s) => s.textContent);
    return {
      mainHTML: main ? main.innerHTML : null,
      title: title ? title.textContent : document.title,
      seo,
      jsonLdBlocks,
      scriptCodes: scripts.map((s) => isolate(s.textContent)),
      // Requisitos de acesso da página de destino, declarados no seu
      // próprio <body data-require-auth data-roles data-guest-only> —
      // ver Bazares.RouteGuard (runtime.js). Lidos do HTML ainda por
      // trocar no ecrã, para o guard poder barrar ANTES do swap.
      guard: window.Bazares && Bazares.RouteGuard ? Bazares.RouteGuard.readDeclared(doc) : null
    };
  }

  // Estas páginas foram escritas para correr UMA vez por load completo —
  // é normal terem `let`/`const`/`function` no topo do script (ex:
  // `let _feedPage=1` em home.html). Duas situações rebentariam se
  // corrêssemos o texto tal e qual outra vez:
  //   1. Voltar à MESMA página duas vezes dentro da mesma sessão SPA
  //      (re-injectar as mesmas declarações no mesmo scope global).
  //   2. Voltar a uma página que tinha sido carregada nativamente (não
  //      via router) — as declarações originais já existem a sério no
  //      scope global da página, e uma reinjecção colidiria à mesma.
  // Solução: isolar o código todo dentro de uma IIFE (scope próprio,
  // isolado, uma instância nova de cada vez — nunca colide com nada) e
  // expor ao window só o que é `function`/`async function`/`let`/`const`
  // de topo de nível, porque é a esses nomes que os `onclick="..."`
  // gerados no HTML (ex: `onclick="loadFeed(2)"`) precisam de aceder —
  // esse atributo corre sempre no scope global, nunca dentro da IIFE.
  function isolate(code) {
    const names = new Set();
    const fnRe = /^(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm;
    const varRe = /^(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=/gm;
    let m;
    while ((m = fnRe.exec(code))) names.add(m[1]);
    while ((m = varRe.exec(code))) names.add(m[1]);
    const exposes = Array.from(names)
      .map((n) => 'try{window.' + n + '=' + n + ';}catch(e){}')
      .join('\n');
    return '(function(){\n' + code + '\n' + exposes + '\n})();';
  }

  function runScripts(codes) {
    codes.forEach((code) => {

      const s = document.createElement('script');
      s.textContent = code;
      document.body.appendChild(s);
      s.remove(); // já correu — não precisa de ficar pendurado no DOM
    });
  }

  async function fetchHtml(url) {
    if (htmlCache.has(url)) return htmlCache.get(url);
    // Accept:text/html faz o sw.js tratar isto como navegação (rede primeiro,
    // só cai para cache se estiver offline) — a mesma frescura de sempre que
    // um reload completo teria, em vez da via stale-while-revalidate usada
    // para pedidos genéricos.
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error('spa-router: fetch falhou (' + res.status + ')');
    const text = await res.text();
    htmlCache.set(url, text);
    return text;
  }

  async function navigate(url, opts) {
    opts = opts || {};
    const replace = !!opts.replace;
    const path = url.split('?')[0];
    const targetFile = fileOf(path);

    // Fallback total: página actual ou destino não convertida ainda →
    // comportamento normal, sem qualquer tentativa de SPA.
    if (!isSpaPage(currentFile()) || !isSpaPage(targetFile)) {
      window.location.href = url;
      return;
    }

    const mySeq = ++navSeq;
    if (window.Bazares && Bazares.Loading) Bazares.Loading.start();

    try {
      const html = await fetchHtml(url);
      if (mySeq !== navSeq) return; // o utilizador já navegou de novo entretanto — descarta esta resposta

      const { mainHTML, title, seo, jsonLdBlocks, scriptCodes, guard } = extractParts(html);

      // Guarda de acesso corre ANTES do swap — se falhar, redirecciona
      // sem alguma vez pôr o conteúdo restrito no ecrã (nem por um
      // instante). initPage() da página de destino faria exactamente
      // esta mesma verificação a seguir, mas só depois de já ter sido
      // pintada — aqui evitamos esse intervalo.
      if (guard && window.Bazares && Bazares.RouteGuard) {
        const result = Bazares.RouteGuard.check({ ...guard, url });
        if (!result.ok) {
          const dest = result.redirect + (result.params && Object.keys(result.params).length
            ? '?' + new URLSearchParams(result.params).toString() : '');
          navigate(dest, { replace: true });
          return;
        }
      }

      const main = document.getElementById('main');

      // Página de destino sem #main (ainda não segue a convenção) —
      // cai para navegação normal em vez de mostrar algo a meio.
      if (mainHTML === null || !main) {
        window.location.href = url;
        return;
      }

      main.innerHTML = mainHTML;
      document.title = title;

      // SEO — aplica os meta tags estáticos da página de destino.
      SEO_TAGS.forEach(([sel, attr]) => {
        const val = seo[sel];
        if (val == null) return;
        const el = document.querySelector(sel);
        if (el) el.setAttribute(attr, val);
      });
      // Remove todo o JSON-LD do head (dinâmico de produto/loja da
      // página anterior incluído — nunca deve sobreviver à troca) e
      // troca pelo estático da página de destino, se tiver.
      document.querySelectorAll('head script[type="application/ld+json"]').forEach((s) => s.remove());
      jsonLdBlocks.forEach((code) => {
        const s = document.createElement('script');
        s.type = 'application/ld+json';
        s.textContent = code;
        document.head.appendChild(s);
      });

      if (replace) history.replaceState({ spa: true, url }, '', url);
      else history.pushState({ spa: true, url }, '', url);

      runScripts(scriptCodes);

      if (window.Bazares && Bazares.Breadcrumbs) Bazares.Breadcrumbs.setLast(null);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.dispatchEvent(new CustomEvent('bazares:spanavigate', { detail: { url } }));
    } catch (e) {
      // Uma navegação SPA falhada nunca deve deixar a app num estado a
      // meio — cai para navegação normal (o utilizador só sente uma
      // navegação um pouco mais lenta, nunca uma página partida).
      window.location.href = url;
    } finally {
      if (window.Bazares && Bazares.Loading) Bazares.Loading.stop();
    }
  }

  // Intercepta cliques em links internos. Só entra em acção quando AMBAS
  // as páginas (actual e destino) estão registadas — caso contrário
  // devolve o click ao comportamento nativo do browser.
  document.addEventListener(
    'click',
    function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.indexOf('#') === 0 || a.target === '_blank' || a.hasAttribute('download')) return;

      let url;
      try {
        url = new URL(a.href, location.href);
      } catch (err) {
        return;
      }
      if (url.origin !== location.origin) return;
      if (!/\.html($|\?)/.test(url.pathname)) return;
      if (!isSpaPage(currentFile()) || !isSpaPage(fileOf(url.pathname))) return;

      e.preventDefault();
      navigate(url.pathname + url.search);
    },
    true
  );

  // Só reage a entradas de histórico próprias (state.spa === true). Uma
  // entrada de overlay/modal (state.bzOverlay === true, ver app.js) não
  // bate aqui — o listener de popstate desse sistema é que a trata,
  // sem qualquer conflito entre os dois.
  window.addEventListener('popstate', function (e) {
    if (!e.state || e.state.spa !== true) return;
    navigate(location.pathname + location.search, { replace: true });
  });

  // Pré-carrega o HTML de uma página (fica em htmlCache, pronto para
  // quando a navegação real acontecer) sem correr scripts nem tocar
  // no DOM. Falha em silêncio — é só uma optimização, nunca deve
  // interromper nada se a rede estiver ocupada/offline.
  function prefetch(url) {
    const file = fileOf(url.split('?')[0].split('#')[0]);
    if (!isSpaPage(file) || htmlCache.has(url)) return;
    fetchHtml(url).catch(() => {});
  }

  return { register, navigate, isSpaPage, currentFile, prefetch };
})();
