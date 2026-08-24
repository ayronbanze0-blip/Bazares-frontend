/* ============================================================
   BAZARES — SEO dinâmico
   Actualiza <title>, meta description, canonical, Open Graph,
   Twitter Card e JSON-LD (Product/Store) depois dos dados reais
   chegarem da API — usado em product.html/bazar.html (e noutras
   páginas que precisem de reflectir conteúdo carregado por JS).

   IMPORTANTE — mudança de domínio: quando o site mudar de domínio
   (ex: bazares.pages.dev → um .com próprio), muda só a constante
   SITE abaixo. Diz ao Claude o novo domínio numa conversa e ele
   actualiza também sitemap.xml, robots.txt e o resto das páginas
   de uma vez (fazem todos referência ao mesmo valor literal).
============================================================ */
window.BZSEO = (function () {
  const SITE = 'https://bazares.pages.dev';

  function setTag(selector, attr, value) {
    if (!value) return;
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  }

  // Actualiza título + description + canonical + OG + Twitter de uma vez.
  function setMeta({ title, description, image, url, type }) {
    if (title) document.title = title;
    setTag('meta[name="description"]', 'content', description);
    setTag('link[rel="canonical"]', 'href', url);
    setTag('meta[property="og:title"]', 'content', title);
    setTag('meta[property="og:description"]', 'content', description);
    setTag('meta[property="og:url"]', 'content', url);
    setTag('meta[property="og:type"]', 'content', type);
    setTag('meta[property="og:image"]', 'content', image);
    setTag('meta[name="twitter:title"]', 'content', title);
    setTag('meta[name="twitter:description"]', 'content', description);
    setTag('meta[name="twitter:image"]', 'content', image);
  }

  // Cria/actualiza um <script type="application/ld+json"> pelo id.
  function setJsonLd(id, data) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }

  function clearJsonLd(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // Remove qualquer JSON-LD dinâmico (produto/loja) — chamado pelo
  // spa-router antes de trocar de página, para a página seguinte
  // nunca herdar dados da anterior por engano.
  function clearDynamicJsonLd() {
    clearJsonLd('dynamic-product-jsonld');
    clearJsonLd('dynamic-store-jsonld');
  }

  function truncate(text, max) {
    if (!text) return '';
    text = String(text).trim();
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  }

  // Chamado por product.html assim que `_product` chega da API.
  function setProduct(p) {
    if (!p) return;
    // URL amigável (/product/nome-do-produto) — mesma rota servida no lado
    // do servidor por functions/product/[slug].js para SSR a crawlers/partilhas.
    const url = `${SITE}/product/${encodeURIComponent(p.slug || p.id)}`;
    const img = (p.images && p.images[0] && p.images[0].url) || `${SITE}/icons/icon-512.png`;
    const title = `${p.name} — Bazares`;
    const description = truncate(
      p.description || `Compra "${p.name}" no Bazares por ${p.price} MT. Pagamento seguro via M-Pesa ou e-Mola.`,
      160
    );
    setMeta({ title, description, image: img, url, type: 'product' });
    setJsonLd('dynamic-product-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      image: (p.images || []).map((i) => i.url),
      description: p.description || description,
      sku: p.id,
      category: p.category || undefined,
      offers: {
        '@type': 'Offer',
        priceCurrency: 'MZN',
        price: p.price,
        availability:
          p.stock === 0 ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
        url
      },
      ...(p.ratingCount
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: p.rating,
              reviewCount: p.ratingCount
            }
          }
        : {})
    });
  }

  // Chamado por bazar.html assim que a loja chega da API.
  function setStore(b) {
    if (!b) return;
    const s = b.seller || {};
    // URL amigável (/bazar/nome-da-loja) — mesma rota servida no lado do
    // servidor por functions/bazar/[slug].js para SSR a crawlers/partilhas.
    const url = `${SITE}/bazar/${encodeURIComponent(b.slug || b.id)}`;
    const img = b.logo || s.avatar || `${SITE}/icons/icon-512.png`;
    const title = `${b.name} 🛍️ — Bazares`;
    const description = truncate(
      `${b.name} no Bazares` +
        (b.category ? ` · ${b.category}` : '') +
        (b.location ? ` · ${b.location}` : '') +
        '. Compra com segurança via M-Pesa ou e-Mola.',
      160
    );
    setMeta({ title, description, image: img, url, type: 'profile' });
    setJsonLd('dynamic-store-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'Store',
      name: b.name,
      image: img,
      url,
      ...(b.location
        ? { address: { '@type': 'PostalAddress', addressLocality: b.location, addressCountry: 'MZ' } }
        : {}),
      ...(s.ratingCount
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: s.rating,
              reviewCount: s.ratingCount
            }
          }
        : {})
    });
  }

  return { SITE, setMeta, setJsonLd, clearJsonLd, clearDynamicJsonLd, setProduct, setStore };
})();
