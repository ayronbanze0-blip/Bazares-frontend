/* ============================================================
   BAZARES — Mapas (grátis, sem chave nem cartão)
   Stack: MapLibre GL (motor do mapa) + OpenFreeMap (tiles, uso
   ilimitado, sem registo) + Nominatim (geocoding/autocomplete de
   moradas, dados OpenStreetMap). Nenhuma destas peças exige API key.

   Usado em: checkout.html (morada com pin), my-bazar.html
   (localização da banca), bazar.html (mostrar localização),
   products.html ("perto de mim" — só usa getBrowserLocation).

   Nota sobre o Nominatim: o serviço público é gratuito mas partilhado
   por toda a comunidade OSM — por isso pedimos com um atraso (debounce)
   generoso e nunca mais de ~1 pedido/seg. Se um dia o volume do
   Bazares justificar, dá para trocar por um Nominatim próprio ou por
   um provedor pago sem tocar no resto do código (as funções abaixo
   são a única fronteira).
   Contacto opcional: define window.NOMINATIM_CONTACT_EMAIL em
   config.js para identificar a app nos pedidos (boa prática do
   Nominatim, não é obrigatório).
============================================================ */
'use strict';

const MAPS_DEFAULT_CENTER = { lat: -25.9692, lng: 32.5732 }; // Maputo

const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

let _maplibrePromise = null;

