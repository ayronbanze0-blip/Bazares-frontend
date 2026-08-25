# Bazares Frontend — Plano de Consistência (rumo aos 100%)

> **Regra de ouro deste ficheiro:** antes de pedir ou implementar qualquer coisa desta lista, procurar primeiro no código (`grep -rn "palavra-chave" js/*.html js/*.js`). Já aconteceu (Ronda 28) quase reconstruirmos 3 coisas que já existiam — scroll restoration, barra de progresso e breadcrumbs — só porque não tínhamos isto escrito nem tínhamos procurado a fundo em `core.js`/`app.js` primeiro. **Nunca mais implementar sem confirmar primeiro que não existe.**

Legenda: ✅ Feito e confirmado no código · ⚠️ Parcial/ad-hoc (funciona mas não formalizado) · ❌ Falta mesmo · 🚫 Não aplicável (decisão de arquitectura, não esquecimento)

**Estado geral em 21 Ago 2026: ~65-70%** (corrigido — a primeira estimativa desta conversa, ~50%, estava errada por falta de leitura de `core.js`; ver Ronda 28 no log)

---

## Navegação e estrutura — ~95% do essencial MPA feito; SPA migrada para todas as páginas (confirmado nesta ronda)
- ✅ SPA — **corrigido nesta ronda**: as 55 páginas HTML já chamam `BazaresRouter.register([...])` com a lista completa — já não está inerte, a migração gradual terminou
- ✅ Client-side routing — router pjax (fetch + swap de `#main` + pushState/popstate) activo em todas as páginas registadas; `home.html`/`notifications.html` já usam `BazaresRouter.prefetch()` em idle
- ✅ Dynamic routes — Cloudflare Functions (`functions/produto/[slug].js`, `bazar/[slug].js`, `categoria/[cat].js`)
- 🚫 Nested routes — conceito de SPA, não se aplica a MPA
- ✅ Route guards — `Session.isLoggedIn()` + `go('login.html')` em páginas protegidas
- ✅ Redirects — idem, mais `_redirects` (sitemap/robots proxy)
- ✅ Browser History — nativo (MPA) + guarda customizada de overlays via `pushState`/`popstate`
- ✅ Back/Forward navigation — `goBack()` com `GOBACK_FALLBACK` para entrada directa sem histórico
- ✅ Deep linking — `?reel=ID&bazar=ID` (reels.html), slugs nas Functions de SEO
- ✅ Query parameters — **corrigido nesta ronda**: helper `getParam()` (`URLSearchParams`) usado em 15 páginas (anuncio, bazar, chat, checkout, historia, home, login, my-products, newreels, order-detail, product, products, search, verify-email, wallet), não 6
- 🚫 Hash routing — não é necessário sem SPA
- ✅ 404 personalizada — `404.html`
- ✅ Loading states — `Bazares.Loading` (contador refcounted) + barra no topo (`core.js`)
- ✅ Navigation transitions — véu de fade em `go()` (`_ptVeil()`)
- ✅ Scroll restoration — `restoreScrollY()`, `saveListState`/`getListState`, `history.scrollRestoration='manual'`
- ✅ Modal routing — `_bzOpenOverlay()`/`_bzConsumeOverlayGuard()`, voltar fecha só o overlay antes de sair da página
- ✅ Breadcrumbs — `Bazares.Breadcrumbs` (árvore completa por página, zero-touch, `setLast()` para nome real)
- 🚫 Route-based code splitting — avaliado e recusado na Ronda 27 (risco > ganho no workflow mobile-only sem forma de testar antes de publicar)

## 🔐 Autenticação e sessão — ~80%
- ✅ Login persistente / Refresh token / Access token / Session restoration
- ✅ Protected pages (redirect para login)
- ⚠️ Guest-only pages — não confirmado item a item
- ⚠️ Auto refresh da sessão / Expiração de sessão — existe refresh token, fluxo exacto de expiração não auditado a fundo
- ❌ Remember me
- ✅ Session state global — objecto `Session` central
- ✅ Multi-tab synchronization — `BroadcastChannel('bazares_auth')` com fallback no evento `storage`
- ✅ Logout em todas as abas — mesmo mecanismo acima

