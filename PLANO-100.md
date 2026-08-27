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
- ✅ Drawers / Bottom sheets — **corrigido na Ronda 33**: `Bazares.Drawer`/`Bazares.Sheet` (`js/app.js`) existem e já são usados (menu de reações, listas — ex. `js/app.js:2824`, `:2910`); a estimativa anterior (Ronda 28) datava de antes destes serem construídos
- ✅ Dropdowns — **corrigido na Ronda 33**: `Bazares.Dropdown` (`js/runtime.js:430`) é um componente genérico próprio, além do uso pontual em `maps.js`
- ⚠️ Tooltips — ainda sem componente genérico confirmado
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

## 🧑‍🤝‍🧑 Confiança e segurança visual — ~40%
- ✅ Sinais claros de vendedor verificado — "verificad" presente em `bazar.html`, `product.html`, `dashboard.html`, `my-bazar.html`, `products.html`, `search.html`, `seller-guidelines.html`, `verify-email.html`
- ⚠️ Reputação fácil de compreender — rating/avaliação presente (`bazar`, `product`, `ranking.html`, `my-orders`), não confirmado se é um componente único ou repetido ad hoc por página
- ⚠️ Informações importantes sem excesso de badges — badges (`badge b-gray/b-grn/b-red/b-gld/b-amb`) espalhados por ~9 páginas admin/loja, não auditado se há sobrecarga visual
- ❌ Avisos de segurança contextuais — não encontrado padrão dedicado (nenhum aviso inline tipo "este vendedor é novo" / "confirma antes de pagar fora da plataforma")
- ⚠️ Ações sensíveis com confirmação — `confirmDialog()`/`Bazares.Modal.confirm` existe e cobre logout e terminar sessões (`profile.html`, `settings.html`) e pagamento da wallet, mas só 5 páginas o chamam; eliminar produto usa o padrão `Bazares.Undo` (apaga já, desfaz depois) em vez de confirmação prévia — válido como alternativa, não é a mesma coisa
- 🚫 Interface que transmite confiança — subjetivo, não auditável por grep
- ❌ Prevenção visual contra ações suspeitas — não encontrado
- ⚠️ Privacidade explicada no momento certo — `seller-guidelines.html`/`settings.html` mencionam privacidade, não confirmado se aparece contextualmente (no momento da ação) ou só numa página estática