// Carrega o MapLibre GL (JS + CSS) uma única vez, mesmo que várias
// páginas/funções chamem isto em simultâneo. Se o CDN estiver lento
// ou bloqueado (ex: rede móvel restritiva), desiste ao fim de 8s em
// vez de ficar pendurado para sempre — quem chamar isto cai no
// fallback (sem mapa, localização continua a funcionar em texto).
function loadMapLibre() {
  if (_maplibrePromise) return _maplibrePromise;
  _maplibrePromise = new Promise((resolve, reject) => {
    if (window.maplibregl) { resolve(window.maplibregl); return; }
    if (!document.querySelector('link[data-maplibre-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPLIBRE_CSS;
      link.setAttribute('data-maplibre-css', '1');
      document.head.appendChild(link);
    }
    const timeoutId = setTimeout(() => reject(new Error('Tempo esgotado a carregar o motor do mapa.')), 8000);
    const s = document.createElement('script');
    s.src = MAPLIBRE_JS;
    s.async = true;
    s.onload = () => { clearTimeout(timeoutId); resolve(window.maplibregl); };
    s.onerror = () => { clearTimeout(timeoutId); reject(new Error('Falha ao carregar o motor do mapa.')); };
    document.head.appendChild(s);
  }).catch(err => { _maplibrePromise = null; throw err; }); // permite tentar de novo mais tarde (ex: noutra página)
  return _maplibrePromise;
}

// Liga autocomplete de moradas (Nominatim) a um <input>. onPlace(place)
// é chamado quando a pessoa escolhe uma sugestão, com { lat, lng, formatted }.
// opts.country: código de país ISO2 minúsculo (ex: 'mz') para restringir.
function attachPlacesAutocomplete(inputEl, onPlace, opts = {}) {
  const wrapper = inputEl.parentElement;
  if (wrapper && getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';

  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'position:absolute;left:0;right:0;z-index:50;background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:10px;margin-top:4px;max-height:220px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.14);display:none';
  inputEl.insertAdjacentElement('afterend', dropdown);

  let results = [];
  let controller = null;

  function hide() { dropdown.style.display = 'none'; }

  function render() {
    if (!results.length) { hide(); return; }
    dropdown.innerHTML = results.map((r, i) =>
      `<div data-i="${i}" style="padding:10px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid rgba(0,0,0,.06)">${esc(r.display_name)}</div>`
    ).join('');
    dropdown.style.display = 'block';
    [...dropdown.children].forEach(el => {
      el.addEventListener('click', () => {
        const r = results[+el.dataset.i];
        inputEl.value = r.display_name;
        hide();
        onPlace({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), formatted: r.display_name });
      });
    });
  }

  async function search(q) {
    if (controller) controller.abort();
    controller = new AbortController();
    try {
      const params = new URLSearchParams({ format: 'json', q, addressdetails: '1', limit: '5' });
      if (opts.country) params.set('countrycodes', opts.country);
      if (window.NOMINATIM_CONTACT_EMAIL) params.set('email', window.NOMINATIM_CONTACT_EMAIL);
      const res = await fetch(`${NOMINATIM_BASE}/search?${params.toString()}`, {
        signal: controller.signal,
        headers: { 'Accept-Language': 'pt' }
      });
      results = await res.json();
      render();
    } catch (e) {
      // Pedido abortado (nova letra digitada) ou rede em baixo — silencioso,
      // o campo de texto continua a funcionar normalmente.
    }
  }

  const debouncedSearch = Bazares.Utils.debounce(search, 550);

  inputEl.addEventListener('input', () => {
    debouncedSearch.cancel();
    const q = inputEl.value.trim();
    if (q.length < 3) { hide(); return; }
    debouncedSearch(q); // respeita o limite de ~1 pedido/seg do Nominatim
  });
  document.addEventListener('click', (e) => {
    if (e.target !== inputEl && !dropdown.contains(e.target)) hide();
  });

  return { destroy() { dropdown.remove(); } };
}

// Cria um mapa pequeno com um pin, opcionalmente arrastável.
// Devolve { map, marker, setPosition(lat,lng), onDragEnd(cb) }.
// (mantém lat/lng como ordem externa; o MapLibre por baixo usa [lng,lat])
async function createPinMap(containerEl, { lat, lng, draggable = false, zoom = 15 } = {}) {
  const maplibregl = await loadMapLibre();
  const center = (lat != null && lng != null) ? { lat, lng } : MAPS_DEFAULT_CENTER;
  const map = new maplibregl.Map({
    container: containerEl,
    style: OPENFREEMAP_STYLE,
    center: [center.lng, center.lat],
    zoom,
    attributionControl: true
  });
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  const marker = new maplibregl.Marker({ draggable, color: '#12A02A' })
    .setLngLat([center.lng, center.lat])
    .addTo(map);

  let dragCb = null;
  if (draggable) marker.on('dragend', () => {
    const p = marker.getLngLat();
    if (dragCb) dragCb({ lat: p.lat, lng: p.lng });
  });

  return {
    map, marker,
    setPosition(la, ln) { marker.setLngLat([ln, la]); map.panTo([ln, la]); },
    onDragEnd(cb) { dragCb = cb; }
  };
}

// Pede a posição actual do browser. Devolve {lat,lng} ou rejeita.
// Em telemóvel, GPS de alta precisão às vezes demora mais do que os
// 10s iniciais (sinal fraco, dentro de casa/loja) — se isso acontecer,
// tenta outra vez com precisão mais baixa (usa rede/wifi) antes de
// desistir, em vez de falhar logo à primeira.
function getBrowserLocation() {
  if (!navigator.geolocation) return Promise.reject(new Error('unsupported'));
  const attempt = (opts) => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => { if (window.Bazares?.State) Bazares.State.set('permission:geolocation', 'granted'); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      err => { if (window.Bazares?.State && err?.code === 1) Bazares.State.set('permission:geolocation', 'denied'); reject(err); },
      opts
    );
  });
  return attempt({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
    .catch(err => {
      // PERMISSION_DENIED (1) não vale a pena tentar outra vez — o
      // utilizador tem de autorizar primeiro. TIMEOUT (3) ou
      // POSITION_UNAVAILABLE (2) sim, com menos exigência de precisão.
      if (err && err.code === 1) throw err;
      return attempt({ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
    });
}

// Traduz o erro de geolocalização numa mensagem útil e accionável,
// em vez do genérico "não foi possível". Usada em todos os sítios
// que têm um botão "Usar a minha localização".
function describeGeoError(err) {
  if (err && err.message === 'unsupported') return 'Este navegador não suporta localização automática. Escreve a morada ou arrasta o pin no mapa.';
  switch (err?.code) {
    case 1: // PERMISSION_DENIED
      return 'Permissão de localização recusada. Activa a localização para este site nas definições do navegador e tenta novamente.';
    case 2: // POSITION_UNAVAILABLE
      return 'Não foi possível determinar a tua posição agora. Verifica se o GPS/localização do telemóvel está ligado.';
    case 3: // TIMEOUT
      return 'A localização demorou demasiado a responder. Tenta de novo num sítio com melhor sinal, ou arrasta o pin no mapa.';
    default:
      return 'Não foi possível obter a tua localização. Podes arrastar o pin no mapa.';
  }
}
