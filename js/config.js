/* ============================================================
   BAZARES — Configuração da ligação ao backend
   Altere BAZARES_API_BASE se o seu backend correr noutro endereço.
   Por defeito assume http://localhost:3001 (porta padrão do backend).
============================================================ */
window.BAZARES_API_BASE = 'https://bazare-s.onrender.com';

/* ============================================================
   Login social — coloca aqui os IDs que obténs em cada consola.
   Nenhum destes é secreto (são todos públicos, usados no browser);
   os segredos verdadeiros ficam só no backend, como variável de ambiente.
============================================================ */
// Google Cloud Console → Credentials → OAuth 2.0 Client ID (tipo "Web application")
window.GOOGLE_CLIENT_ID = '257105551733-kl1pl1edi31alqhuhlk6lrulgq8gf3n8.apps.googleusercontent.com';

// Facebook Developers → Your App → App ID (painel principal da app)
window.FACEBOOK_APP_ID = '4431413040511436';

// Apple Developer → Certificates, Identifiers & Profiles → Service ID
window.APPLE_CLIENT_ID = '';        // ex: 'com.bazares.web' — só depois de teres a Apple Developer Program

/* ============================================================
   Notificações push (Firebase Cloud Messaging) — para Web Push.
   Firebase Console → Definições do projecto → Geral → "As tuas apps"
   → app Web → Configuração do SDK. Nenhum destes valores é secreto
   (são todos públicos, usados no browser); o segredo verdadeiro
   (a chave privada da conta de serviço) fica só no backend.

   IMPORTANTE: estes MESMOS valores têm de ser copiados também para
   firebase-messaging-sw.js (o service worker não consegue ler
   window.FIREBASE_CONFIG — corre à parte, sem acesso a `window`).
============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAnUCz7BG2ixTWrbWHjAyiE191DcgRgmiI',
  authDomain: 'bazares-f1de9.firebaseapp.com',
  projectId: 'bazares-f1de9',
  storageBucket: 'bazares-f1de9.firebasestorage.app',
  messagingSenderId: '136198066692',
  appId: '1:136198066692:web:48ceabcb36395d0d565b51'
};

/* ============================================================
   Mapas — checkout (morada com pin), página do bazar (localização
   da banca) e "perto de mim". Usa MapLibre GL + OpenFreeMap (tiles)
   + Nominatim (moradas) — tudo gratuito, sem chave de API e sem
   cartão de crédito associado. Ver js/maps.js.

   Opcional: identifica a app nos pedidos ao Nominatim (boa prática
   da política de uso deles, não é obrigatório).
============================================================ */
window.NOMINATIM_CONTACT_EMAIL = ''; // ex: 'suporte@bazares.co.mz'

// Firebase Console → Definições do projecto → Cloud Messaging →
// "Certificados push da Web" → gerar par de chaves (chave VAPID).
window.FIREBASE_VAPID_KEY = 'BB6XsbrriV_7a1_7OyPwbqMeTzvEbBHh7_jOPmNkOFAtF-HwdhlZozKqW8HoIB8fH_49nrQbdr1URYfVJSa3W5c';


/* ============================================================
   Sentry (rastreamento de erros no browser) — opcional.
   sentry.io → New Project (Browser JavaScript) → copia o DSN daqui.
   Com o campo vazio, nada é carregado — zero impacto.
============================================================ */
window.SENTRY_DSN = 'https://8b162bd61407b497da6d19827cdf1a84@o4511794985566208.ingest.us.sentry.io/4511794990481408';

if (window.SENTRY_DSN) {
  const sentryScript = document.createElement('script');
  sentryScript.src = 'https://browser.sentry-cdn.com/8.45.0/bundle.min.js';
  sentryScript.crossOrigin = 'anonymous';
  sentryScript.onload = () => {
    window.Sentry.init({
      dsn: window.SENTRY_DSN,
      environment: location.hostname === 'localhost' ? 'development' : 'production',
      tracesSampleRate: 0.1
    });

    // Teste manual: abre qualquer página do site com ?sentry-test=1
    // no final do endereço (ex: bazares.pages.dev/index.html?sentry-test=1)
    // para disparar um erro de propósito e confirmar que aparece no
    // Sentry. Não faz nada em uso normal — só ativa com esse parâmetro.
    if (new URLSearchParams(location.search).get('sentry-test') === '1') {
      window.Sentry.captureException(new Error('Bazares — teste manual do Sentry (frontend)'));
      alert('Erro de teste enviado para o Sentry. Verifica a dashboard dentro de 1 minuto.');
    }
  };
  document.head.appendChild(sentryScript);
}

/* Regista o Service Worker — necessário para o site ser instalável como PWA
   e para depois ser empacotado como app Android (TWA) para a Play Store. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Falha ao registar o service worker:', err);
    });
  });
}

/* ============================================================
   Rede de segurança para a app instalada (standalone/PWA).
   Se algum erro não tratado acontecer — ex: uma versão antiga em cache
   do JS a chamar uma função que só existe numa versão mais nova do
   HTML, depois de um deploy — em vez de a app simplesmente fechar sem
   explicação (o que parece avariada/suspeita), mostra um aviso simples
   com um botão para limpar a cache e recarregar. Só na app instalada:
   num separador normal do navegador, um F5 já resolve isto sozinho.
============================================================ */
(function () {
  const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  if (!isStandalone) return;

  let shown = false;
  function showRecovery() {
    if (shown || document.getElementById('bz-recovery')) return;
    shown = true;
    const el = document.createElement('div');
    el.id = 'bz-recovery';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#18181B;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;font-family:sans-serif';
    el.innerHTML = '<div style="font-size:15px;font-weight:600">Algo correu mal a carregar a app.</div>' +
      '<div style="font-size:13px;color:#A1A1AA;max-width:280px">Isto costuma resolver-se limpando os dados guardados desta versão.</div>' +
      '<button id="bz-recovery-btn" style="background:#00B837;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer">Recarregar app</button>';
    document.body.appendChild(el);
    document.getElementById('bz-recovery-btn').addEventListener('click', async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) { /* melhor esforço */ }
      location.reload();
    });
  }

  window.addEventListener('error', showRecovery);
  window.addEventListener('unhandledrejection', showRecovery);
})();

/* Pede armazenamento persistente ao navegador — sem isto, o cache do
   Service Worker pode ser apagado automaticamente se o dispositivo
   ficar com pouco espaço, mesmo sem o utilizador desinstalar nada.
   Com persistência concedida, o cache da app fica protegido dessa
   limpeza automática (a concessão depende de critérios do navegador,
   ex: app instalada e usada com alguma frequência — não é garantida
   de imediato, mas não faz mal pedir sempre).*/
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
