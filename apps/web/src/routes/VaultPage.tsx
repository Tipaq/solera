import { BookOpen, FileText, Link2, PanelRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, EmptyState, IconButton, cx } from '@solera/ui'
import { HeaderBand } from '../components/HeaderBand'
import { NoteEditor, type NoteTarget } from '../components/vault/NoteEditor'
import { VaultPanel } from '../components/vault/VaultPanel'
import { ApiRequestError } from '../lib/api'
import { useTranslate } from '../lib/i18n'
import { setPanelOpen, usePanelLayout, usePanelPresence } from '../lib/panel'
import { openSettings } from '../lib/settings-dialog'
import { setVaultPanelTab } from '../lib/vault-panel'
import {
  useCreateNote,
  useSaveNote,
  useVaultNoteContent,
  useVaultNoteFacts,
  useVaultNoteHistory,
  useVaultNotes,
  useVaultState,
  useVaultTree,
} from '../lib/vault'

/**
 * La page du vault : l'**atelier**.
 *
 * C'est le parti D2, et il vient d'une correction de cap : le vault n'est pas une
 * archive qu'on consulte, c'est ce avec quoi on produit. La page ouvre donc sur
 * l'écriture — une note au centre, en largeur de lecture — et non sur un inventaire.
 * Les deux premiers partis dessinés (le flux daté, la table des matières) ont été
 * déclassés pour ça : ils administraient au lieu de servir à écrire.
 *
 * Ce qui manque encore à l'atelier est nommé et pas simulé : la **pile des
 * rapprochements** en colonne de 19 rem demande le niveau 2 de l'indexation, qui n'est
 * pas ce tour-ci. La vue *Rapprochements* du panneau le dit, plutôt que de montrer une
 * colonne vide dont on chercherait la raison.
 *
 * Enregistrer n'est pas committer : la frappe part au disque à la pause, et
 * l'historique de la note reste ce que git en dit.
 */

/**
 * Délai d'enregistrement après la dernière frappe.
 *
 * Le même ordre de grandeur que le budget de l'indexation — « les rapprochements de la
 * note ouverte sous deux secondes après la pause de frappe » : enregistrer plus tôt ne
 * servirait à rien, puisque rien ne se recalcule avant.
 */
const SAVE_AFTER_MS = 1200

export function VaultPage() {
  const t = useTranslate()
  const navigate = useNavigate()
  const params = useParams()
  const requested = params['*'] ?? ''

  const { data: state, isPending: statePending } = useVaultState()
  const configured = state?.configured === true && state.exists
  const { data: recent } = useVaultNotes({ limit: 1 }, configured)
  const { data: tree } = useVaultTree(configured)

  /**
   * La note ouverte : celle de l'adresse, sinon la dernière modifiée.
   *
   * L'atelier ouvre sur ce qu'on écrivait, pas sur un choix à faire : c'est ce que le
   * parti *C* du premier tour apportait et que les deux autres n'avaient pas — une
   * action par défaut.
   */
  const note = requested.length > 0 ? requested : (recent?.[0]?.path ?? null)

  const { data: content, error: contentError } = useVaultNoteContent(configured ? note : null)
  const { data: facts } = useVaultNoteFacts(configured ? note : null)
  const { data: history } = useVaultNoteHistory(configured ? note : null)
  const save = useSaveNote()
  const create = useCreateNote()

  const panel = usePanelPresence()
  const panelLayout = usePanelLayout()

  const openNote = useCallback(
    (path: string) => navigate(`/vault/note/${path.split('/').map(encodeURIComponent).join('/')}`),
    [navigate],
  )

  const createNote = (folder: string, title: string) => {
    create.mutate({ folder, title }, { onSuccess: (created) => openNote(created.path) })
  }

  /**
   * Un `[[lien]]` cliqué : la cible est un **titre** ou un chemin, pas une adresse.
   *
   * La résolution se fait sur l'arbre, par le même ordre que le serveur — le chemin
   * d'abord, le titre ensuite. Une cible qui ne répond à rien est un lien cassé : on
   * ne navigue pas, et le panneau *Liens* le montre déjà comme tel.
   */
  const openLink = (target: string) => {
    const key = target.toLowerCase()
    const notes = tree?.notes ?? []
    const byPath = notes.find(
      (entry) => entry.path.toLowerCase() === key || entry.path.toLowerCase() === `${key}.md`,
    )
    const found = byPath ?? notes.find((entry) => entry.title.toLowerCase() === key)
    if (found) openNote(found.path)
  }

  if (statePending) return null

  if (state?.configured !== true) {
    return (
      <Frame>
        <EmptyState
          icon={<BookOpen size={22} />}
          title={t('vault.page.unconfigured.title')}
          description={t('vault.page.unconfigured.description')}
          action={
            <Button size="sm" onClick={() => openSettings('savoir')}>
              {t('vault.page.unconfigured.action')}
            </Button>
          }
        />
      </Frame>
    )
  }

  if (!state.exists) {
    return (
      <Frame>
        <EmptyState
          icon={<BookOpen size={22} />}
          title={t('vault.page.missing.title')}
          description={state.path}
          action={
            <Button size="sm" onClick={() => openSettings('savoir')}>
              {t('vault.page.unconfigured.action')}
            </Button>
          }
        />
      </Frame>
    )
  }

  if (note === null) {
    return (
      <Frame>
        <EmptyState
          icon={<FileText size={22} />}
          title={t('vault.page.empty.title')}
          description={t('vault.page.empty.description')}
          action={
            <Button
              size="sm"
              icon={<Plus size={16} />}
              onClick={() => createNote('', t('vault.page.empty.firstNote'))}
            >
              {t('vault.page.empty.action')}
            </Button>
          }
        />
      </Frame>
    )
  }

  return (
    <div ref={panelLayout.containerRef} className="relative flex h-full overflow-clip">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <HeaderBand>
          <FileText size={16} className="shrink-0 text-ink-faint" />
          <h1 className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate text-sm font-medium">
            {/* Le dossier avant le titre : c'est lui qui portera le droit, et une note
                sans dossier est une ébauche — l'absence se lit donc aussi. */}
            {facts && facts.note.folder.length > 0 ? (
              <span className="shrink-0 text-ink-faint">{facts.note.folder}</span>
            ) : (
              <span className="shrink-0 text-ink-faint">{t('vault.page.draft')}</span>
            )}
            <span className="min-w-0 truncate">{content?.title ?? facts?.note.title ?? note}</span>
          </h1>

          {/* Le nombre de liens entrants, en pastille : un fait du texte, immédiat, et
              la porte vers la vue qui les liste. */}
          {facts && facts.incoming.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setVaultPanelTab('links')
                setPanelOpen(true)
              }}
              className="shrink-0"
            >
              <Badge icon={<Link2 size={11} />}>
                {t('vault.page.incoming', { count: String(facts.incoming.length) })}
              </Badge>
            </button>
          ) : null}

          <SaveState pending={save.isPending} error={save.error} />

          <IconButton
            label={panel.open ? t('conversation.panel.close') : t('conversation.panel.open')}
            size="sm"
            onClick={() => setPanelOpen(!panel.open)}
          >
            <PanelRight size={16} />
          </IconButton>
        </HeaderBand>

        {contentError instanceof ApiRequestError ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmptyState
              icon={<FileText size={22} />}
              title={t('vault.page.unreadable.title')}
              description={contentError.message}
            />
          </div>
        ) : content ? (
          <NoteSheet
            key={content.path}
            path={content.path}
            initial={content.content}
            fingerprint={content.fingerprint}
            targets={tree?.notes ?? []}
            onSave={(input) => save.mutate(input)}
            onOpenLink={openLink}
            /* La note créée depuis `[[` n'est pas ouverte : le lien vient d'être écrit
               dans la note courante, et la quitter pour la nouvelle perdrait la phrase
               en cours. Elle existe, l'arbre la montre, le lien n'est plus cassé. */
            onCreateNote={(title) => create.mutate({ folder: '', title })}
          />
        ) : null}
      </div>

      {panel.mounted ? (
        <VaultPanel
          note={note}
          facts={facts}
          history={history}
          tree={tree}
          open={panel.open}
          docked={panelLayout.docked}
          canDock={panelLayout.canDock}
          onOpenNote={openNote}
          onCreateNote={createNote}
        />
      ) : null}
    </div>
  )
}