## 🧠 Estado e comportamento — ~55%
- ⚠️ Global state — não há store único, mas `Session` + `Bazares.*` cobrem a maior parte
- ✅ Local state / Persistent state — sessionStorage/localStorage usados consistentemente
- ❌ Reactive state — sem sistema reactivo (esperado em vanilla JS sem framework)
- ⚠️ Event bus — só `CustomEvent('bazares:loading')`, não é um bus genérico
- ❌ Context/state manager próprio (formal)
- ⚠️ Optimistic UI — via `Bazares.Undo` (padrão "apaga já, desfaz depois")
- ✅ Undo/Redo — `Bazares.Undo.perform()` (estilo Gmail)
- ⚠️ State hydration — parcial (list state / offline store)
- ✅ State persistence — sessionStorage (scroll/listas) + localStorage (rascunhos)
- ✅ State synchronization — multi-tab via BroadcastChannel

## 🌐 Comunicação com backend — ~65%
- ✅ fetch() / REST API client (`js/api.js`)
- 🚫 GraphQL client — API é REST, não aplicável
- ✅ WebSocket / Socket.IO — chat.html
- ❌ Server-Sent Events
- ⚠️ Request cancellation — `AbortController` usado 2x, não em todo o lado
- ✅ Retry automático — `fetchWithRetry`
- ✅ Request timeout
- ❌ Request queue (fila formal)
- ✅ Request deduplication — `Bazares.RequestCache.dedupedGet`
- ✅ Pagination / Cursor pagination
- ✅ Infinite scroll
- ⚠️ Upload de arquivos — existe, progress visual não confirmado
- ❌ Upload progress (barra %)
- ❌ Download progress

## ⚡ Performance — ~55%
- ✅ Lazy loading / Image lazy loading — `loading="lazy"`, `cldImg()` com `dpr_auto`+`f_auto`
- ❌ Dynamic imports
- 🚫 Code splitting — recusado deliberadamente (Ronda 27)
- ❌ Prefetching (de página/dados)
- ✅ Preloading / Resource hints — `preconnect`/`dns-prefetch` presentes nas 55 páginas
- ✅ IntersectionObserver — 7 ficheiros
- ✅ Virtual scrolling — `js/virtual-feed.js` (windowing de DOM)
- ✅ Debouncing / Throttling — `Bazares.Utils.debounce/throttle` (única implementação central)
- ❌ Memoização
- ✅ Cache de requests — `Bazares.RequestCache` (TTL)
- ✅ Cache local — Cache API via `sw.js`
- ❌ Background synchronization
- ✅ Web Workers — `image-compress-worker.js`

## 💾 Armazenamento — ~75%
- ✅ LocalStorage / SessionStorage / Cookies (refresh token via cookie httpOnly, `credentials:'include'`)
- ✅ IndexedDB — `offline-store.js`
- ✅ Cache API / Service Worker storage / Persistent cache
- ⚠️ Offline data — só leitura (última resposta boa por endpoint), sem escrita offline
- ❌ Background sync (fila de escrita offline) — documentado como fase futura no próprio `offline-store.js`

## 📱 PWA — ~80%
- ✅ Installable PWA / App manifest / Service Worker / App shell / Splash screen / Install prompt
- ⚠️ Offline mode / Offline pages — leitura cacheada sim, página offline dedicada não confirmada
- ✅ Push notifications — Firebase FCM completo
- ❌ Background sync
- ✅ Cache strategies — stale-while-revalidate documentado e versionado
- ⚠️ Update automático da aplicação — limpa cache antiga por versão, não é 100% silencioso/automático
- ✅ Network status detection — `Bazares.Connectivity` (verificação real via `/health`, não só `navigator.onLine`)

