// Bazares — Service Worker (v15)
// v9: subiu a versão do cache outra vez — mesmo problema documentado
// abaixo (v4 a v8): o js/app.js mudou de conteúdo (produto associado
// a Post/História passou a mostrar um cartão "Comprar" no feed) mas
// o "?v=" nas páginas continuou o mesmo, por isso quem já tinha a app
// em cache continuava preso na versão antiga sem o cartão. Também
// actualizei o "?v=" do js/app.js em todas as páginas E no APP_SHELL
// abaixo (que estava sem "?v=" nenhum — nunca batia com o URL real
// pedido pelas páginas, por isso essa entrada pré-cacheada nunca
// chegava a ser usada). Isto limpa a cache antiga em todos os
// dispositivos.
// v8: subiu a versão do cache — nova folha "Quem reagiu" (separadores
// por tipo de reação + lista de pessoas) no app.js/style.css.
// v7: subiu a versão do cache — app.js e style.css mudaram (reações
// com emoji nativo + animações, e vista de post em ecrã inteiro ao
// tocar numa foto do feed). Mesmo motivo do v6: sem isto, quem já
// tinha o site em cache ficava preso na versão anterior.
// v6: subiu a versão do cache — o js/app.js mudou de conteúdo (edição
// de posts/reels a abrir já com o conteúdo preenchido) mas o "?v=" nas
// páginas tinha ficado por actualizar — exactamente o mesmo problema
// do v5: quem já tinha o site em cache continuava a receber o app.js
// antigo (stale-while-revalidate só troca de versão quando a URL
// muda). Isto limpa essa cache antiga em todos os dispositivos.
// v5: subiu a versão do cache outra vez — install-prompt.js e
// push-notifications.js foram corrigidos (deixaram de guardar a
// recusa em localStorage), mas o "?v=" nas páginas ficou por
// actualizar, por isso quem já tinha o site em cache continuava a
// receber o ficheiro antigo (com o "nunca mais aparece" de volta).
// Isto limpa essa cache antiga em todos os dispositivos.
// v4: subiu a versão do cache de novo — o js/splash.js estava a ser
// pré-cacheado sem "?v=" (ao contrário de todos os outros scripts),
// por isso quem já tinha visitado o site ficava preso numa cópia
// antiga do splash para sempre (stale-while-revalidate nunca troca de
// URL). Isto limpa essa cache antiga em todos os dispositivos.
// v3: subiu a versão do cache de propósito — limpa qualquer cache antigo
// e inconsistente de deploys anteriores em todos os dispositivos já
// instalados (isto é o que resolve apps já instaladas que ficaram presas
// num estado misto/corrompido de uma versão antiga do site — sintoma
// típico: "funciona no navegador, mas a app instalada fecha sozinha").
// Antes: só ficava em cache o que o utilizador já tinha visitado, e cada
// pedido esperava sempre pela rede primeiro (mesmo com o backend gratuito
// do Render "a dormir"). Agora:
//   1. Pré-carrega a app inteira (todas as páginas, CSS, JS, ícones) logo
//      na instalação — mais coisas ficam acessíveis em cache desde a
//      primeira abertura, não só depois de se visitar cada página.
//   2. Páginas (HTML) continuam "network-first": tenta sempre a rede
//      primeiro, para nunca mostrar uma versão desatualizada do site,
//      e só cai para o cache se a rede falhar.
//   3. Ficheiros estáticos (CSS/JS/ícones/imagens) passam a
//      "stale-while-revalidate": respondem do cache na hora (app abre
//      instantaneamente) e actualizam-se em segundo plano — como já têm
//      "?v=" no nome para invalidar cache quando mudam, isto é seguro.
//   4. Pedidos à API (domínio do backend) não passam por aqui — nunca
//      servimos dados desatualizados por engano.