/**
 * La feuille d'écriture, et son enregistrement.
 *
 * Remontée à chaque changement de note, par sa clé : pousser un texte dans un éditeur
 * vivant effacerait le curseur de qui tape.
 *
 * L'enregistrement part à la pause de frappe, et aussi quand on quitte la note — sinon
 * la dernière phrase tapée avant un clic dans l'arbre serait perdue, ce qui est
 * exactement le moment où l'on suit un lien qu'on vient d'écrire.
 */
function NoteSheet({ path, initial, fingerprint, targets, onSave, onOpenLink, onCreateNote }: {
  path: string
  initial: string
  fingerprint: string
  targets: NoteTarget[]
  onSave: (input: { path: string; content: string; fingerprint: string | null }) => void
  onOpenLink: (target: string) => void
  /** La note absente, créée depuis le sélecteur `[[` sans quitter la frappe. */
  onCreateNote: (title: string) => void
}) {
  /** Ce qui est sur le disque, pour ne rien enregistrer qui n'ait changé. */
  const saved = useRef(initial)
  const draft = useRef(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (draft.current === saved.current) return
    saved.current = draft.current
    onSave({ path, content: draft.current, fingerprint })
  }, [onSave, path, fingerprint])

  // Au démontage : changer de note, ou quitter la page, ne doit pas perdre la frappe.
  useEffect(() => flush, [flush])

  const change = (value: string) => {
    draft.current = value
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_AFTER_MS)
  }

  const memoTargets = useMemo(() => targets, [targets])

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <NoteEditor
        initial={initial}
        targets={memoTargets}
        onChange={change}
        onSave={flush}
        onOpenLink={onOpenLink}
        onCreateNote={onCreateNote}
      />
    </div>
  )
}

/**
 * L'état de l'enregistrement, en un mot.
 *
 * Discret parce qu'il n'y a rien à décider tant que ça marche. Le conflit, lui, se dit
 * en clair : le vault s'édite ailleurs, et c'est le seul cas où la frappe peut être
 * perdue si personne ne tranche.
 */
function SaveState({ pending, error }: { pending: boolean; error: unknown }) {
  const t = useTranslate()

  if (error instanceof ApiRequestError) {
    return (
      <span
        className={cx(
          'shrink-0 rounded-md px-2 py-0.5 text-xs',
          error.code === 'vault_note_stale' ? 'bg-caution/15 text-caution' : 'bg-critical/15 text-critical',
        )}
        role="status"
      >
        {error.code === 'vault_note_stale' ? t('vault.page.stale') : t('vault.page.saveFailed')}
      </span>
    )
  }

  return (
    <span className="shrink-0 text-meta text-ink-faint" role="status">
      {pending ? t('vault.page.saving') : null}
    </span>
  )
}

/** Les états vides gardent la bande : sans elle, la page n'a plus de titre ni de retour. */
function Frame({ children }: { children: React.ReactNode }) {
  const t = useTranslate()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBand>
        <BookOpen size={16} className="shrink-0 text-ink-faint" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{t('shell.place.knowledge')}</h1>
      </HeaderBand>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