## 🛡️ Segurança no frontend — ~55%
- ✅ XSS protection / Sanitização de HTML / Output escaping — `esc()` usado consistentemente
- ❌ CSRF handling (token explícito) — mitigado via cookie mas sem token CSRF dedicado
- ✅ Content Security Policy — `_headers` (Ronda 27)
- ⚠️ Input validation — existe em formulários pontuais, não auditado sistematicamente
- ✅ Secure cookies — geridas pelo backend
- ✅ Token handling — refresh/access token
- ⚠️ Permission-based UI / Role-based UI — ad hoc (páginas admin), não centralizado
- ✅ Rate-limit handling — 429 tratado com `retryAfter`
- ✅ Error-safe responses — `Bazares.Error` evita mostrar erros crus

## 🔎 SEO — ~85%
- ✅ Meta title/description, Open Graph, Twitter Card, Structured Data/JSON-LD, Sitemap, Robots.txt, Dynamic SEO metadata, Product SEO, Social sharing previews — tudo via Cloudflare Functions
- ✅ Canonical URLs / Semantic HTML — assumido correcto, não relido linha a linha nesta ronda

## 🖼️ Imagens e mídia — ~70%
- ✅ Lazy image loading / Responsive images (via Cloudinary `f_auto`/`q_auto` = WebP/AVIF automático)
- 🚫 `<picture>` explícito — desnecessário, Cloudinary já negocia formato
- ✅ Image compression no navegador / Crop / Resize — `image-editor.js`
- ✅ Preview antes do upload
- ⚠️ Upload múltiplo — existe em produtos (até 6 imagens), não confirmado em todo o lado
- ❌ Upload progress
- ✅ Video lazy loading / Video preview — `video-editor.js`, `preload` corrigido na R19
- ⚠️ Adaptive media loading — parcial via Cloudinary, não testado por rede lenta

## 🎨 UI/UX — ~50%
- ✅ Toast notifications / Skeleton loading (parcial, 3 páginas)
- ✅ Dialogs — `modal-root` presente nas 55 páginas
- ❌ Drawers / Bottom sheets — não encontrados
- ⚠️ Dropdowns / Tooltips — só em maps.js, não é um componente genérico
- ❌ Tabs (componente genérico)
- ⚠️ Carousels — existe carrossel de imagens de produto, não é reutilizável
- ✅ Infinite feeds
- ⚠️ Pull-to-refresh — 2 ficheiros, não confirmado global
- ⚠️ Swipe gestures / Drag & drop / Touch gestures — presentes mas pontuais
- ❌ Keyboard navigation / Focus management — quase inexistente (0 `tabindex` encontrados)
- ✅ Responsive layouts
- ✅ Dark mode / Theme system — `data-theme`, toggle com persistência (confirmado nesta ronda, corrigindo estimativa anterior de 0%)
- ⚠️ Animations / Page transitions — véu de fade existe, não é um sistema geral
- ❌ View Transitions API

## 🧩 Arquitetura — ~55%
- ⚠️ Component system próprio — template strings, não componentes reais
- ⚠️ Reusable components — **corrigido nesta ronda**: `product-picker.js` NÃO existe em `js/`; o que há é CSS `.nr-product-picker` repetido inline em pelo menos 3 páginas (anuncio.html, historia.html, newreels.html) — a extracção não aconteceu ou regrediu
- ⚠️ Design system — tokens CSS (`:root`), não documentado formalmente
- ✅ Utility functions — `Bazares.Utils` (debounce/throttle)
- ✅ Service layer — `js/api.js`
- ❌ Repository pattern / Dependency injection — não fazem muito sentido em vanilla JS sem DI container
- ✅ Event-driven architecture — `CustomEvent('bazares:loading')`
- ⚠️ Feature-based architecture — organização é por página, não por feature
- ✅ Error boundary equivalente / Centralized error handling — `Bazares.Error`
- ✅ Global notification system — toasts + `Bazares.Undo`
- ✅ Global navigation manager — **corrigido nesta ronda**: `Bazares.Nav` (`js/runtime.js`) já é um objecto único que envolve `go()`/`goBack()`/`BazaresRouter.navigate()`, mantém a rota actual e dispara `'bazares:nav:change'` a cada navegação (recarga completa ou SPA)