## ♿ Acessibilidade como UX — ~20%
- ❌ Contraste adequado — **medido na Ronda 35** (18 pares fg/bg calculados por WCAG 2.1, fórmula de luminância relativa): a maioria do texto passa confortavelmente (texto principal 13–18.4:1, `.btn-primary` com texto escuro sobre o gradiente verde 5.5–8.2:1), mas o **verde da marca usado directamente como cor de texto/ícone falha mal**: `a{color:var(--b-500)}` (todos os links por defeito) dá só **1.79:1** sobre branco (mínimo exigido: 4.5:1 para texto normal, 3:1 até para texto grande) — praticamente ilegível para baixa visão; `--b-600` usado em `.p-price` (preço do produto), `.tb-logo-name`, `.b-grn` (badge) dá **2.65:1**, também abaixo do mínimo; vermelho de erro/perigo (`--r-500`) está no limite, 4.43:1 (só passa para texto grande/negrito, falha para texto normal); no tema escuro, `--t3` sobre `--surf` dá 3.97:1 (só texto grande). **Não corrigido nesta ronda** — mudar as cores da marca é uma decisão de identidade visual, não só técnica; ver nota abaixo antes de tocar nisto
- ❌ Tipografia legível para leitura em ecrã — 148 `font-size` fixos em `px` contra só 3 em `rem`; texto não acompanha o tamanho de fonte do sistema/browser
- ⚠️ Áreas de toque confortáveis — 14 ocorrências de `44px`/`min-height:44px` em `css/style.css`, não confirmado que cobre todos os alvos tocáveis
- ✅ Navegação por teclado — **corrigido na Ronda 35**: `Bazares.Modal` (todos os diálogos/drawers/sheets/confirmações) ganhou focus trap (Tab não sai do painel), foco inicial ao abrir e devolução do foco ao elemento anterior ao fechar; `Bazares.Dropdown` ganhou o mesmo padrão (foco no 1º item ao abrir, devolvido ao botão que abriu ao fechar). Ainda falta: navegação por setas dentro de dropdowns/menus (só Tab funciona), e carrosséis/tabs não têm gestão de teclado própria
- ⚠️ Focus states visíveis — **melhorado na Ronda 34**: adicionado anel de foco genérico (`:focus-visible`) para links, botões, `[role="button"]`, `.card` e `.dropdown-item` em `css/style.css`; ainda não cobre todos os elementos interativos custom (ex. itens dentro de drawers/sheets)
- ⚠️ Screen reader support — **melhorado na Ronda 34**: adicionada a classe utilitária `.sr-only` a `css/style.css` (ainda por adotar página a página); os 30 `aria-*` existentes não foram auditados individualmente nesta ronda — continua a ser o item mais fraco desta secção
- ✅ Mensagens de erro acessíveis — **corrigido na Ronda 34**: `#toast-root` (`js/app.js`) ganhou `aria-live="polite"` + `role="status"`, criado uma única vez; todos os toasts (`ok`/`err`/`warn`/`info`) passam a ser anunciados a leitores de ecrã sem interromper o que já estava a ser lido
- 🚫 Não depender apenas de cores — não auditável por grep (precisa de inspeção visual página a página)
- ✅ Suporte a aumento de texto — **corrigido na Ronda 34**: `maximum-scale=1,user-scalable=no` removido do viewport nas 56 páginas (404.html não tinha viewport com este problema); pinch-zoom e escala de texto do browser voltam a funcionar
- ✅ Reduced Motion — **corrigido na Ronda 34**: a Ronda 33 só tinha procurado em `*.html` e perdeu a regra global em `css/style.css:2128` (`*,*::before,*::after{animation-duration:.01ms!important;...}`), que já cobre toda a folha de estilo, não só páginas pontuais; há ainda regras específicas para drawers/sheets/dropdown/tooltip (linha 2917) e para o hero premium

## 🌙 Tema e personalização — ~55%
- ✅ Dark mode bem projetado — `data-theme` presente nas 56 páginas
- ✅ Tema consistente em todas as páginas — idem, 56/56
- ✅ Preferência do sistema respeitada — **corrigido na Ronda 34**: `initTheme()` (`js/app.js`) agora usa `matchMedia('(prefers-color-scheme: dark)')` como fallback quando não há tema guardado em `localStorage`; a escolha explícita do utilizador continua a ter prioridade
- ⚠️ Transição suave entre temas — `transition` em propriedades `background`/`color` existe de forma generalizada em `css/style.css`, não confirmado que está especificamente ligada à troca de tema (`data-theme`) e não só a hover/focus
- ⚠️ Cores semânticas adaptadas — tokens CSS em `:root` existem (cores da marca com comentários), não confirmado nomenclatura semântica (ex. `--color-danger` vs `--red-500`) nem se há um segundo bloco `:root` por tema
- ❌ Contraste mantido nos dois temas — mesma limitação acima; o problema do verde de marca como cor de texto existe nos dois temas (o fundo muda, mas `--b-500`/`--b-600` continuam a ser usados como texto sobre superfícies claras/médias em ambos)