// v27: subiu a versão do cache — js/app.js mudou (go() agora delega no
// BazaresRouter quando presente, Ronda 29) e o novo js/spa-router.js foi
// pré-cacheado (ainda não referenciado em nenhuma página — entra em uso
// só quando as páginas forem convertidas, fase 2). Regra da v9/v24: todo
// JS partilhado editado ou adicionado tem de subir aqui, ou quem já tem
// a app instalada fica preso na versão antiga.
// v28: spa-router.js mudou de conteúdo (isolamento em IIFE + exposição ao
// window, corrige redeclaração de let/const ao repetir/voltar a uma
// página) e passou a ser mesmo referenciado — home.html e
// notifications.html foram convertidas ao SPA Router (Ronda 30, 1º par).
// v34: dois ficheiros JS partilhados novos (js/seo.js — SEO dinâmico
// de produto/loja; js/action-queue.js — fila de acções offline) têm
// de entrar na app shell, ou quem já tem a app instalada nunca os
// chega a pré-cachear.
// v38 (Ronda 31): js/app.js, js/seo.js e product.html mudaram (rota de
// produto passou de /produto/:slug para /product/:slug) sem subir a
// versão — quem já tinha o site em cache continuou preso na lógica
// antiga (mesmo bug da v9/v18/v27, mesma causa: esquecimento). Corrigido
// aqui + subida a mesma "?v=" partilhada nas 55 páginas (estava
// 1787482456 nas páginas, dessincronizada da lista abaixo há várias
// rondas — alinhadas as duas agora, para nunca mais haver este desfasamento
// silencioso). Aproveitado para tirar o sufixo "-debug" do nome da cache,
// que já não correspondia a nada (o debug que o justificava foi removido).
// v42: subiu a versão do cache — nenhum JS partilhado mudou desta vez,
// mas várias apps instaladas ficaram presas num estado misto depois dos
// últimos deploys (ecrã "Algo correu mal a carregar a app" a aparecer em
// interações normais, ex: "Ver mais" numa legenda). Sobe-se na mesma para
// forçar todos os dispositivos já instalados a largar a cache antiga e
// buscar tudo de novo, por segurança — mesmo raciocínio da v3.
const CACHE_NAME = "bazares-v42";

const APP_SHELL = [
  "/", "/index.html", "/home.html", "/notifications.html", "/dashboard.html", "/products.html", "/product.html",
  "/bazars.html", "/bazar.html", "/cart.html", "/checkout.html", "/chat.html",
  "/profile.html", "/settings.html", "/login.html", "/register.html",
  "/forgot-password.html", "/verify-email.html", "/wallet.html",
  "/wallet-history.html", "/finance.html", "/favorites.html", "/my-orders.html",
  "/my-products.html", "/my-bazar.html", "/referrals.html", "/ranking.html",
  "/support.html", "/admin.html", "/admin-users.html", "/admin-orders.html",
  "/admin-products.html", "/admin-finance.html", "/admin-wallet.html",
  "/admin-reports.html", "/admin-logs.html", "/admin-broadcast.html",
  "/admin-denuncias.html",
  "/css/style.css?v=1788700000", "/css/splash.css?v=1788700000",
  "/js/config.js?v=1788700000", "/js/seo.js?v=1788700000", "/js/action-queue.js?v=1788700000", "/js/api.js?v=1788700000", "/js/core.js?v=1788700000", "/js/runtime.js?v=1788700000", "/js/offline-store.js?v=1788700000", "/js/virtual-feed.js?v=1788700000", "/js/spa-router.js?v=1788700000", "/js/app.js?v=1788700000", "/js/splash.js?v=1788700000",
  "/js/install-prompt.js?v=1788700000", "/js/push-notifications.js?v=1788700000",
  "/manifest.json",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-512-maskable.png",
  "/img/hero-market.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // allSettled em vez de addAll: se um ficheiro falhar (ex: ainda não
      // existe nesse deploy), os restantes continuam a ficar em cache em
      // vez de a instalação inteira falhar por causa de um só ficheiro.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // deixa a API intocada

  const isNavigation =
    req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Background Sync — só existe no Chrome/Edge/Android (não no iOS
// Safari, que já está coberto pelo fallback 'online'/visibilitychange
// dentro de js/action-queue.js). O Service Worker não tem o token de
// acesso da sessão (vive só em memória na página, nunca chega aqui),
// por isso não repete o pedido sozinho — só avisa as páginas abertas
// para tentarem esvaziar a fila com a sua própria sessão autenticada.
self.addEventListener("sync", (event) => {
  if (event.tag !== "bz-flush-actions") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      clients.forEach((c) => c.postMessage({ type: "bz-flush-actions" }));
    })
  );
});
