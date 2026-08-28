# Bazares — Auditoria UX/Visual (categorias 1-10)

> Mesma lógica do `PLANO-100.md`: antes de implementar qualquer item, confirmar no código com grep — já há bastante feito que não estava documentado.

Legenda: ✅ Feito e confirmado no código · ⚠️ Parcial/inconsistente (existe mas não é sistemático) · ❌ Falta mesmo · 🚫 Não aplicável

---

## 1️⃣ Experiência e navegação

- ⚠️ **Hierarquia entre ações principais/secundárias** — existem classes `btn-terra` (primária) vs `btn-soft` (secundária), mas o critério de quando usar cada uma não está escrito em lado nenhum; varia por página conforme quem editou
- ✅ **Navegação previsível** — router SPA (pjax: fetch+swap de `#main`+pushState) activo nas 56 páginas, comportamento uniforme confirmado
- ⚠️ **Redução de cliques para ações frequentes** — nunca foi auditado fluxo a fluxo (ex.: quantos toques até publicar um produto); provavelmente há gordura por cortar
- ⚠️ **Estados de navegação consistentes** (item activo na topbar/sidebar, hover, focus) — não confirmado ponto a ponto
- ✅ **Feedback imediato após cada ação** — função global `toast(msg, tipo)` + `Bazares.Loading` (barra de progresso) já cobrem a maioria das acções
- ✅ **Preservação do contexto ao voltar** — `scrollRestoration:'manual'` + `restoreScrollY()`/`saveListState` já implementados
- ⚠️ **Destinos previsíveis após ações** — nunca mapeado o que acontece a seguir a cada acção-chave (comprar, publicar, denunciar); risco de inconsistências
- ⚠️ **Deep links com experiência natural** — funciona via `?id=`, mas o formato bonito `/product/:slug` ainda quebra em produção porque o deploy é Direct Upload (Cloudflare Functions não corre) — ver pendência já registada
- ⚠️ **Ações principais sempre visíveis** — só 3 páginas usam botão flutuante (FAB); no resto, a ação principal fica dentro do fluxo normal de scroll — não padronizado
- ❌ **Redução de decisões desnecessárias** — nunca avaliado com uma lente própria (nº de campos por formulário, opções por ecrã); precisa de revisão manual página a página

## 2️⃣ Sistema visual e consistência

- ⚠️ **Design tokens completos** — cor, radius, sombra e fonte têm tokens em `:root`; espaçamento não tem
- ⚠️ **Espaçamento consistente** — criados tokens `--space-1` a `--space-8` no `:root` do `style.css`; já aplicados em `.pg-hero`, `.sh`, `.sh-row` e `.section-pill`. O resto do CSS (largamente maioritário) continua com px soltos — migração vai continuar aos poucos, não é seguro trocar tudo de uma vez sem testar cada secção
- ⚠️ **Border radius consistente** — tokens existem (`--r`, `--rl`, `--rxl`, `--rxxl`, `--pill`) e são usados ~80 vezes, mas ainda há dezenas de valores hardcoded (2px, 3px, 10px, 12px...) a conviver com eles
- ✅ **Sombras consistentes** — `--sh0` a `--sh3` + variantes de marca (`--sh-green`, `--sh-gold`, `--sh-terra`, `--sh-dark`), usadas de forma sistemática
- ⚠️ **Elevação (z-index/camadas)** — criados tokens nomeados `--z-base/--z-sticky/--z-nav/--z-overlay/--z-modal/--z-toast/--z-top` mapeados aos números já em uso; os z-index actuais no ficheiro não foram migrados retroactivamente (risco de quebrar a ordem de sobreposição sem testar cada modal/overlay um a um) — tokens ficam disponíveis para código novo
- ❌ **Escala tipográfica definida** — sem tokens de tamanho de fonte; cada título/parágrafo usa `clamp()` próprio, decidido componente a componente
- ⚠️ **Hierarquia visual padronizada** — decorre da tipografia ad-hoc acima; funciona visualmente mas não está formalizada
- ✅ **Sistema de cores semântico** — `--grn/--red/--amb/--blu` + variantes `-bg`, usado de forma consistente para sucesso/erro/aviso/info
- ⚠️ **Estados visuais padronizados** (hover/active/disabled/loading) — existem em botões e inputs, mas nunca auditados componente a componente
- ⚠️ **Component variants consistentes** — variantes de botão existem (`btn-terra`, `btn-soft`, `btn-sm`...) mas sem catálogo central; fácil inventar uma nova variante sem perceber que já existe equivalente
- ✅ **Ícones com o mesmo estilo visual** — corrigido nesta ronda: a nota anterior estava mal filtrada (misturava a ilustração decorativa de `login.html`/`register.html`, que usa vários grossuras de linha de propósito, com os ícones funcionais `.ico-inline`); confirmado que os ícones `.ico-inline` reais só destoavam em 3 pontos (bazar.html, historia.html, my-products.html) — já uniformizados para `stroke-width="2"`. Continua por resolver a duplicação de implementação (helper `icon()` em 22 páginas vs SVG copiado à mão nas outras 52) — visualmente já está tudo igual, mas manter duas formas de gerar o mesmo ícone é mais trabalho de manutenção

