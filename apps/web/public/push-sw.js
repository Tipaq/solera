/**
 * Notifications push.
 *
 * Chargé par `importScripts` dans le service worker généré par Workbox : garder la
 * génération automatique du précache tout en ajoutant nos propres écouteurs, plutôt
 * que d'écrire le service worker entier à la main.
 *
 * Ce script n'a pas de session et ne peut rien aller relire : tout ce qu'il affiche
 * vient du contenu poussé par le serveur.
 */

/**
 * Titres par sorte de notification, dans la langue de l'appareil : le serveur ne connaît
 * pas celle de l'interface, et ce script n'a pas accès à son catalogue. Le titre envoyé
 * par le serveur reste le repli, pour une sorte que cette copie ne connaît pas encore.
 */
const TITLES = {
  fr: {
    permission: 'Une autorisation est demandée',
    question: "L'agent te demande de choisir",
    elicitation: 'Un service demande une saisie',
    plan: 'Un plan attend ta validation',
    turnCompleted: "L'agent a terminé",
    test: 'Notification de test',
  },
  en: {
    permission: 'Approval requested',
    question: 'The agent is asking you to choose',
    elicitation: 'A service is asking for input',
    plan: 'A plan is waiting for review',
    turnCompleted: 'The agent has finished',
    test: 'Test notification',
  },
}

/** Les essais seulement : le corps des autres est le titre de la conversation. */
const TEST_BODIES = {
  fr: 'Les notifications de Solera arrivent bien sur cet appareil.',
  en: 'Solera notifications reach this device.',
}

function language() {
  return (self.navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

function titleOf(payload) {
  return (payload.kind && TITLES[language()][payload.kind]) || payload.title
}

function bodyOf(payload) {
  return payload.kind === 'test' ? TEST_BODIES[language()] : payload.body
}

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    // Contenu illisible : mieux vaut ne rien afficher qu'une notification vide, mais
    // l'erreur ne doit pas remonter, sinon le navigateur désactive l'abonnement.
    return
  }

  event.waitUntil(
    self.registration.showNotification(titleOf(payload), {
      body: bodyOf(payload),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Une conversation ne garde qu'une notification affichée : le serveur envoie son
      // identifiant comme étiquette.
      tag: payload.tag,
      renotify: true,
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url
  if (!url) return

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      // Un onglet déjà ouvert sur l'application est réutilisé : en ouvrir un second
      // laisserait deux vues de la même conversation côte à côte.
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        if ('navigate' in client) await client.navigate(url)
        return
      }

      await self.clients.openWindow(url)
    })(),
  )
})