## 🧠 "Cérebro responsivo" (lista de Managers) — ~70% (estimativa anterior desta conversa: 10% — estava errada)
- ✅ Navigation Manager — **corrigido nesta ronda**: `Bazares.Nav` (`js/runtime.js`) já é um objecto único, não apenas `go()`/`goBack()` soltos
- ✅ Session Manager — `Session`
- ✅ Route Guard — **corrigido nesta ronda**: `Bazares.RouteGuard.check()` (`js/runtime.js`), centralizado (não ad hoc), usado por `initPage()` e pelo `BazaresRouter` antes de trocar `#main`
- ⚠️ Global App State — parcial (`Session` + módulos `Bazares.*`, sem store único)
- ✅ Error Manager — `Bazares.Error`
- ✅ Recovery Manager — `Bazares.Recovery` (retry de acções falhadas por rede)
- ✅ Modal Manager — guarda de overlays + `closeTopmostOverlay()`
- ✅ History Manager — `goBack()`, `popstate`, guarda de overlays
- ✅ Request Manager — `api.js` (retry/timeout/abort) + `RequestCache`
- ✅ Cache Manager — `sw.js` + `RequestCache`
- ✅ Notification Manager — toasts + push FCM
- ⚠️ Permission Manager — ad hoc, não centralizado
- ✅ Connectivity Manager — `Bazares.Connectivity` (verificação real via `/health`)
- ✅ Loading Manager — `Bazares.Loading` + barra
- ❌ Action Result Manager — não identificado como conceito próprio
- ❌ Context Manager — não identificado
- ✅ State Persistence — sessionStorage/localStorage consistente
- ⚠️ Automatic Route Recovery — `GOBACK_FALLBACK` cobre o caso de entrada directa
- ✅ Automatic Error Recovery — `Bazares.Recovery`
- ⚠️ Action → Destination mapping — só existe para o caso de voltar (`GOBACK_FALLBACK`), não é genérico

---

## Log de rondas (o que foi feito, para nunca reabrir o que já está fechado)

**Ronda 32 (25 Ago 2026)** — Fusão de duas branches paralelas do frontend que tinham divergido do mesmo ponto: `Bazares-frontend-monitoring.zip` (Sentry com tracing/Web Vitals, `js/analytics.js` novo — eventos `product_viewed`/`product_published`/`checkout_started`/`order_created`/`search_performed`/`api_error`/`api_slow`/`client_error` — e `admin-monitoring.html`) e `bazares-updated-1.zip` (memória de listagem fechada em `bazars`/`home`/`search`/`meufeed`/`favorites`/`category`, navegação com véu em `login.html`, `Bazares.Utils.debounce()` a substituir timers manuais em vários formulários). Nenhuma das duas tinha o trabalho da outra. Fundidas sem perdas: `config.js`/`core.js`/`api.js` do lado da monitorização eram sobreconjunto estrito do outro lado (copiados directamente); as 55 páginas ganharam a tag do `analytics.js` + `admin-monitoring.html` no registo do router; as chamadas de tracking em falta foram portadas manualmente para `checkout.html`/`product.html`/`novoproduto.html`/`my-products.html`; `products.html` (que só tinha a memória de listagem no lado da monitorização) ganhou-a também no lado actualizado, mantendo o `debounce()` mais recente. Botão "Monitorização" adicionado a `admin.html`. Validado: sintaxe de todos os `.js` partilhados + todos os `<script>` inline das 55 páginas (Node `new Function`), chavetas CSS balanceadas, sem novas colisões de aspas introduzidas. `sw.js` v47→v48 (changelog da monitorização, v45-v47, preservado).

**Ronda 31c (23 Ago 2026)** — Utilizador reportou o bug a persistir mesmo depois da Ronda 31b (`?v=`/cache já corrigidos): ao clicar num produto, o URL final era `bazares.pages.dev/product` sem slug nenhum a seguir. Ainda a aguardar confirmação do utilizador sobre o URL exacto (há ou não `?id=...` a seguir a `/product`?) e de que ecrã veio o clique, para confirmar a causa exacta — mas encontrada e corrigida já uma causa real ao rever `PRETTY_ROUTES`: o teste `params.id ? ... : null` tratava o id `0` (numérico) como "sem id" por ser falsy em JavaScript, caindo para o URL feio antigo (`product.html?id=0`) que o Cloudflare depois encurta para `/product?id=0` — se algum produto tiver o identificador `0` (ex.: o primeiro criado na base de dados, dependendo de como o backend numera), batia exactamente neste caso. Trocado por `params.id != null && params.id !== ''` em `bazar.html` e `product.html` (mesma função serve as duas rotas). Efeito colateral útil: se o produto genuinamente não tiver `slug`/`id` (dado em falta), o URL agora mostra `/product/undefined` em vez de desaparecer silenciosamente para `/product` em branco — mais fácil de apanhar visualmente daqui para a frente. `?v=` subida (outra vez, por mudar `app.js`) para `1788617999`, `CACHE_NAME` para `bazares-v39`.