## 3️⃣ Design gráfico e identidade

- ⚠️ **Identidade visual reconhecível** — item subjetivo, não avaliável só por código; depende de olhar a app inteira lado a lado
- ✅ **Uso estratégico do verde do Bazares** — presente no hero, topbar, botões primários (`--g-green`)
- ✅ **Cor de destaque para ações importantes** — regra escrita como comentário junto dos gradientes em `style.css`: verde = ação principal/confiança, dourado = reservado a Premium (nunca em ações comuns), terracota = avisos suaves/decoração capulana (nunca cor de botão de ação)
- ❌ **Ilustrações próprias / linguagem gráfica consistente** — não encontrei nenhuma ilustração customizada no repo; só ícones outline + o padrão geométrico capulana
- ✅ **Empty states com identidade da marca** — classe `.empty`/`.empty-ico` já usada em várias páginas de admin e listagens
- ⚠️ **Error states visualmente amigáveis** — existe `toast('err', ...)` e `Bazares.Error`, mas não há um ecrã de erro dedicado e ilustrado (só notificação toast)
- ⚠️ **Success states memoráveis** — `toast('ok', ...)` existe e há menção a um efeito confetti no `app.js`, mas não confirmei o alcance (quantas acções o disparam)
- ✅ **Elementos gráficos subtis da marca** — padrão capulana (`--capulana-pattern` / `--capulana-pattern-brand`) usado no hero e no topbar
- 🚫 **Consistência entre web e PWA** — não existe uma versão "web" separada da PWA; é a mesma app, o item não se aplica tal como está formulado
- ⚠️ **Microdetalhes que reforçam identidade** — subjetivo, precisa de revisão visual directa, não só de código

## 4️⃣ Experiência mobile-first

- ⚠️ **Áreas de toque maiores** — a maioria dos botões-ícone já usa 44×44px (padrão recomendado), mas `.btn-xs` (padding 5px, fonte 11px) fica com altura real ~25px — abaixo do mínimo, usado em algumas ações que não são claramente só decorativas
- ✅ **Bottom navigation otimizada** — `.bottom-nav` existe, com safe-area aplicada, escondida em ecrãs largos
- ⚠️ **Ações principais acessíveis com uma mão** — só 3 páginas têm FAB; no resto a ação principal está algures no meio do scroll
- ✅ **Bottom sheets para ações contextuais** — padrão `.sheet-handle`/`.sheet-list`/`.sheet-item` já existe e está em uso
- ✅ **Formulários adaptados ao mobile** — inputs a `font-size:16px` (evita o zoom automático do iOS Safari, já corrigido em ronda antiga)
- ❌ **Teclado não deve esconder ações importantes** — não encontrei nenhum tratamento de `visualViewport` nem `scrollIntoView` ao focar inputs; risco real em ecrãs com campo fixo ao fundo (ex.: caixa de mensagem em `chat.html`) — depende só do comportamento nativo do browser, que varia por Android/iOS
- ⚠️ **Gestos naturais** — pull-to-refresh existe; não encontrei swipe-to-dismiss nem swipe-to-delete em listas (ex.: arquivar conversa, remover favorito)
- ⚠️ **Pull-to-refresh consistente** — implementado em `js/app.js`, mas não confirmei que está ligado em todas as páginas de lista (feed, notificações, produtos, pedidos) — precisa auditoria página a página
- ✅ **Safe area handling** — `env(safe-area-inset-*)` usado de forma consistente (bottom-nav, FAB, Reels, comentários, topo dos modais)
- ⚠️ **Feedback háptico onde aplicável** — só encontrei UMA chamada a `navigator.vibrate()` em todo o código; oportunidade não aproveitada (gostar, favoritar, confirmar compra, etc.)
- ⚠️ **Redução de elementos desnecessários no ecrã** — subjetivo, precisa de revisão visual directa página a página

