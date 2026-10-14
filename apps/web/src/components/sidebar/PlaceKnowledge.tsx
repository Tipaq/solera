import { FileText, Pencil, Plus, Unlink, Waypoints } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { cx } from '@solera/ui'
import type { VaultNoteDto, VaultStateDto } from '@solera/protocol'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { useCreateNote, useVaultNotes } from '../../lib/vault'

/**
 * Le lieu *Savoir* : un **état**, pas un arbre.
 *
 * C'est tranché depuis la colonne : « l'arbre complet reste atteignable, il n'est pas la
 * porte d'entrée ». La colonne dit donc ce qui réclame — les ébauches à ranger, les
 * notes que personne ne cite, les carrefours — puis les notes récentes, qui sont la
 * porte réelle. L'arbre, lui, est la vue *Notes* du panneau.
 *
 * La *Boîte des agents* manque encore, et c'est volontaire : rien n'écrit dans le vault
 * pour l'instant, et une entrée qui compterait toujours zéro ne dirait rien. Elle
 * viendra avec la boîte, en tête de cette liste comme le dessin le montre.
 */

const FILTERS: { filter: 'drafts' | 'orphans' | 'crossroads'; labelKey: MessageKey; icon: typeof Pencil; count: (state: VaultStateDto) => number }[] = [
  { filter: 'drafts', labelKey: 'shell.knowledge.drafts', icon: Pencil, count: (state) => state.counts.drafts },
  { filter: 'orphans', labelKey: 'shell.knowledge.orphans', icon: Unlink, count: (state) => state.counts.orphans },
  { filter: 'crossroads', labelKey: 'shell.knowledge.crossroads', icon: Waypoints, count: (state) => state.counts.crossroads },
]

/** Au-delà, la liste ne se lit plus : le reste se retrouve par l'arbre et la recherche. */
const RECENT = 12

export function PlaceKnowledge({ state, onNavigate }: {
  state: VaultStateDto | undefined
  onNavigate: () => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const configured = state?.configured === true && state.exists
  const { data: recent } = useVaultNotes({ limit: RECENT }, configured)
  const create = useCreateNote()

  if (!configured) {
    return (
      <div className="px-2 pb-4">
        <p className="px-2.5 py-2 text-sm text-ink-faint">{t('shell.knowledge.unconfigured')}</p>
        <NavLink
          to="/vault"
          onClick={onNavigate}
          className="flex h-11 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink md:h-8 pointer-coarse:h-11"
        >
          {t('shell.knowledge.configure')}
        </NavLink>
      </div>
    )
  }

  return (
    <div className="px-2 pb-4">
      <ul>
        {FILTERS.map((entry) => {
          const count = state ? entry.count(state) : 0
          const Icon = entry.icon
          return (
            <li key={entry.filter}>
              {/* Les trois listes mènent à la page du vault, qui les montre : la colonne
                  les **compte**, elle ne les déplie pas. Un lieu est une destination. */}
              <NavLink
                to={`/vault/parcourir?liste=${entry.filter}`}
                onClick={onNavigate}
                className={({ isActive }) => cx(
                  'flex h-11 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors md:h-8 pointer-coarse:h-11',
                  isActive ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
                )}
              >
                <Icon size={15} className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate">{t(entry.labelKey)}</span>
                <span className="shrink-0 text-meta tabular-nums text-ink-faint">{count}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>

      {/* Écrire sans ranger : la note naît en **ébauche**, sans dossier, donc sans droit
          à hériter — aucun agent ne la voit, et ne jamais la ranger reste valable. */}
      <button
        type="button"
        disabled={create.isPending}
        onClick={() => {
          create.mutate(
            { title: t('shell.knowledge.draftTitle') },
            {
              onSuccess: (note) => {
                onNavigate()
                navigate(`/vault/note/${note.path.split('/').map(encodeURIComponent).join('/')}`)
              },
            },
          )
        }}
        className="mt-1 flex h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-high hover:text-ink md:h-8 pointer-coarse:h-11"
      >
        <Plus size={15} className="shrink-0" />
        <span className="flex-1">{t('shell.knowledge.newDraft')}</span>
      </button>

      <h2 className="px-2.5 pt-3 pb-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
        {t('shell.knowledge.recent')}
      </h2>
      <ul>
        {(recent ?? []).map((note) => (
          <NoteLine key={note.path} note={note} onNavigate={onNavigate} />
        ))}
      </ul>

      {recent !== undefined && recent.length === 0 ? (
        <p className="px-2.5 py-2 text-sm text-ink-faint">{t('shell.knowledge.empty')}</p>
      ) : null}
    </div>
  )
}

function NoteLine({ note, onNavigate }: { note: VaultNoteDto; onNavigate: () => void }) {
  return (
    <li>
      <NavLink
        to={`/vault/note/${note.path.split('/').map(encodeURIComponent).join('/')}`}
        onClick={onNavigate}
        title={note.path}
        className={({ isActive }) => cx(
          'flex h-11 items-center gap-2 rounded-md px-2.5 text-sm transition-colors md:h-8 pointer-coarse:h-11',
          isActive ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        )}
      >
        <FileText size={14} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate">{note.title}</span>
        {/* Le degré entrant, pour qui range : une note que personne ne cite se repère
            sans ouvrir la liste qui les compte. */}
        {note.incoming > 0 ? (
          <span className="shrink-0 text-meta tabular-nums text-ink-faint">{note.incoming}</span>
        ) : null}
      </NavLink>
    </li>
  )
}
