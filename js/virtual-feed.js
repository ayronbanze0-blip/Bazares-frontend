/* ============================================================
   BAZARES — Virtual Feed (windowing de DOM)
   ------------------------------------------------------------
   Scroll infinito só ADICIONA elementos — num feed longo (100+
   publicações), o browser acaba com milhares de nós DOM vivos ao
   mesmo tempo (imagens, listeners, animações), o que trava o
   scroll e consome memória, sobretudo em telemóveis mais fracos.

   Isto não é uma reescrita para uma lib de virtual scroll (React-
   window, etc.) — os cartões daqui são HTML gerado por template
   string com handlers onclick inline, não componentes. Em vez
   disso, faz "windowing" simples e seguro:

     - cartões que ficaram muito acima do scroll actual (fora da
       janela de "margem de segurança") são substituídos por um
       marcador (placeholder) da MESMA altura — a barra de scroll
       não salta, o layout não muda;
     - o HTML original de cada cartão fica guardado em memória;
     - se o utilizador voltar a subir até perto do marcador, o
       cartão original é reposto tal e qual (mesmos handlers,
       mesmo estado) — um <video> que estivesse a meio também
       reinicia, é o único efeito secundário aceite aqui.

   Uso (ver home.html):
     VirtualFeed.attach(containerEl, { itemSelector: '.feed-card' })
     VirtualFeed.prune(containerEl)   // chamar depois de cada loadFeed()

   Carregar DEPOIS de core.js.
============================================================ */
'use strict';

window.VirtualFeed = (() => {
  const registry = new WeakMap(); // container -> { itemSelector, cache: Map<id, html>, restoreObserver }

  function attach(container, { itemSelector = '.feed-card' } = {}) {
    if (!container || registry.has(container)) return;
    const state = { itemSelector, cache: new Map() };
    state.restoreObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const ph = entry.target;
        restore(container, state, ph);
      });
    }, { root: null, rootMargin: '400px 0px' });
    registry.set(container, state);
  }

  function restore(container, state, placeholder) {
    const id = placeholder.dataset.vfId;
    const html = state.cache.get(id);
    if (!html) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const original = tmp.firstElementChild;
    placeholder.replaceWith(original);
    state.restoreObserver.unobserve(placeholder);
    state.cache.delete(id);
  }

  // Chamar depois de inserir novos itens no feed (ex.: no fim de
  // loadFeed()). `keepScreens` = quantas alturas de ecrã manter montadas
  // acima do que está visível — margem generosa para não podar algo que
  // o utilizador ainda pode ver ao dar scroll rápido para cima.
  function prune(container, { keepScreens = 4 } = {}) {
    const state = registry.get(container);
    if (!state) return;
    const items = container.querySelectorAll(`${state.itemSelector}:not([data-vf-placeholder])`);
    if (items.length < 20) return; // feeds curtos não precisam de poda — não vale o custo
    const viewTop = window.scrollY || document.documentElement.scrollTop;
    const cutoff = viewTop - window.innerHeight * keepScreens;
    if (cutoff <= 0) return; // ainda perto do topo — nada a podar

    items.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const elBottomAbs = rect.bottom + viewTop;
      if (elBottomAbs >= cutoff) return; // ainda dentro da janela a manter

      const id = el.id || ('vf-' + Math.random().toString(36).slice(2));
      const height = el.offsetHeight;
      state.cache.set(id, el.outerHTML);

      const placeholder = document.createElement('div');
      placeholder.dataset.vfPlaceholder = '1';
      placeholder.dataset.vfId = id;
      placeholder.style.height = height + 'px';
      placeholder.className = el.className; // mantém margens/espaçamento do card real

      el.replaceWith(placeholder);
      state.restoreObserver.observe(placeholder);
    });
  }

  // Chamar quando a lista é limpa por completo (ex.: recomeçar do zero
  // ao trocar de separador do feed) — evita ficar com marcadores
  // "fantasma" em cache que já não têm placeholder nenhum no DOM.
  function reset(container) {
    const state = registry.get(container);
    if (!state) return;
    state.cache.clear();
    state.restoreObserver.disconnect();
  }

  return { attach, prune, reset };
})();
