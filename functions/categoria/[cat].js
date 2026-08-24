// ─── Cloudflare Pages Function ──────────────────────────────────────
// Rota: /categoria/:cat  (ex: /categoria/Imóveis, /categoria/Veículos)
//
// Hoje uma categoria só existe como filtro (?category=X) dentro de
// products.html — o que não dá título nem descrição próprios a cada
// categoria, então o Google nunca vai posicionar "casas para alugar em
// Maputo" ou "carros usados Moçambique" como página específica.
//
// Esta função dá a cada categoria um URL e meta tags próprios, com uma
// lista de produtos (Schema.org ItemList) para o Google mostrar
// resultados ricos, mantendo o :cat como o nome exacto da categoria
// (o mesmo texto usado em Product.category no backend).

const API_BASE = 'https://bazare-s.onrender.com';

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Ver comentário equivalente em functions/product/[slug].js — mesmo
// risco de "</" partir a tag <script> a meio.
function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const category = decodeURIComponent(params.cat);
  const pageUrl = new URL(request.url);

  // Ver comentário equivalente em functions/product/[slug].js: nunca
  // passar o `request` original para env.ASSETS.fetch.
  const assetUrl = new URL('/products.html', pageUrl.origin);
  const assetResponse = await env.ASSETS.fetch(assetUrl);
  let html = await assetResponse.text();

  if (!html || !html.includes('</head>')) {
    return env.ASSETS.fetch(assetUrl);
  }

  let products = [];
  let total = 0;
  try {
    const apiRes = await fetch(
      `${API_BASE}/api/products?category=${encodeURIComponent(category)}&limit=20&sort=new`
    );
    if (apiRes.ok) {
      const json = await apiRes.json();
      products = json?.data?.products || [];
      total = json?.data?.meta?.total || products.length;
    }
  } catch (err) {
    // Ignora — o app.js do lado do cliente carrega a listagem normalmente.
  }

  const title = `${category} em Moçambique — anúncios no Bazares`;
  const description = `${total ? `${total} anúncios` : 'Anúncios'} de ${category} em Moçambique. Compra e vende ${category.toLowerCase()} com segurança no Bazares.`;
  const image = products[0]?.images?.[0]?.url || `${pageUrl.origin}/icons/icon-512.png`;
  const canonical = `${pageUrl.origin}/categoria/${encodeURIComponent(category)}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${category} — Bazares`,
    itemListElement: products.slice(0, 20).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${pageUrl.origin}/product/${encodeURIComponent(p.slug || p.id)}`,
      name: p.name
    }))
  };

  const injected = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:site_name" content="Bazares">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<script type="application/ld+json">${safeJsonForScript(jsonLd)}</script>
<script>window.BAZARES_CATEGORY=${safeJsonForScript(category)};</script>
`;

  html = html.replace(/<title>.*?<\/title>/i, '').replace('</head>', `${injected}</head>`);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=0, must-revalidate'
    }
  });
}