## 5️⃣ Velocidade percebida

- ⚠️ **Skeletons específicos para cada tipo de conteúdo** — sistema completo pronto (`.skel-card`, `.skel-text`, `.skel-title`, `.skel-img`, `.skel-avatar`); já ligado a `products.html`, `favorites.html`, `my-products.html` (grelhas via `skeletonCards`) e `notifications.html` (lista via `skeletonRows`, novo); ~34 páginas com spinner genérico continuam por adoptar
- ✅ **Progressive loading** — scroll infinito com sentinel (`IntersectionObserver`) já implementado em feed/produtos/notificações
- ⚠️ **Conteúdo prioritário aparece primeiro** — subjetivo, não avaliável só por código
- ⚠️ **Placeholders inteligentes** — parcialmente (índex.html já mostra "···" em vez de "0" enquanto as estatísticas carregam), mas não é um padrão replicado nas outras páginas
- ✅ **Feedback instantâneo após toque** — `toast()` global + `Bazares.Loading` (barra de progresso)
- ✅ **Optimistic UI visível mas controlada** — `Bazares.Undo` (padrão "apaga já, desfaz depois")
- ✅ **Transições durante carregamento** — véu de fade em `go()` (navegação SPA)
- ⚠️ **Evitar ecrãs completamente vazios** — depende do mesmo problema dos skeletons acima: a maioria mostra um spinner sozinho no meio do ecrã em vez de um esqueleto do conteúdo
- ✅ **Evitar loaders infinitos** — `fetchWithRetry` com timeout (20s, mais para uploads) + `Bazares.Recovery` com botão "Tentar novamente"
- ✅ **Mensagens claras durante operações demoradas** — aviso "Isto pode demorar um pouco dependendo da tua ligação — não feches esta página" acrescentado ao editor de vídeo (`js/video-editor.js`); uploads de imagem continuam sem esta mensagem

## 6️⃣ Estados da interface

- ✅ **Loading states** — `Bazares.Loading` (barra de progresso) + spinners por página
- ✅ **Empty states** — classe `.empty`/`.empty-ico` usada de forma consistente (pesquisa, produtos, comentários, admin)
- ⚠️ **Error states** — `toast('err', ...)` cobre o caso geral, mas é sempre a mesma notificação — não há variação visual por tipo de erro
- ✅ **Offline states** — `Bazares.Connectivity` já avisa por toast quando perde/recupera ligação
- ✅ **Success states** — `toast('ok', ...)`
- ✅ **Retry states** — `Bazares.Recovery` + botão "Tentar novamente" em várias páginas (feed, notificações, produtos, explorar)
- ⚠️ **Permission denied states** — tratado para permissões do browser (geolocalização, notificações push), mas não encontrei um estado equivalente para "não tens autorização para fazer isto" a nível da aplicação (ex.: tentar aceder a uma área de vendedor sem ser vendedor)
- ✅ **Expired session states** — `bazares:unauthorized` agora mostra `toast('A tua sessão expirou. Inicia sessão novamente.', 'warn')` antes do redirect para login, só quando havia mesmo sessão activa
- ✅ **No search results states** — bem tratado em `search.html`/`products.html`, com mensagem específica ("Sem resultados para '...'") e sugestão de tentar outros termos
- ⚠️ **Deleted content states** — `product.html`/`bazar.html` já mostram "Produto não encontrado"/"Bazar não encontrado" com botão de voltar, mas é genérico — não distingue "foi removido" de "nunca existiu" ou "está privado"
- ⚠️ **Private/unavailable content states** — mesmo tratamento genérico do ponto acima; não há uma mensagem própria para "este conteúdo é privado" vs "não existe"

**Nota transversal a toda a categoria 6**: nenhum dos estados tem hoje um "tom humano" muito trabalhado — a maioria são mensagens curtas e funcionais (o que já é bom), mas não há ilustração ou frase com personalidade da marca a acompanhar (liga ao achado da categoria 3 sobre ilustrações próprias inexistentes)

---