## 🧩 Componentes e padrões de interface — ~50%
- ⚠️ Biblioteca visual de componentes — tokens CSS (`:root`) + classes reutilizáveis (`.btn-*`, `.card`, `.badge`) existem, mas não há um ficheiro/documento que os cataloge como biblioteca formal
- ✅ Cards padronizados — classe `.card` usada 133 vezes nas 56 páginas
- ✅ Botões padronizados — 17 variantes (`.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-soft`, `.btn-tag`, `.btn-icon`, `.btn-kebab`, etc.) centralizadas em `css/style.css`
- ✅ Inputs padronizados — estilo global por elemento (`input,select,textarea{...}` em `css/style.css`, incl. `:focus`/`:disabled`), não por classe utilitária, mas consistente em toda a base
- ⚠️ Modais com linguagem visual comum — `modal-root` presente nas 55+ páginas (confirmado em ronda anterior), visual comum assumido mas não relido linha a linha nesta ronda
- ✅ Bottom sheets consistentes — `Bazares.Drawer`/`Bazares.Sheet` (`js/app.js`) — ver correção acima em UI/UX
- ✅ Dropdowns consistentes — `Bazares.Dropdown` (`js/runtime.js`) — ver correção acima em UI/UX
- ❌ Estados de componentes documentados — nenhum ficheiro/comentário formal encontrado (loading/error/empty/disabled por componente)
- ⚠️ Variantes bem definidas — clara para botões (17 variantes nomeadas); não confirmado para cards/badges/inputs
- ⚠️ Evitar criar um novo componente por página — violação já registada na secção Arquitetura: `.nr-product-picker` duplicado inline em pelo menos 3 páginas (`anuncio.html`, `historia.html`, `newreels.html`) em vez de extraído

---

## Log de rondas (o que foi feito, para nunca reabrir o que já está fechado)

**Ronda 35 (27 Ago 2026)** — Continuação directa da Ronda 34: os dois itens que tinham ficado por fazer (foco/teclado em overlays, contraste medido). (1) **Focus trap + devolução de foco**: `Bazares.Modal` (`js/app.js`) ganhou `_focusPanel()` (foca o 1º elemento focável do painel ao abrir, ou o próprio painel se não houver nenhum) e um handler de `Tab`/`Shift+Tab` que prende o foco dentro do painel do topo da pilha enquanto estiver aberto; guarda `document.activeElement` em `layer._bzPrevFocus` (ou `root._bzPrevFocus` só no 1º open, para não perder o alvo original ao trocar conteúdo de um modal já aberto) e devolve o foco a esse elemento em `_removeTopLayer()` — ponto único de remoção do DOM, por isso cobre fecho normal (`close()`) e fecho pelo botão voltar (`registerOverlayCloser`) sem duplicar lógica; só devolve o foco se o elemento ainda existir na página (protege contra apagar o alvo, ex. produto eliminado). `Bazares.Dropdown` (`js/runtime.js`) ganhou o mesmo padrão em miniatura: `role="menu"` no painel, foco no 1º item ao abrir, foco devolvido ao `anchor` (botão que abriu) ao fechar — por Escape, clique fora, ou selecção de item. (2) **Contraste medido de verdade**: como não há acesso a ferramentas de contraste do browser neste ambiente, calculei os rácios WCAG 2.1 (luminância relativa, fórmula oficial) em Python para os pares fg/bg mais usados, extraídos dos tokens `:root` de `css/style.css`. Achado principal: o verde-néon da marca (`--b-500 #00E043`, `--b-600 #00B837`) **falha WCAG AA quando usado como cor de texto/ícone** sobre fundos claros — `a{color:var(--b-500)}` (todos os links por defeito) dá 1.79:1, muito abaixo do mínimo de 4.5:1; `.p-price`/`.tb-logo-name`/`.b-grn` com `--b-600` dão 2.65:1. Importante: **o botão primário não tem este problema** — `.btn-primary` usa texto escuro (`#1F2937`) sobre o gradiente verde, 5.5–8.2:1, dentro da norma; o problema é especificamente verde-sobre-claro usado como texto, não o verde como fundo de botão. **Não corrigido** — mudar a cor de marca usada em links/preços é uma decisão de identidade visual (o verde-néon foi escolhido deliberadamente, ver comentário no `:root`), não só um ajuste técnico; a proposta ficaria para confirmação antes de tocar nisto (ex.: criar um token `--b-700-text` mais escuro só para uso como texto, mantendo `--b-500`/`--b-600` para fundos onde já funcionam). Ficheiros partilhados tocados (`js/app.js` de novo, `js/runtime.js` pela 1ª vez) obrigaram a nova subida de `?v=` nas páginas que os referenciam (`runtime.js` 1788700000→1788960000; `app.js` 1788950000→1788970000 — mudou de conteúdo outra vez depois da Ronda 34 já ter subido a versão, por isso subiu de novo, não ficou parado) e do `CACHE_NAME` do `sw.js` (`v53`→`v54`). Validado: `node --check` a `app.js`/`runtime.js`/`sw.js`, chavetas balanceadas em `style.css` (1442/1442), 56 páginas com scripts inline verificados via `new Function()` — 0 erros reais. **Por fazer**: navegação por setas dentro de dropdowns/menus, gestão de teclado em carrosséis/tabs, decisão sobre os tokens de cor de texto antes de corrigir o contraste, `aria-*` sistemático fora dos overlays, `.sr-only` ainda por adotar nas páginas.

