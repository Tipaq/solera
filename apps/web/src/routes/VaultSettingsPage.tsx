import { FolderTree, Library, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Badge, Banner, Button, Card, CardBody, CardHeader, EmptyState } from '@solera/ui'
import { SectionHeader } from './SettingsPage'
import { PathField } from '../components/PathField'
import { ApiRequestError } from '../lib/api'
import { useAppSettings, useUpdateAppSettings } from '../lib/app-settings'
import { locale, useTranslate, type MessageKey } from '../lib/i18n'
import { useCurrentUser } from '../lib/session'
import { useReindexVault, useVaultState } from '../lib/vault'

/**
 * Le vault du lieu *Savoir* : où il est, et ce que l'index en dit.
 *
 * Réglage d'instance, comme l'archivage : le vault n'est pas un répertoire de travail
 * mais une ressource partagée. Les droits par dossier, qui disent ce qu'un agent peut
 * y écrire, ne sont pas ici — ils se posent sur les dossiers.
 *
 * L'écran montre les cinq comptes du **niveau 1** de l'indexation, les faits du texte,
 * et le commit que l'index reflète. Ce dernier n'est pas un détail d'implémentation à
 * cacher : c'est lui qui permet de voir d'un coup d'œil si l'index est en retard sur
 * un vault écrit ailleurs.
 */

const COUNTS: { key: keyof VaultCounts; labelKey: MessageKey }[] = [
  { key: 'notes', labelKey: 'vault.counts.notes' },
  { key: 'drafts', labelKey: 'vault.counts.drafts' },
  { key: 'orphans', labelKey: 'vault.counts.orphans' },
  { key: 'crossroads', labelKey: 'vault.counts.crossroads' },
  { key: 'brokenLinks', labelKey: 'vault.counts.brokenLinks' },
]

type VaultCounts = { notes: number; drafts: number; orphans: number; crossroads: number; brokenLinks: number }

export function VaultSettingsPage() {
  const t = useTranslate()
  const { data: me } = useCurrentUser()
  const isAdmin = me?.isAdmin === true
  const { data: settings } = useAppSettings()
  const { data: state } = useVaultState()
  const update = useUpdateAppSettings()
  const reindex = useReindexVault()

  const [path, setPath] = useState('')
  // Le champ suit le serveur tant qu'on n'y a pas touché : sans ça il reste vide au
  // premier rendu, la requête n'ayant pas encore répondu.
  useEffect(() => {
    if (settings) setPath(settings.vaultPath)
  }, [settings])

  if (!isAdmin) {
    return (
      <EmptyState
        icon={<ShieldCheck size={22} />}
        title={t('vault.adminOnly.title')}
        description={t('vault.adminOnly.description')}
      />
    )
  }

  const trimmed = path.trim()
  const absolute = trimmed === '' || trimmed.startsWith('/')
  const dirty = settings !== undefined && trimmed !== settings.vaultPath

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // Le serveur lance déjà une passe sur un chemin changé, sans l'attendre — ce qui
    // vaut pour tout appelant, y compris l'API. Celle-ci est demandée en plus, et
    // attendue : elle rend l'état de l'index une fois la passe finie, là où une
    // invalidation relirait un index à moitié écrit. Les deux passes se suivent, le
    // service les sérialisant, et une passe de lecture sur un vault personnel coûte
    // une seconde.
    if (absolute && dirty) update.mutate({ vaultPath: trimmed }, { onSuccess: () => reindex.mutate() })
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('vault.section.title')} description={t('vault.section.description')} />

      <Card>
        <CardHeader title={t('vault.path.title')} icon={<FolderTree size={16} />} />
        <CardBody>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <PathField
              label={t('vault.path.label')}
              hint={t('vault.path.hint')}
              error={absolute ? undefined : t('vault.path.relative')}
              placeholder="/home/…/vault"
              value={path}
              onChange={setPath}
            />

            {state?.configured && !state.exists ? (
              <Banner tone="critical">{t('vault.path.missing')}</Banner>
            ) : null}

            {update.error instanceof ApiRequestError ? (
              <Banner tone="critical">{update.error.message}</Banner>
            ) : null}

            <div>
              <Button type="submit" disabled={!absolute || !dirty || update.isPending}>
                {t('vault.path.save')}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('vault.index.title')} icon={<Library size={16} />} />
        <CardBody>
          {state?.configured !== true ? (
            <p className="text-sm text-ink-faint">{t('vault.index.unconfigured')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {COUNTS.map((entry) => (
                  <div key={entry.key} className="flex flex-col gap-0.5">
                    <dd className="text-lg font-semibold tabular-nums">{state.counts[entry.key]}</dd>
                    <dt className="text-xs text-ink-faint">{t(entry.labelKey)}</dt>
                  </div>
                ))}
              </dl>

              <div className="flex flex-col gap-1 text-xs text-ink-faint">
                {/* Le commit reflété, et celui du vault. Les montrer séparément est le
                    seul moyen de voir qu'un index est en retard plutôt que faux. */}
                {state.indexedCommit ? (
                  <p>
                    {t('vault.index.commit', { sha: state.indexedCommit.slice(0, 8) })}
                    {state.headCommit && state.headCommit !== state.indexedCommit ? (
                      <span className="ml-2">
                        <Badge tone="caution">
                          {t('vault.index.behind', { sha: state.headCommit.slice(0, 8) })}
                        </Badge>
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p>{t('vault.index.noCommit')}</p>
                )}
                {state.indexedAt ? (
                  <p>
                    {t('vault.index.at', {
                      date: new Date(state.indexedAt).toLocaleString(locale(), {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  icon={<RefreshCw size={14} />}
                  disabled={reindex.isPending}
                  onClick={() => reindex.mutate()}
                >
                  {t('vault.index.reindex')}
                </Button>
                {reindex.data ? (
                  <span className="text-xs text-ink-faint">
                    {t('vault.index.reindexed', {
                      indexed: String(reindex.data.indexed),
                      removed: String(reindex.data.removed),
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Banner tone="info">{t('vault.index.derived')}</Banner>
    </div>
  )
}