## Resumo rápido
**Mais forte:** sombras, cores semânticas, empty states, feedback de ações, navegação SPA, ícones, regra de cor de destaque, safe-area, bottom sheets, no-results state, retry/recovery, sessão expirada agora avisada, favoritos e reacções sobrevivem offline, indicador de sincronização visível, mensagens de erro sem código técnico.
**Ainda fraco:** escala tipográfica (sem tokens), ilustrações próprias (inexistentes), espaçamento e elevação (tokens criados mas só aplicados a pontos pontuais), skeletons ainda por adoptar em ~34 páginas, teclado sem tratamento de viewport, feedback háptico quase inexistente, comparação entre produtos inexistente, progresso real (%) de upload de imagens por fazer.

**Feito na Ronda 57:**
1. Tokens de espaçamento (`--space-1` a `--space-8`) e de elevação (`--z-*`) criados e aplicados aos primeiros componentes
2. Ícones `.ico-inline` uniformizados para `stroke-width="2"` em toda a app (3 pontos fora do padrão corrigidos)
3. Regra de cor de destaque escrita directamente no CSS

**Feito na Ronda 59:**
1. **Sessão expirada** — aviso por toast antes do redirect para login, só quando havia sessão activa
2. **Skeletons adoptados** — `skeletonCards` ligado a `products.html`, `favorites.html`, `my-products.html`; novo helper `skeletonRows()` ligado a `notifications.html`
3. **Aviso de demora em uploads** — acrescentado ao editor de vídeo

**Feito nesta ronda (categorias 8-10 + merge):**
1. **Mensagens de erro sem código técnico** — fallback `friendlyStatusMessage()` por código HTTP quando o backend não envia `message` própria
2. **Ações offline confirmadas** — `ActionQueue.flush()` avisa por toast quando o que ficou pendente é sincronizado com sucesso
3. **Indicador de sincronização visível** — botão discreto no topbar (`ActionQueue.onChange`) que só aparece quando há ações por sincronizar
4. **Favoritos sobrevivem offline** — `toggleFavorite`/`toggleFeedFavorite` passam a enfileirar em vez de reverter silenciosamente
5. **Token de duração de animações** — escala `--dur-fast/base/slow/loop` criada e aplicada aos shimmers de loading (migração das restantes animações fica para quando houver forma de validar visualmente)

**A seguir, quando quiseres continuar:**
- Ir migrando o resto do CSS para os tokens de espaçamento, secção a secção
- Adoptar skeletons nas ~34 páginas que ainda usam spinner genérico
- Decidir se vale a pena unificar as duas formas de gerar ícones (helper `icon()` vs SVG à mão)
- Escala tipográfica e ilustrações próprias continuam por começar
- Progresso real (%) de upload de imagens; comparação entre produtos no marketplace

---


## 8️⃣ Feedback e comunicação

- ✅ **Sistema de feedback unificado** — `toast(msg, tipo)` global (`js/app.js`) usado 364× em todas as páginas; um único componente para sucesso/erro/aviso/info
- ✅ **Toasts consistentes** — mesmo componente sempre (ícone à esquerda, mensagem, botão fechar), com dispensa por swipe ou toque; não há variantes divergentes por página
- ✅ **Mensagens de sucesso claras** — `toast(msg,'ok')` usado de forma consistente após acções-chave (publicar, encomendar, etc.)
- ⚠️ **Mensagens de erro compreensíveis** — `apiErrorMessage()` (`js/api.js`) já mapeia erros de rede/upload/rate-limit (429) para frases claras em português; mas quando o backend não devolve `message`, cai para `Erro ${res.status}` (ex.: "Erro 404", "Erro 500") — ainda técnico nesses casos
- ⚠️ **Erros sem linguagem técnica** — depende do backend enviar sempre uma `message` amigável; o fallback genérico acima é a excepção que ainda escapa
- ⚠️ **Feedback para ações em background** — existe para reacções (toast quando fica em fila offline) e a barra `Bazares.Loading`, mas o `ActionQueue` genérico (`js/action-queue.js`) não avisa quando reenvia com sucesso ao voltar a rede — silencioso nesse momento
- ❌ **Estados de sincronização visíveis** — o `ActionQueue` guarda acções pendentes em `localStorage` e reenvia sozinho, mas não há nenhum indicador (badge, ícone) a mostrar "X acções por sincronizar"; é tudo invisível excepto o toast inicial
- ⚠️ **Feedback de ações offline** — confirmado pelo menos para reacções (`reactFeed`): toast "Sem ligação — a reacção vai ser enviada quando a internet voltar." + fica marcada no ecrã; não confirmado se todos os outros tipos de acção enfileirável têm o mesmo aviso
- ⚠️ **Confirmações discretas** — o padrão Undo (ver abaixo) funciona como confirmação discreta para eliminar, mas não há um padrão equivalente formalizado para outras acções de confirmação leve
- ✅ **Undo para ações reversíveis** — `Bazares.Undo.perform()` (`js/core.js`): esconde já, só confirma no servidor ao fim de 5s se não houver undo; usado em `cart.html`, `my-products.html`, `js/app.js` (5 ocorrências) — padrão existe mas cobre poucos fluxos ainda

