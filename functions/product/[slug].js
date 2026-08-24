// ─── Cloudflare Pages Function ──────────────────────────────────────
// Rota: /product/:slug
//
// O site é uma SPA (product.html carrega os dados via JS depois de a
// página abrir), o que significa que, sem isto, o Google e as pré-
// visualizações do WhatsApp/Facebook só veem um <title> genérico e
// nenhuma descrição — o produto praticamente não é indexável nem
// partilhável.
//
// Esta função corre no servidor (antes de chegar ao browser): busca os
// dados do produto na API, pega no product.html estático e injecta
// <title>, meta description, Open Graph, Twitter Card e JSON-LD
// (Schema.org Product) no <head>. O resto da página continua igual —
// o JS da app (app.js) assume o controlo normalmente a partir daí.
//
// Não precisa de nenhuma configuração extra: o Cloudflare Pages
// detecta ficheiros dentro de /functions automaticamente no deploy.

const API_BASE = 'https://bazare-s.onrender.com';

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

// JSON.stringify() não escapa a sequência "</" — se qualquer campo do
// produto (nome, descrição, etc.) contiver essa sequência em qualquer
// sítio do texto, o browser lê-a como o fecho da tag <script> a meio,
// partindo todo o HTML que vem a seguir (body, scripts, tudo). Isto
// serializa para dentro de <script>, por isso passa sempre por aqui.
function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const slug = params.slug;
  const pageUrl = new URL(request.url);

  // Busca o HTML estático original de product.html (o "shell" da SPA).
  // Importante: passamos só o URL, NUNCA o `request` original — se
  // clonássemos os headers do pedido do browser (ex: If-None-Match de uma
  // visita anterior), o Cloudflare podia responder aqui dentro com um 304
  // Not Modified, que não tem corpo nenhum, deixando toda a página vazia
  // mesmo antes de mexermos em qualquer header de saída.
  const assetUrl = new URL('/product.html', pageUrl.origin);
  const assetResponse = await env.ASSETS.fetch(assetUrl);
  let html = await assetResponse.text();

  // Rede de segurança: se por algum motivo o shell estático vier vazio ou
  // sem </head> (ex: falha momentânea a buscar o asset), nunca queremos
  // servir uma página em branco silenciosa — melhor devolver o shell
  // estático tal como está e deixar o app.js do lado do cliente tratar
  // disto normalmente, do que arriscar um HTML corrompido.
  if (!html || !html.includes('</head>')) {
    return env.ASSETS.fetch(assetUrl);
  }

  let product = null;
  try {
    const apiRes = await fetch(`${API_BASE}/api/products/${encodeURIComponent(slug)}`);
    if (apiRes.ok) {
      const json = await apiRes.json();
      product = json?.data?.product || null;
    }
  } catch (err) {
    // Falha na API não deve impedir a página de carregar — cai para o
    // shell genérico e o app.js do lado do cliente tenta de novo.
  }

  if (!product) {
    // A API falhou ou o produto não existe (já foi removido, slug errado,
    // etc.) — mesmo assim não faz sentido devolver o shell com o
    // canonical/OG genérico do ficheiro estático (aponta para
    // "/product.html" sem mais nada, que nem sequer é um URL real desta
    // rota). Troca só o canonical/og:url pelo URL específico que foi
    // pedido (mesmo domínio da própria requisição — nunca hardcoded) —
    // title/description ficam genéricos mesmo, não há dados para os
    // preencher, mas pelo menos o Google nunca vê dois produtos
    // diferentes a apontar "canonical" para o mesmo URL genérico.
    const fallbackCanonical = `${pageUrl.origin}/product/${encodeURIComponent(slug)}`;
    html = html
      .replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${esc(fallbackCanonical)}">`)
      .replace(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${esc(fallbackCanonical)}">`);
    // Construímos os headers de raiz (em vez de herdar do ficheiro
    // estático) — mais simples e evita qualquer header escondido que não
    // faça sentido para uma resposta gerada dinamicamente (Content-Length,
    // ETag e Content-Encoding do ficheiro original não se aplicam a este
    // corpo, que é outro).
    return new Response(html, {
      status: assetResponse.status,
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=0, must-revalidate'
      }
    });
  }

  const title = `${product.name} — ${product.bazar?.name || 'Bazares'}`;
  const description = truncate(
    product.description || `${product.name} por ${product.price} MT em Bazares Moçambique.`,
    155
  );
  const image = product.images?.[0]?.url || `${pageUrl.origin}/icons/icon-512.png`;
  const canonical = `${pageUrl.origin}/product/${encodeURIComponent(product.slug || slug)}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: (product.images || []).map((i) => i.url),
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'MZN',
      availability: product.stock > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url: canonical
    },
    ...(product.rating
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.rating,
            reviewCount: product.ratingCount || 1
          }
        }
      : {})
  };

  const injected = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:site_name" content="Bazares">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="product:price:amount" content="${esc(product.price)}">
<meta property="product:price:currency" content="MZN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<script type="application/ld+json">${safeJsonForScript(jsonLd)}</script>
<script>window.BAZARES_PRODUCT_ID=${safeJsonForScript(product.slug || product.id)};</script>
`;

  // Substitui o <title> genérico do shell e injecta tudo antes de </head>.
  html = html
    .replace(/<title>.*?<\/title>/i, '')
    .replace('</head>', `${injected}</head>`);

  // Headers construídos de raiz — ver comentário equivalente no ramo
  // acima sobre porque não herdamos os do ficheiro estático.
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=0, must-revalidate'
    }
  });
}