**Ronda 31b (23 Ago 2026)** — Bug reportado: depois da Ronda 31 (rota `/produto/`→`/product/`), o site voltou a comportar-se como antes (id do produto não encontrado). Causa: a Ronda 31 mudou `js/app.js`, `js/seo.js` e `product.html` mas não subiu a `?v=` partilhada nem a versão da cache do `sw.js` — quem já tinha o site aberto/instalado continuou a receber o `app.js`/`seo.js` antigos do cache (`stale-while-revalidate`, ver `sw.js`), com a lógica `/produto/` de antes. Mesmo erro já documentado várias vezes no histórico deste ficheiro (v9/v18/v27) — mas desta vez agravado por um desfasamento pré-existente: a `?v=` usada nas 55 páginas (`1787482456`) já não batia certo com as versões individuais na `APP_SHELL` do `sw.js` (ex.: `app.js?v=1787800000`) há várias rondas, por isso a lista de pré-cache nem sequer correspondia aos ficheiros realmente pedidos. Corrigido: `?v=` partilhada subida para `1788531600` nas 55 páginas, `APP_SHELL` alinhada com a mesma versão em todos os ficheiros JS/CSS, `CACHE_NAME` subido para `bazares-v38` (e tirado o sufixo `-debug` que já não correspondia a nada). **Lição para não repetir**: qualquer mudança a `js/app.js`, `js/seo.js`, ou a outro JS/CSS partilhado tem SEMPRE de vir acompanhada de (1) subir a `?v=` partilhada nas páginas afectadas e (2) subir `CACHE_NAME` em `sw.js` — nunca só o conteúdo do ficheiro.

**Ronda 31 (23 Ago 2026)** — Mudada a URL amigável de produto de `/produto/:slug` para `/product/:slug` (pedido explícito: estilo dos grandes marketplaces). Tocado em todos os sítios que geravam ou liam essa rota: `PRETTY_ROUTES`/`shareTargetUrl` (`app.js`), `setProduct` (`seo.js`), JSON-LD de categoria (`functions/categoria/[cat].js`), e a própria Function movida de `functions/produto/[slug].js` para `functions/product/[slug].js` (canonical actualizado). `product.html` agora lê `getPathSlug('product')` primeiro, com `getPathSlug('produto')` como fallback (quem tiver a página antiga aberta, ou um link `/produto/...` que não passe pela Function, continua a funcionar). `_redirects`: nova regra `/product/*` (rede de segurança, mesmo papel que a antiga) + regra 301 `/produto/*` → `/product/:splat` para não partir links já partilhados/indexados antes da mudança. Também aproveitado da Ronda 30d/31: o ecrã de link de produto sem id (antes um painel de debug técnico) já tinha sido trocado por um redireccionamento silencioso (`location.replace('products.html')`) numa entrega anterior a esta.