## 9️⃣ Microinterações e animações

- ✅ **Animações com propósito** — 44 `@keyframes` no `style.css`, cada um ligado a um estado concreto (loading, sucesso, entrada de página, shimmer de skeleton) — não encontrei nenhuma decorativa sem função
- ✅ **Feedback visual ao tocar** — `:active{transform:scale(...)}` aplicado sistematicamente a botões, tags, cartões (`.btn:active`, `.tap-fx:active`, `.card-hover:active`, etc.)
- ✅ **Transições suaves** — token único `--ease:.18s cubic-bezier(...)` aplicado a cor/fundo/sombra/transform em toda a folha de estilos
- ✅ **Microinterações em favoritos e reações** — `heart-pop` (favoritos) e `pulseSuccessKf`/`heartBurst` (reacções no feed) confirmados em `js/app.js`
- ⚠️ **Animações de publicação bem-sucedida** — há menção a confetti no `toast()` (tipo "ok" tem um "pop" extra), mas não confirmei um efeito dedicado e distinto para "produto publicado" especificamente, além do toast genérico
- ⚠️ **Feedback durante upload** — existe a barra global `Bazares.Loading` (indeterminada) durante o pedido, e mensagens de erro específicas para falhas de upload; não encontrei uma percentagem/barra de progresso real por ficheiro durante o envio de imagens
- ✅ **Estados animados de loading** — skeleton shimmer (`pImgShimmer`, `shimmer`), spinners (`spin`, `heroSpin`) e pulse (`pulse-num`) cobrem os principais pontos de espera
- ✅ **Evitar animações excessivas** — durações curtas (.18–.5s) para feedback de interacção; loops mais longos (2.6–7s) reservados a elementos decorativos discretos (brilho Premium), não a acções do utilizador
- ✅ **Respeitar Reduced Motion** — regra global em `style.css` (`*{animation-duration:.01ms!important;...}` dentro de `@media(prefers-reduced-motion:reduce)`) anula todas as animações e transições de uma vez; também presente em `splash.css`, `login.html`, `register.html`
- ⚠️ **Consistência na duração das animações** — as transições de interacção usam o token único `--ease` (.18s), mas as animações teatrais (entradas de página, toasts, modais) têm duração cada uma "à mão" (.22s, .25s, .28s, .32s, .38s, .42s, .55s...) sem token partilhado — funcionam bem individualmente mas não há uma escala formal (ex.: fast/base/slow)

## 🔟 Experiência de marketplace

- ✅ **Produto como protagonista visual** — `productCard()`/`productCardCompact()` (`js/app.js`) dão à imagem a maior área do cartão, com lazy loading e fallback próprio quando não há foto
- ✅ **Preço facilmente identificável** — `.p-price` sempre visível no fundo do cartão, com preço antigo riscado (`.p-price-old`) e badge de desconto (`-XX%`) quando aplicável
- ✅ **Informação do vendedor clara** — nome da loja + avatar sempre presentes (`.p-store`), com selo de verificado quando aplicável
- ✅ **Localização fácil de perceber** — `.p-loc` com ícone de pin, mostrado sempre que `p.location` existe
- ✅ **Confiança visível sem poluir o card** — selo de verificado e badge Premium são discretos (ícone pequeno / badge no canto), não dominam o cartão
- ✅ **Imagens como elemento principal** — confirmado, ver "Produto como protagonista visual" acima
- ✅ **CTA de contacto ou compra evidente** — botão primário `btn-terra` "Encomendar" bem destacado na página de produto (`product.html`)
- ❌ **Comparação fácil entre produtos** — não encontrei nenhuma funcionalidade de comparação lado a lado entre produtos no código
- ⚠️ **Informação essencial antes do scroll** — não confirmado ponto a ponto (precisa de revisão visual por dispositivo); o cartão em si mostra o essencial (foto, preço, loja, localização) mas a posição exacta acima da dobra depende do ecrã
- ✅ **Ações secundárias discretas** — favoritos e "mais opções" são ícones pequenos sobre a imagem (`.p-fav`, `.p-more`), sem competir com o preço/CTA principal

