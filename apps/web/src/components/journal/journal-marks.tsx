import { BookOpen, CircleCheck, CircleDot, Clock, GitBranch, MessagesSquare, StickyNote } from 'lucide-react'
import type { ReactNode } from 'react'
import type { JournalEntryDto, JournalKind } from '@solera/protocol'

/*
 * Les marques d'une ligne d'événement, communes à tout ce qui montre le journal : son
 * icône, sa teinte et l'endroit où elle mène.
 */

/**
 * L'icône de chaque nature, reprise du libellé qu'elle précède.
 *
 * Partagée par les « Derniers événements » de l'Aperçu, la vue « Par moment » de Travail et
 * le portefeuille : une seconde table d'icônes divergerait au premier ajout de nature.
 */
export const JOURNAL_KIND_ICONS: Record<JournalKind, ReactNode> = {
  note: <StickyNote size={15} />,
  cardOpened: <CircleDot size={15} />,
  cardClosed: <CircleCheck size={15} />,
  session: <MessagesSquare size={15} />,
  run: <Clock size={15} />,
  branch: <GitBranch size={15} />,
  audit: <BookOpen size={15} />,
}

/**
 * Les deux seules teintes de la liste, et elles ne sont pas décoratives : ce qui ferme
 * un chantier et ce qui a échoué. Tout le reste est au gris du texte secondaire — une
 * ligne par source colorée ferait un sapin de Noël où plus rien ne ressort.
 */
export function journalIconTone(entry: JournalEntryDto): string {
  if (entry.kind === 'cardClosed') return 'text-positive'
  if (entry.status === 'failed' || entry.status === 'timed_out') return 'text-caution'
  return 'text-ink-faint'
}

/**
 * Où mène une ligne, quand elle mène quelque part.
 *
 * La conversation d'abord : c'est ce qu'on veut rouvrir quand on relit une note ou un
 * tir. La carte ensuite, par le board, qui sait déjà ouvrir son panneau sur un numéro.
 */
export function journalDestination(entry: JournalEntryDto): string | null {
  if (entry.conversationId) return `/p/${entry.projectId}/c/${entry.conversationId}`
  if (entry.cardNumber !== null) return `/p/${entry.projectId}/board?carte=${entry.cardNumber}`
  return null
}
