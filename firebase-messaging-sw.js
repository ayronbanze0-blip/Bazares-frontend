/* Bazares — Firebase Cloud Messaging Service Worker
   Tem de viver na RAIZ do site (não em /js/) — é uma exigência da
   Firebase, o escopo do service worker de push é sempre a pasta onde
   o ficheiro está. Separado do sw.js principal (cache da PWA) de
   propósito: registamos os dois em paralelo, cada um com a sua
   responsabilidade, para uma falha num não arrastar o outro. */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

/* Os mesmos valores públicos de js/config.js (window.FIREBASE_CONFIG).
   Um service worker não tem acesso a `window`, por isso os valores
   têm de estar duplicados aqui — não são segredo (são todos públicos,
   tal como o Google/Facebook client ID já usados no config.js). */
firebase.initializeApp({
  apiKey: 'AIzaSyAnUCz7BG2ixTWrbWHjAyiE191DcgRgmiI',
  authDomain: 'bazares-f1de9.firebaseapp.com',
  projectId: 'bazares-f1de9',
  storageBucket: 'bazares-f1de9.firebasestorage.app',
  messagingSenderId: '136198066692',
  appId: '1:136198066692:web:48ceabcb36395d0d565b51'
});

const messaging = firebase.messaging();

// Mostra a notificação nativa quando chega push com a app fechada ou
// numa aba diferente (mensagens em primeiro plano são tratadas à parte
// em js/push-notifications.js, via onMessage).
messaging.onBackgroundMessage((payload) => {
  // O backend envia só "data" (nunca "notification") precisamente para
  // que só este handler mostre a notificação — uma única vez. Ver
  // comentário em src/services/pushService.js do backend.
  const title = payload.data?.title || 'Bazares';
  const body = payload.data?.body || '';
  const icon = payload.data?.icon || '/icons/icon-192.png';
  const link = payload.data?.link || '/dashboard.html';

  self.registration.showNotification(title, {
    body,
    icon,
    badge: '/icons/icon-192.png',
    data: { link }
  });
});

// Ao tocar na notificação, abre (ou foca) a página relevante.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/dashboard.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(link) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(link);
    })
  );
});