---

## Checklist externa — Feedback/Confirmações, Pesquisa/Filtros, Formulários

Ronda dedicada a implementar lacunas de uma checklist de UX recebida à parte (numerada 6️⃣ Feedback e Confirmações, 7️⃣ Pesquisa e Filtros, 8️⃣ Formulários — numeração própria dela, não corresponde às secções acima).

**Novo toolkit partilhado, `js/core.js`** (disponível em todas as páginas, sem novo `<script>` a incluir):
- `Bazares.InlineValidate.attach({...})` — generaliza o padrão já usado em `novoproduto.html` para qualquer formulário: valida por campo ao sair (blur) e a cada tecla depois de já ter erro; mensagem própria por campo em vez de um único alerta genérico no submit.
- `Bazares.InputMask.phoneMZ(el)` / `.currency(el)` — máscara ao vivo para telefone (+258 8X XXX XXXX) e valores monetários.
- `Bazares.FilterChips.render(container, chips, onClearAll)` — chips removíveis para filtros activos + "Limpar tudo".
- `Bazares.BottomSheet.enable(panel)` — transforma um painel já existente num bottom sheet real em mobile (fundo escurecido, fecha com Esc/toque fora), sem alterar o comportamento em ecrã largo.
- `Bazares.Stepper.render(container, steps, currentIndex)` — indicador horizontal para processos em várias etapas (ainda não ligado a nenhuma página).
- `Bazares.Progress.create(container, label)` — barra de progresso com `%` real (ainda não ligado a nenhum upload).
- `Bazares.Autosave.attach(key, getState)` — rascunho de formulário em `localStorage` (ainda não ligado a nenhuma página).

**Já ligado a páginas concretas:**
- `products.html` — chips de filtros activos (categoria/ordenação/preço/condição), cada um removível, com "Limpar tudo"; o painel de filtros (`#pfilt-panel`) agora abre como bottom sheet real em ecrãs ≤680px.
- `register.html` — validação inline em tempo real em todos os campos (nome, email, senha, confirmação), incluindo estado de sucesso visual (borda verde); o alerta genérico de submit deixou de ser a única pista de erro.
- `checkout.html` — máscara de telefone aplicada ao campo de contacto, nos dois modos (produto único e carrinho).

**Descoberto já implementado** (não precisou de trabalho novo): Toast, Snackbar/Undo com acção "Desfazer", `Bazares.Recovery` com botão "Tentar novamente", Loading states contextuais, Skeletons, Empty States, Search Suggestions/Autosuggest (dropdown no topbar global + `search.html`), Recent Searches, Search Empty State, Persistent Labels nos inputs.

**Por fazer, quando quiseres continuar:**
- Ligar `Bazares.InlineValidate` a mais formulários (login, forgot-password, settings, checkout — campos de morada/pagamento).
- Ligar `Bazares.Stepper` a um fluxo real com várias etapas (ex.: publicação de produto em `novoproduto.html`, hoje é um formulário único e longo).
- ~~Ligar `Bazares.Progress` ao upload de imagens/vídeo~~ — **correcção**: ao investigar melhor, `novoproduto.html` já tem progresso real por etapa (compressão + envio via `api.postFormProgress`) numa barra inline própria (`#pm-progress-fill`), implementada antes desta ronda e antes do toolkit genérico existir. Não usa `Bazares.Progress`, mas já cumpre o objectivo — não é uma lacuna real.
- ~~Ligar `Bazares.Autosave` a `novoproduto.html`~~ — **correcção**: idem, já existe (`AUTOSAVE_KEY = 'bz_np_autosave'`, `initAutosave()`/`clearAutosave()`), bespoke e anterior a esta ronda. `Bazares.Autosave` fica disponível para o próximo formulário longo que precisar (ex.: `newreels.html`).
- Faceted Filters mais ricos em `products.html` (hoje: categoria + preço + condição — dá para acrescentar mais critérios se o backend suportar).
- Estender Filter Chips/Bottom Sheet a outras listagens com filtros (`bazars.html`, `anuncios.html`, `explorar.html`) se also tiverem painéis de filtro.

---

