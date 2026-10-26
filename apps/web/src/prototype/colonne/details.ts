/** PROTOTYPE JETABLE (#121) — ce que chaque demande factice montre une fois dépliée. */
export interface Detail {
  lead: string
  body?: string
  options?: string[]
  fallback?: string
  items?: string[]
}

export const DETAILS: Record<string, Detail> = {
  d1: { lead: 'Claude veut lancer une commande :', body: 'pnpm --filter @solera/web test:places-ui' },
  d2: {
    lead: 'Garder la barre d’onglets en haut de l’onglet Agents, ou la passer dans la colonne ?',
    body: 'Claude Code la met en haut ; dans la colonne, elle coûterait une ligne par agent.',
    options: ['En haut, comme Claude Code', 'Dans la colonne', 'Je regarde d’abord la maquette'],
  },
  d3: {
    lead: 'Plan en 4 étapes',
    items: [
      'Lire les nouveautés de Sillage depuis v0.26.0',
      'Les trier : à reprendre, à adapter, à ignorer',
      'Ouvrir une carte par nouveauté retenue',
      'Résumer le tri dans une note de la carte #65',
    ],
  },
  d4: {
    lead: 'Fusionner la PR #69 avant ou après la revue ?',
    body: 'La revue a deux remarques mineures ; la #70 attend la #69 pour partir.',
    options: ['Avant la revue', 'Après la revue'],
    fallback: 'Après la revue',
  },
  d5: {
    lead: 'Quel contraste viser pour le texte faible du thème contrasté ?',
    body: 'Il est à 4,1:1 aujourd’hui, sous le seuil AA du petit texte.',
    options: ['4,5:1 (AA)', '7:1 (AAA)'],
    fallback: '4,5:1 (AA)',
  },
  d6: {
    lead: 'Signer « Where Solera comes from » de ton nom ou de Tipaq ?',
    options: ['Timothée', 'Tipaq'],
    fallback: 'Tipaq',
  },
  d7: {
    lead: 'L’agent propose de ranger trois cartes :',
    items: ['#118 Ranger une conversation → Terminé', '#119 Cycle de vie des demandes → Terminé', '#122 Libellés des réglages → Terminé'],
  },
  d8: {
    lead: 'L’agent propose de créer deux cartes :',
    items: ['Répondre à une session depuis la notification', 'Le badge de PR dans la colonne'],
  },
  d9: {
    lead: 'L’agent propose de ranger ce fil :',
    items: ['« Pourquoi WSL coupe Tailscale » → Solera'],
  },
}
