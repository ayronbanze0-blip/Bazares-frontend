/* ============================================================
   BAZARES — Notificações Push (Firebase Cloud Messaging)
   Complementa as notificações em tempo real via Socket.IO (que só
   funcionam com a app aberta): isto entrega a MESMA notificação como
   push nativo, mesmo com a app fechada ou em background.

   Carregamento preguiçoso: o SDK da Firebase (pesado) só é buscado
   quando o utilizador activa push pela primeira vez, ou quando já
   tinha activado antes (permissão 'granted') — nunca nas páginas onde
   nunca foi pedido.
============================================================ */
'use strict';

const PUSH_TOKEN_KEY = 'bazares_push_token';
const PUSH_REFRESH_AT_KEY = 'bazares_push_refreshed_at';

let _fcmMessaging = null;
let _fcmSdkLoading = null;
let _onMessageBound = false;

function _loadFirebaseSDK() {
  if (_fcmSdkLoading) return _fcmSdkLoading;
  _fcmSdkLoading = new Promise((resolve, reject) => {
    if (window.firebase?.messaging) { resolve(); return; }
    const s1 = document.createElement('script');
    s1.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js';
      s2.onload = resolve;
      s2.onerror = () => reject(new Error('Falha ao carregar o SDK da Firebase.'));
      document.head.appendChild(s2);
    };
    s1.onerror = () => reject(new Error('Falha ao carregar o SDK da Firebase.'));
    document.head.appendChild(s1);
  });
  return _fcmSdkLoading;
}

async function _getMessaging() {
  if (_fcmMessaging) return _fcmMessaging;
  if (!window.FIREBASE_CONFIG?.apiKey || window.FIREBASE_CONFIG.apiKey.startsWith('COLOCA_AQUI')) {
    throw new Error('Firebase ainda não está configurado (window.FIREBASE_CONFIG em js/config.js).');
  }
  await _loadFirebaseSDK();
  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
  _fcmMessaging = firebase.messaging();
  return _fcmMessaging;
}

async function _registerToken() {
  const messaging = await _getMessaging();
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: '/firebase-cloud-messaging-push-scope'
  });
  const token = await messaging.getToken({
    vapidKey: window.FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration
  });
  if (!token) throw new Error('Token FCM vazio.');

  const platform = (window.matchMedia?.('(display-mode: standalone)').matches) ? 'pwa' : 'web';
  await api.post('/notifications/device-token', { token, platform });
  localStorage.setItem(PUSH_TOKEN_KEY, token);
  localStorage.setItem(PUSH_REFRESH_AT_KEY, String(Date.now()));

  // Mensagens com a app aberta e em foco — o service worker só trata
  // das que chegam em background/fechada. _registerToken() pode ser
  // chamado mais que uma vez na mesma página (ex: refreshPushTokenIfGranted
  // no arranque + o utilizador a clicar "reativar" em settings.html);
  // sem esta guarda, cada chamada empilhava outro listener e cada push
  // em primeiro plano aparecia duplicado (2, 3... toasts para o mesmo push).
  if (!_onMessageBound) {
    _onMessageBound = true;
    messaging.onMessage((payload) => {
      // O backend envia só "data" (nunca "notification") — ver
      // comentário em src/services/pushService.js do backend.
      const title = payload.data?.title || 'Bazares';
      const body = payload.data?.body || '';
      toast(`<b>${esc(title)}</b>${body ? '<br>' + esc(body) : ''}`, 'info', 6000);
      if (typeof refreshNotifDot === 'function') refreshNotifDot();
    });
  }

  return token;
}

/** Pedido explícito — chamar a partir de um botão (ex: settings.html). */
async function requestPushPermission() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    toast('Este navegador não suporta notificações push.', 'warn');
    return false;
  }
  try {
    const perm = await Notification.requestPermission();
    if (window.Bazares?.State) Bazares.State.set('permission:notifications', perm);
    if (perm !== 'granted') {
      toast('Permissão de notificações não concedida.', 'warn');
      return false;
    }
    await _registerToken();
    toast('Notificações push activadas!', 'ok');
    return true;
  } catch (e) {
    toast(e?.message?.includes('não está configurado') ? e.message : 'Não foi possível activar as notificações push.', 'err');
    return false;
  }
}

/** Desactivar — remove o token do backend e limpa o estado local. */
async function disablePushNotifications(silent = false) {
  const token = localStorage.getItem(PUSH_TOKEN_KEY);
  try { if (token) await api.delete('/notifications/device-token', { token }); } catch { /* melhor esforço */ }
  localStorage.removeItem(PUSH_TOKEN_KEY);
  localStorage.removeItem(PUSH_REFRESH_AT_KEY);
  if (token && !silent) toast('Notificações push desactivadas.', 'info');
}

/** Estado actual — usado para desenhar o botão em settings.html. */
function isPushEnabled() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted' && !!localStorage.getItem(PUSH_TOKEN_KEY);
}

/**
 * Chamado em initPage() em TODAS as páginas — mas é essencialmente
 * grátis nas páginas onde o utilizador nunca activou push: só faz
 * alguma coisa se a permissão já tiver sido concedida antes, e no
 * máximo uma vez por dia (o token raramente muda; não vale a pena
 * pedir de novo a cada página).
 */
async function refreshPushTokenIfGranted() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const last = parseInt(localStorage.getItem(PUSH_REFRESH_AT_KEY) || '0', 10);
  if (Date.now() - last < 24 * 60 * 60 * 1000) return;
  try { await _registerToken(); } catch { /* silencioso — não é crítico */ }
}

/* ============================================================
   Banner automático — pede activação de notificações a quem entra
   na app pela 1ª vez (ou ainda não respondeu ao pedido).

   Regras:
   - Só aparece a utilizadores autenticados (o token exige login).
   - Só aparece se Notification.permission === 'default', ou seja,
     nunca perguntámos antes. Se o utilizador já recusou uma vez no
     diálogo nativo do navegador ('denied'), NUNCA mais voltamos a
     mostrar nada — o navegador nem deixaria reabrir o diálogo, e
     insistir por cima disso seria intrusivo.
   - Se o utilizador fechar o banner ("Agora não"), volta a aparecer
     só passados 3 dias — não a cada página.
   - Nunca aparece 2x ao mesmo tempo (ex: troca rápida de página).
============================================================ */
function _shouldShowPushPrompt() {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (Notification.permission !== 'default') return false;
  return true;
}

function maybePromptPushPermission() {
  if (document.getElementById('push-prompt')) return; // já visível
  if (!_shouldShowPushPrompt()) return;

  const el = document.createElement('div');
  el.id = 'push-prompt';
  el.className = 'push-prompt';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Ativar notificações');
  el.innerHTML = `
    <div class="push-prompt__icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    </div>
    <div class="push-prompt__body">
      <p class="push-prompt__title">Ativar notificações?</p>
      <p class="push-prompt__text">Sabe logo de novas mensagens, encomendas e ofertas — mesmo com a app fechada.</p>
    </div>
    <div class="push-prompt__actions">
      <button type="button" class="push-prompt__btn push-prompt__btn--ok">Ativar</button>
      <button type="button" class="push-prompt__btn push-prompt__btn--dismiss">Agora não</button>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector('.push-prompt__btn--ok').addEventListener('click', async () => {
    el.remove();
    await requestPushPermission();
  });
  el.querySelector('.push-prompt__btn--dismiss').addEventListener('click', () => {
    el.remove();
  });
}