## Checklist externa — Tipografia, Botões, Feedback #12

Continuação da ronda anterior, mesma checklist externa (numeração própria dela: Tipografia sem número, 1️⃣1️⃣ Botões, 1️⃣2️⃣ Feedback).

**Descoberto já implementado** (não precisou de trabalho novo):
- Botões: `.btn-primary`, `.btn-ghost`, `.btn-soft` (secundário), `.btn-icon`, `.btn:disabled` já existiam com estilo próprio; `setLoading(btn, bool)` (`js/app.js`) já cobre o padrão "Loading Button" (desabilita + spinner) e é usado de forma consistente; `.sticky-cta` já existe para CTA fixo em mobile; feedback ao toque (`:active{transform:scale()}`) já confirmado na ronda anterior.
- Feedback: Toast, Snackbar+Undo, Recovery com retry, Status Indicator de sincronização, Success Animation em reacções — tudo já confirmado nas rondas anteriores. Progresso real de upload e autosave em `novoproduto.html` afinal já existiam (ver correcção acima) — não eram lacunas.
- `alert()`/`confirm()` nativos do browser: só um `alert()` residual (`js/config.js`, botão de teste do Sentry, só visível a admins) — não é um padrão usado para mensagens normais da app; `confirm()` nativo já tinha sido substituído por `Bazares.Modal`/`confirmDialog` numa ronda anterior.

**Novo nesta ronda:**
- **Type Scale** — tokens `--fs-display/h1/h2/h3/body/body-sm/meta` e `--fw-regular/medium/semibold/bold/black` em `:root` (`css/style.css`). Escala fixa para código novo; não migrei os tamanhos "à mão" já espalhados pelo CSS (risco alto para o benefício, ver nota da ronda 57).
- **Classes utilitárias de tipografia**: `.text-display`, `.h1`/`.h2`/`.h3`, `.text-body`/`.text-body-sm`, `.meta` (metadata discreta), `.price`/`.price--lg`/`.price--sm`/`.price-old` (tipografia de preço com números tabulares), `.tabular-nums`, `.line-clamp-1/2/3`, `.optical-align`.
- **Números tabulares em preços reais**: adicionado `font-variant-numeric:tabular-nums` a `.p-price`/`.p-price-old` (cartão de produto), `.pd-price` (página de produto), `#co-total`/`.sc-total b` (checkout) — para os algarismos não "dançarem" ao alinhar com outros preços na mesma lista.
- **`Bazares.Utils.btnSuccess(btn, label, ms)`** (`js/core.js`) — estado de sucesso temporário num botão (✓ + texto, ~1.6s) em vez de voltar logo ao rótulo normal. Ligado a `register.html`: depois de criar conta e antes do redirect, o botão mostra "Conta criada!" em vez de ficar preso no spinner durante os 700ms de espera.
- **`Bazares.ProgressToast`** (`js/core.js`) — toast com barra de progresso para tarefas em segundo plano que a pessoa pode continuar a acompanhar enquanto navega (`.create(label)` → `.set(pct)`/`.done()`/`.error()`). **Ainda não ligado a nenhum fluxo real**: revi `newreels.html`/`video-editor.js` como candidato óbvio, mas o processamento de vídeo aí obriga a pessoa a ficar no editor (modal), não é verdadeiramente "em segundo plano, pode navegar" — usá-lo ali seria só decoração, não a resolver o padrão pedido. Fica disponível para quando houver uma tarefa genuinamente backgroundable (ex.: publicação de vários produtos em lote, se vier a existir).

**Por fazer, quando quiseres continuar:**
- Aplicar `.meta` às metadatas existentes (timestamps, `.p-loc`, etc.) — hoje têm estilo inline repetido em vez da classe utilitária; troca segura mas manual, página a página.
- Rever `.h1`/`.h2`/`.h3` vs. os tamanhos "à mão" já usados em títulos de página, e ir substituindo section a section (mesmo espírito da migração de espaçamento já em curso).
- `Bazares.Progress`/`Bazares.Stepper` continuam sem um caso de uso real ligado — precisam de um fluxo genuinamente multi-etapa ou de progresso independente de página para valer a pena.
- Botão com `Bazares.Utils.btnSuccess` só está ligado em `register.html`; os fluxos de `profile.html`/`settings.html` fecham o modal imediatamente ao guardar, por isso não há janela para mostrar o estado — ligar aí implicaria primeiro atrasar o fecho do modal, o que é uma mudança de comportamento maior do que só visual.

