const NOM_CACHE = 'gestiga-v1';
const FICHIERS = ['./', './index.html', './style.css', './app.js', './config.js', './manifest.json', './icone.svg', './icone-192.png', './icone-512.png'];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(caches.open(NOM_CACHE).then((cache) => cache.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(caches.keys().then((noms) => Promise.all(noms.filter((nom) => nom !== NOM_CACHE).map((nom) => caches.delete(nom)))));
  self.clients.claim();
});

self.addEventListener('fetch', (evenement) => {
  const adresse = new URL(evenement.request.url);
  if (evenement.request.method !== 'GET' || adresse.origin !== self.location.origin) return;
  evenement.respondWith(fetch(evenement.request).then((reponse) => {
    if (reponse.ok) caches.open(NOM_CACHE).then((cache) => cache.put(evenement.request, reponse.clone()));
    return reponse;
  }).catch(() => caches.match(evenement.request).then((reponse) => reponse || caches.match('./index.html'))));
});

self.addEventListener('push', (evenement) => {
  const message = evenement.data?.json() || {};
  evenement.waitUntil(self.registration.showNotification(message.titre || 'Gestiga', {
    body: message.corps || 'Vous avez un rappel Gestiga.',
    icon: './icone.svg',
    badge: './icone.svg',
    data: { url: message.url || './' },
  }));
});

self.addEventListener('notificationclick', (evenement) => {
  evenement.notification.close();
  evenement.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
    const ouverte = fenetres.find((fenetre) => 'focus' in fenetre);
    return ouverte ? ouverte.focus() : self.clients.openWindow(evenement.notification.data?.url || './');
  }));
});
