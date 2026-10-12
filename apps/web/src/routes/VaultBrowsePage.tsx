import { BookOpen, ChevronRight, FileText, ListFilter, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, EmptyState, Menu, MenuCheckboxItem, cx } from '@solera/ui'
import { vaultNoteFilterSchema, type VaultNoteDto, type VaultNoteFilter } from '@solera/protocol'
import { HeaderBand } from '../components/HeaderBand'
import { elapsed } from '../lib/dates'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { useCreateNote, useVaultNotes, useVaultState } from '../lib/vault'

/**
 * *Parcourir* : le vault en colonnes qu'on trie, pour **ranger**.
 *
 * Elle ne s'oppose pas à l'arbre du panneau, elle a un autre moment : le panneau sert
 * pendant qu'on écrit, cette page quand on fait le ménage. Un arbre de 20 rem ne montre
 * qu'un titre tronqué, et ranger deux cents notes demande des colonnes.
 *
 * Les cinq listes sont celles de l'index, niveau 1 : tout ce qui est ici est un fait du
 * texte, donc exact. C'est aussi pourquoi la page peut trier côté navigateur — les
 * colonnes viennent déjà toutes de la même requête.
 */

const FILTER_LABELS: Record<VaultNoteFilter, MessageKey> = {
  all: 'vault.browse.filter.all',
  drafts: 'vault.browse.filter.drafts',
  orphans: 'vault.browse.filter.orphans',
  crossroads: 'vault.browse.filter.crossroads',
  broken: 'vault.browse.filter.broken',
}

type SortKey = 'title' | 'folder' | 'incoming' | 'words' | 'modifiedAt'

const COLUMNS: { key: SortKey; labelKey: MessageKey; align: 'left' | 'right' }[] = [
  { key: 'title', labelKey: 'vault.browse.column.note', align: 'left' },
  { key: 'folder', labelKey: 'vault.browse.column.folder', align: 'left' },
  { key: 'incoming', labelKey: 'vault.browse.column.incoming', align: 'right' },
  { key: 'words', labelKey: 'vault.browse.column.words', align: 'right' },
  { key: 'modifiedAt', labelKey: 'vault.browse.column.touched', align: 'right' },
]

/** Ce qu'une page de ménage peut montrer d'un coup sans devenir illisible. */
const LIMIT = 500

export function VaultBrowsePage() {
  const t = useTranslate()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const create = useCreateNote()

  const filter = vaultNoteFilterSchema.catch('all').parse(params.get('liste') ?? 'all')
  const { data: state } = useVaultState()
  const configured = state?.configured === true && state.exists
  const { data: notes } = useVaultNotes({ filter, limit: LIMIT }, configured)

  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'modifiedAt',
    descending: true,
  })

  const rows = useMemo(() => {
    const sorted = [...(notes ?? [])]
    sorted.sort((a, b) => compare(a, b, sort.key))
    return sort.descending ? sorted.reverse() : sorted
  }, [notes, sort])

  const openNote = (path: string) =>
    navigate(`/vault/note/${path.split('/').map(encodeURIComponent).join('/')}`)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBand>
        <BookOpen size={16} className="shrink-0 text-ink-faint" />
        <h1 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
          <NavLink to="/vault" className="shrink-0 text-ink-faint hover:text-ink">
            {t('shell.place.knowledge')}
          </NavLink>
          <ChevronRight size={13} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 truncate">{t('vault.browse.title')}</span>
          <span className="shrink-0 text-meta tabular-nums text-ink-faint">
            {t('vault.browse.count', { count: String(rows.length) })}
          </span>
        </h1>

        {/* « Filtrer » et non un sélecteur : les cinq listes sont celles de la colonne,
            et le menu les nomme en entier là où un champ les tronquerait. */}
        <Menu
          trigger={
            <Button size="sm" variant="ghost" icon={<ListFilter size={16} />}>
              <span className="hidden sm:inline">{t(FILTER_LABELS[filter])}</span>
            </Button>
          }
        >
          {vaultNoteFilterSchema.options.map((entry) => (
            <MenuCheckboxItem
              key={entry}
              checked={entry === filter}
              onCheckedChange={() =>
                setParams(entry === 'all' ? {} : { liste: entry }, { replace: true })
              }
            >
              {t(FILTER_LABELS[entry])}
            </MenuCheckboxItem>
          ))}
        </Menu>
        <Button
          size="sm"
          icon={<Plus size={16} />}
          disabled={!configured || create.isPending}
          onClick={() =>
            create.mutate(
              { title: t('shell.knowledge.draftTitle') },
              { onSuccess: (note) => openNote(note.path) },
            )
          }
        >
          <span className="hidden sm:inline">{t('vault.browse.newNote')}</span>
        </Button>
      </HeaderBand>

      <div className="min-h-0 flex-1 overflow-auto">
        {!configured ? (
          <EmptyState
            icon={<BookOpen size={22} />}
            title={t('vault.page.unconfigured.title')}
            description={t('vault.page.unconfigured.description')}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={<FileText size={22} />} title={t('vault.browse.empty')} />
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-canvas/95 backdrop-blur">
              <tr>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      sort.key === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'
                    }
                    className={cx(
                      'border-b border-line px-3 py-2 text-meta font-semibold uppercase tracking-wider text-ink-faint',
                      column.align === 'right' ? 'text-right' : 'text-left',
                      column.key === 'folder' && 'hidden sm:table-cell',
                      column.key === 'words' && 'hidden md:table-cell',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((held) =>
                          held.key === column.key
                            ? { key: column.key, descending: !held.descending }
                            : // Un tri neuf part dans le sens qui intéresse : décroissant
                              // sur un nombre et une date, croissant sur un nom.
                              { key: column.key, descending: column.align === 'right' },
                        )
                      }
                      className="transition-colors hover:text-ink"
                    >
                      {t(column.labelKey)}
                      {sort.key === column.key ? (sort.descending ? ' ↓' : ' ↑') : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((note) => (
                <tr
                  key={note.path}
                  onClick={() => openNote(note.path)}
                  className="cursor-pointer border-b border-line/60 transition-colors hover:bg-surface-high"
                >
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <FileText size={14} className="shrink-0 text-ink-faint" />
                      <span className="min-w-0 truncate">{note.title}</span>
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 text-ink-faint sm:table-cell">
                    {note.folder.length > 0 ? note.folder : t('vault.page.draft')}
                  </td>
                  {/* Zéro lien entrant se voit : c'est le fait qui décide s'il faut
                      relier la note à quelque chose. */}
                  <td
                    className={cx(
                      'px-3 py-2 text-right tabular-nums',
                      note.incoming === 0 ? 'text-caution' : 'text-ink-soft',
                    )}
                  >
                    {note.incoming}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums text-ink-faint md:table-cell">
                    {note.words}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-faint">{elapsed(note.modifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function compare(a: VaultNoteDto, b: VaultNoteDto, key: SortKey): number {
  if (key === 'title' || key === 'folder') return a[key].localeCompare(b[key])
  return a[key] - b[key]
}