**Ronda 34 (27 Ago 2026)** — Corrigidos os achados de acessibilidade mais graves da Ronda 33, todos confirmados por `grep` antes de tocar em código (regra de ouro). (1) **Viewport bloqueava zoom/texto**: removido `maximum-scale=1,user-scalable=no` do `<meta name="viewport">` nas 56 páginas (batch `sed`; `404.html` não tinha esse problema, ficou inalterada). (2) **Toasts mudos para leitores de ecrã**: `#toast-root` (`js/app.js`) ganhou `aria-live="polite"` + `role="status"` no momento em que é criado. (3) **Tema não seguia o SO**: `initTheme()` (`js/app.js`) passou a usar `matchMedia('(prefers-color-scheme: dark)')` como fallback quando não há `bz_theme` guardado — a escolha manual do utilizador continua a ganhar sempre que existir. (4) **Foco pouco visível**: adicionado anel `:focus-visible` genérico + classe `.sr-only` a `css/style.css`. (5) Ao reler o `css/style.css` completo para o item 4, descoberta uma regra global de `prefers-reduced-motion` (linha 2128) que a Ronda 33 tinha perdido por só ter feito `grep` em `*.html` — corrigido o item de ⚠️ para ✅ no plano. Ficheiros partilhados tocados (`js/app.js`, `css/style.css`) obrigaram a subir a `?v=` partilhada (`1788790000`→`1788950000`) nas páginas que os referenciam e o `CACHE_NAME` do `sw.js` (`v52`→`v53`); confirmado que `api.js`/`core.js` (não tocados) mantiveram a sua versão antiga tanto no `sw.js` como nas páginas, para não repetir o desalinhamento da Ronda 31b. Validado: `node --check` a `app.js`/`sw.js`, chavetas balanceadas em `style.css` (1442/1442), e os 56 `<script>` inline verificados com `new Function()` (16 falsos positivos eram blocos `application/ld+json`, não JS — 0 erros reais). **Por fazer** (não desta ronda): `tabindex`/gestão de foco em modais e drawers, `aria-*` sistemático nos componentes, contraste medido com ferramenta dedicada, `.sr-only` ainda por adotar nas páginas.

**Ronda 33 (27 Ago 2026)** — Auditadas por `grep` as 4 secções novas trazidas pelo utilizador (Confiança e segurança visual, Acessibilidade, Tema e personalização, Componentes e padrões), seguindo a regra de ouro do ficheiro. Achados principais: (1) dois itens da secção UI/UX antiga estavam desactualizados — `Bazares.Drawer`/`Bazares.Sheet` e `Bazares.Dropdown` já existem como componentes genéricos (corrigido de ❌/⚠️ para ✅); (2) acessibilidade é o ponto mais fraco do frontend (~20%): `0 tabindex` nas 56 páginas, `0 aria-live`/`role="alert"`, só 30 `aria-*` no total, e o viewport tem `user-scalable=no`/`maximum-scale=1` a bloquear activamente o aumento de texto — isto é uma regressão activa, não só uma lacuna; (3) 148 `font-size` em `px` contra só 3 em `rem` significa que o texto não acompanha as definições de acessibilidade do sistema; (4) tema não respeita `prefers-color-scheme` (`0` ocorrências) — só o toggle manual decide o tema inicial. Nenhum código alterado nesta ronda, só auditoria e actualização deste ficheiro.



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
