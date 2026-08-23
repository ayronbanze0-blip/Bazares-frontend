// ─── Cloudflare Pages Function ──────────────────────────────────────
// Rota: /bazar/:slug
// Mesmo princípio de /product/:slug: injecta título, descrição, Open
// Graph, Twitter Card e Schema.org (LocalBusiness) no bazar.html
// estático, para que cada loja seja indexável e partilhável com uma
// pré-visualização própria (não genérica).

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

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const slug = params.slug;
  const pageUrl = new URL(request.url);

  const assetUrl = new URL('/bazar.html', pageUrl.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  let html = await assetResponse.text();

  let bazar = null;
  try {
    const apiRes = await fetch(`${API_BASE}/api/bazars/${encodeURIComponent(slug)}`);
    if (apiRes.ok) {
      const json = await apiRes.json();
      bazar = json?.data?.bazar || null;
    }
  } catch (err) {
    // Ignora — cai para o shell genérico, o app.js tenta de novo no cliente.
  }

  if (!bazar) {
    const fallbackCanonical = `${pageUrl.origin}/bazar/${encodeURIComponent(slug)}`;
    html = html
      .replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${esc(fallbackCanonical)}">`)
      .replace(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${esc(fallbackCanonical)}">`);
    // Content-Length/ETag da resposta original já não batem certo com o
    // HTML modificado — herdá-los corta a resposta no byte errado (tela
    // branca). Remove os dois e deixa o runtime recalcular sozinho.
    const fbHeaders = new Headers(assetResponse.headers);
    fbHeaders.delete('content-length');
    fbHeaders.delete('etag');
    return new Response(html, { status: assetResponse.status, headers: fbHeaders });
  }

  // Mesmo formato usado no lado do cliente depois de hidratar (ver
  // window.BZSEO.setStore em js/seo.js) — evita o título "saltar" entre
  // o que o crawler vê (SSR) e o que o utilizador vê a seguir.
  const title = `${bazar.name} 🛍️ — Bazares`;
  const description = truncate(
    bazar.description || `${bazar.name}: loja no Bazares, em ${bazar.location || 'Moçambique'}.`,
    155
  );
  const image = bazar.bannerUrl || bazar.logoUrl || `${pageUrl.origin}/icons/icon-512.png`;
  const canonical = `${pageUrl.origin}/bazar/${encodeURIComponent(bazar.slug || slug)}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: bazar.name,
    description: bazar.description,
    image,
    url: canonical,
    ...(bazar.location ? { address: { '@type': 'PostalAddress', addressLocality: bazar.location, addressCountry: 'MZ' } } : {}),
    ...(bazar.phone ? { telephone: bazar.phone } : {})
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
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<script>window.BAZARES_BAZAR_ID=${JSON.stringify(bazar.slug || bazar.id)};</script>
`;

  html = html.replace(/<title>.*?<\/title>/i, '').replace('</head>', `${injected}</head>`);

  const okHeaders = new Headers(assetResponse.headers);
  okHeaders.delete('content-length');
  okHeaders.delete('etag');
  okHeaders.set('Content-Type', 'text/html;charset=UTF-8');
  return new Response(html, {
    status: 200,
    headers: okHeaders
  });
}