**Ronda 30d (22 Ago 2026)** — Pedido de "deep search" a bugs. Encontrado o mesmo padrão do bug da Ronda 30c (upload sem compressão de imagem) repetido em mais 6 pontos: `chat.html` (imagem de mensagem — **sem limite de tamanho nenhum**, o mais grave dos seis), `historia.html` (fotos de história, incl. publicação sequencial de vários slides — melhorado também o tratamento de erro a meio da sequência, para o utilizador saber quantos slides já ficaram publicados antes de um falhar, em vez de "falhou" genérico e ambíguo), `newreels.html` (capa de Reel), `profile.html` (avatar), `my-bazar.html` (logo + banner da loja). Todos ganharam `media-compress.js` + `compressImage` antes do `fd.append`, mesma receita da Ronda 30c. CSP (`_headers`): adicionado `assets.openfreemap.com` a `img-src`/`connect-src` como precaução — é onde o OpenFreeMap aloja glyphs/sprites do estilo de mapa "liberty" usado em `js/maps.js`, fora do `tiles.openfreemap.org` já autorizado; não confirmado com certeza que estava mesmo a falhar (sem acesso à consola do browser em produção para verificar), mas o custo de autorizar é zero e o padrão é o mesmo do bug de push já confirmado. Sem outros bugs de sintaxe/chavetas encontrados na auditoria completa das 55 páginas + `app.js`/`style.css`.

**Ronda 30c (22 Ago 2026)** — Bug reportado por screenshot: post de loja (`anuncio.html`, o ecrã "O que se passa na tua loja hoje?") com 2-3 fotos falhava com "Não foi possível concluir o envio" (mensagem de `api.js`, disparada quando `fetchWithRetry` esgota as tentativas por timeout). Causa: `anuncio.html` era o único ecrã de upload de fotos que não incluía `js/media-compress.js` nem chamava `compressImage` — enviava o `File` da câmara em bruto (até 10MB cada, ver `addAnnFiles`) directo para o `FormData`, ao contrário de `novoproduto.html`. Com 2-3 fotos numa rede móvel mais lenta, o tamanho batia no timeout de upload antes do servidor responder. Corrigido: adicionado `media-compress.js` ao `anuncio.html` e `compressAnnImage()` (mesmo helper/parametrização do `novoproduto.html` — 1600px/0.82) chamado antes de cada `fd.append('images', …)`, nos dois caminhos (publicar novo e editar existente), com o mesmo toast "A preparar N imagens…" já usado no `novoproduto.html`.

**Ronda 30b (22 Ago 2026)** — Três correcções independentes na mesma entrega. (1) **Fusão de ramos divergentes do SPA Router**: `bazares-frontend-round30b-spa-debug-fix.zip` era um ramo de depuração que isolara a causa de um bug ao remover temporariamente o `RouteGuard` (Ronda 30) e adicionar `Accept:text/html` ao `fetch()` de navegação em `spa-router.js` — sem esse cabeçalho, o pedido caía na via genérica `stale-while-revalidate` do `sw.js` em vez de "rede primeiro" (`isNavigation`). Fundido: `RouteGuard` mantido, cabeçalho `Accept:text/html` aplicado, toast de depuração da navegação SPA removido (só existia para confirmar visualmente cada navegação em teste). `sw.js` v30→v31. (2) **Push notifications que pediam permissão mas não activavam**: causa era a CSP em `_headers` — `script-src` não incluía `https://www.gstatic.com` (bloqueava o carregamento do SDK da Firebase) e `connect-src` não incluía `https://firebaseinstallations.googleapis.com`/`https://fcmregistrations.googleapis.com` (bloqueava o pedido do token FCM); o utilizador via o diálogo nativo, concedia, e a activação falhava sempre a seguir em silêncio (bloqueio de CSP, não erro de rede) — corrigido só no `_headers`, sem tocar em JS. (3) **Toast redesenhado** ao estilo do mockup enviado (ícone animado maior à esquerda com "pop" de entrada — confetti extra no tipo "ok" —, título + subtítulo, botão fechar (X), sem barra de progresso, entrada slide+fade / saída só fade) — `.toast` em `css/style.css` e `toast()` em `js/app.js`; `?v=` de `style.css` e `app.js` subido nas 55 páginas que os referenciam.