---

## Ronda de fecho — a completar o que tinha ficado "para depois"

O utilizador pediu explicitamente para não deixar itens de checklist só documentados como pendentes — para serem mesmo implementados. Esta ronda fecha o que estava em aberto nas duas rondas anteriores desta checklist externa, item a item, com honestidade sobre o que dava para fazer e o que não dava.

**Fechado nesta ronda:**
- **`Bazares.InlineValidate` estendido a `login.html`, `forgot-password.html` (pedido de código + reset) e `checkout.html`** (nome, telefone, morada) — os quatro únicos formulários de autenticação/checkout que ainda validavam só no submit com um alerta genérico. Com isto, todos os formulários principais da app (registo, login, recuperação de senha, checkout, novoproduto) têm validação inline por campo.
- **`Bazares.Utils.btnSuccess` também em `login.html`** (botão mostra "Sessão iniciada!" antes do redirect) **e em `forgot-password.html`** (botão mostra "Redefinida!" depois de repor a senha).
- **Filter Chips + Filter Bottom Sheet estendidos a `bazars.html`** — tinha exactamente o mesmo padrão de `.pfilt-panel` que `products.html`; agora também tem chips de categoria/ordenação/verificados removíveis + bottom sheet real em mobile. Confirmei que `anuncios.html` e `explorar.html` **não têm** painel de filtros equivalente (só chips de categoria simples), por isso não havia nada para estender aí.
- **Corrigido um erro meu da ronda anterior**: as classes utilitárias `.h1`/`.h2`/`.h3` que criei tinham tamanhos diferentes dos elementos `<h1>`/`<h2>`/`<h3>` reais (que já têm, e sempre tiveram, uma type scale fixa e coerente definida no topo do `style.css` — `clamp()` + peso + letter-spacing por nível). Ter duas escalas com o mesmo nome de classe era uma armadilha para o próximo formulário que as fosse usar à espera do tamanho errado. Renomeei para `.title-lg`/`.title-md`/`.title-sm`, com comentário a explicar que servem para "títulos" em elementos não-semânticos (ex.: cabeçalho de um cartão), não para competir com os headings reais. Como ainda não tinha usado as classes antigas em nenhuma página, a correcção não partiu nada.

**Revisto e mantido como está, com justificação** (não é "deixar de lado" — é uma decisão informada, já verificada):
- **Type Scale para headings semânticos**: afinal já existia (ver correcção acima) — não era uma lacuna real, só não estava documentada como tal.
- **Metadata Typography** (`.p-loc`, `.p-store`): já são pequenas + cor apagada + sem negrito, ou seja já cumprem o requisito na prática; a classe `.meta` fica disponível para elementos novos, mas trocar a classe destes já-conformes por outra visualmente idêntica é um risco de regressão CSS sem benefício real — não fiz essa troca mecânica.
- **`Bazares.Stepper`/`Bazares.Progress`/`Bazares.ProgressToast` sem fluxo real ligado**: continuam sem uso porque, revistos os candidatos óbvios (`novoproduto.html`, `newreels.html`), nenhum é genuinamente multi-etapa independente de página nem "background, pode navegar" — forçar o encaixe seria decoração, não o padrão pedido. Ficam disponíveis prontos a usar assim que a app tiver um fluxo desses.
- **`btnSuccess` em `profile.html`/`settings.html`**: os `saveProfile()`/`changePw()` fecham o modal imediatamente a seguir ao sucesso, sem janela de tempo para mostrar um estado no botão — ligar aí implicaria atrasar o fecho do modal por artifício, uma mudança de comportamento maior do que o pedido original.
- **Faceted Filters mais ricos em `products.html`**: não tenho acesso ao código do backend neste repositório (só o frontend), por isso não sei que outros parâmetros de filtro a API `/products` aceita para além dos já usados (categoria/preço/condição/ordenação/distância). Acrescentar filtros especulativos (marca, método de entrega, etc.) sem saber se o backend os suporta arriscava enviar parâmetros ignorados silenciosamente — preferi não adivinhar. Se me disseres que a API suporta mais campos, ligo-os no mesmo padrão de chips já existente.

Com isto, a checklist externa completa (secções 6, 7, 8, Tipografia, 1️⃣1️⃣, 1️⃣2️⃣) está tratada — implementada onde fazia sentido, e onde não, com razão verificada e escrita, não deixada em branco.