**Ronda 30 (22 Ago 2026)** — Convertido o 1º par ao SPA Router: `home.html` ↔ `notifications.html`. Achados e correcções feitas ao próprio `spa-router.js` (Ronda 29) ao testar contra código real pela primeira vez: (1) `let`/`const` de topo de nível nos scripts destas páginas (ex. `let _feedPage=1`) rebentariam com "já declarado" ao voltar à mesma página ou à página de origem — corrigido isolando cada script numa IIFE própria, com `function`/`async function`/`let`/`const` de topo expostos ao `window` (validado com Node contra o código real das duas páginas, 2 execuções seguidas sem erro); (2) `Bazares.Breadcrumbs` guardava um "nome real" (`lastOverride`) que só se limpava em recarregamento completo — corrigido chamando `setLast(null)` em vez de só `render()` a cada navegação SPA. Nenhuma das duas correcções exigiu tocar em `core.js`. Sidebar e bottom-nav (ambos usam `onclick="go(...)"`) confirmados a passar pelo router automaticamente; único `<a href="notifications.html">` solto (link "Ver todas as notificações") coberto pelo interceptor de cliques do router. **Gap conhecido, não resolvido nesta ronda**: a restauração exacta de posição de scroll ao voltar atrás (`saveListState`/`getListState`, já existente) não está ligada à navegação SPA — o router só faz scroll-to-top; baixo impacto neste par (nem home nem notifications usam essa memória hoje), mas relevante para o próximo par se envolver uma página de listagem. `?v=` do `spa-router.js` fixado numa versão final única, `sw.js` v27→v28. Entregue `bazares-frontend-round30-spa-primeiro-par.zip` (spa-router.js, app.js, sw.js, home.html, notifications.html — auto-contido mesmo que a Ronda 29 ainda não tenha sido aplicada). Validado por `node --check` + parse de scripts inline + simulação em Node do isolamento de scripts.

**Ronda 29 (21 Ago 2026)** — Implementado `js/spa-router.js`: router pjax em vanilla JS (fetch + troca do innerHTML de `#main` + `history.pushState`/`popstate`), sem bundler nem framework. Fallback total para navegação normal (`location.href`) sempre que a página actual ou o destino não estiverem registados via `BazaresRouter.register(...)` — ou seja, **zero risco para as 55 páginas actuais**, nada muda até uma página ser explicitamente convertida. `go()` em `app.js` já delega no router quando aplicável. popstate do router só reage a `state.spa===true`, coexiste sem conflito com a guarda de overlays já existente (`state.bzOverlay`). `?v=` do app.js subido + `sw.js` v26→v27 + `spa-router.js` pré-cacheado. **Nenhuma página convertida ainda** — próximo passo é escolher o 1º par (sugestão: Home↔Notificações, baixo risco) e testar em produção antes de continuar página a página.

**Ronda 28 (21 Ago 2026)** — Criado este plano. Ao tentar "fechar" a fase de Navegação e estrutura, cheguei a construir `js/nav-manager.js` (scroll restoration + barra de progresso + breadcrumbs) e a injectá-lo nas 54 páginas + subir o `sw.js` — só para descobrir a meio, ao ler `core.js` (510 linhas) e mais a fundo `app.js`, que **as 3 coisas já existiam**: `Bazares.Breadcrumbs` (árvore completa), `Bazares.Loading` (barra no topo) e `restoreScrollY()`/`saveListState()` (scroll + posição de lista). Tudo revertido (confirmado por diff byte-a-byte contra o zip original — `sw.js` e as 55 páginas ficaram idênticos). `core.js` também trouxe à luz um conjunto de managers (`Error`, `Connectivity`, `RequestCache`, `Recovery`, `Undo`) que não estavam registados em memória nenhuma — corrigida a estimativa geral de ~50% para ~65-70%, e a secção "Cérebro responsivo" de 10% para ~70%. **Fase "Navegação e estrutura" considerada fechada** (~95%, resto é 🚫 N/A por decisão de arquitectura).

---

## Como usar isto daqui para a frente
1. Antes de pedir/implementar algo desta lista → `grep -rn` a palavra-chave em `js/*.js` e `*.html` primeiro.
2. Depois de qualquer ronda de trabalho → adicionar uma entrada no "Log de rondas" (data, o que mudou, ficheiros tocados) e actualizar o estado (✅/⚠️/❌/🚫) dos itens afectados nas secções acima.
3. Zips incrementais continuam a ser o formato de entrega (workflow mobile-only via GitHub); este ficheiro é só o mapa — não substitui os zips.
