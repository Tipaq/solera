import { Container, Monitor, ShieldCheck } from 'lucide-react'
import { environmentKey, environmentServiceId, type ExecutionEnvironment } from '@solera/protocol'
import { Link } from 'react-router-dom'
import { Select, cx } from '@solera/ui'
import { useTranslate } from '../lib/i18n'

/**
 * L'environnement d'exécution d'une session : où tournent son CLI et ses terminaux, et
 * s'ils y sont confinés (ADR 0001). Le choisir, et le montrer.
 */

/** La clé de son libellé ; `.hint` ajouté, celle de sa ligne d'aide. */
function labelKey(environment: ExecutionEnvironment) {
  return `environment.${environmentKey(environment)}` as const
}

export function EnvironmentIcon({ environment, size }: { environment: ExecutionEnvironment; size: number }) {
  if (environment.confined) return <ShieldCheck size={size} />
  return environment.where === 'host' ? <Monitor size={size} /> : <Container size={size} />
}

/**
 * Le choix d'un environnement, parmi ceux que le serveur sait lancer pour ce projet :
 * dans les réglages du projet comme au brouillon d'une session. Un choix seul se montre
 * quand même, désactivé : il dit où la session tournera.
 */
export function EnvironmentSelect({
  value,
  choices,
  onChange,
  disabled,
  className,
}: {
  value: ExecutionEnvironment
  choices: ExecutionEnvironment[]
  onChange: (environment: ExecutionEnvironment) => void
  disabled?: boolean
  className?: string
}) {
  const t = useTranslate()
  // Le réglage courant reste affiché même si le serveur ne le propose plus.
  const options = choices.some((choice) => environmentKey(choice) === environmentKey(value))
    ? choices
    : [value, ...choices]
  return (
    <Select
      label={t('environment.label')}
      value={environmentKey(value)}
      onChange={(key) => {
        const next = options.find((choice) => environmentKey(choice) === key)
        if (next) onChange(next)
      }}
      disabled={disabled || options.length < 2}
      className={className}
      options={options.map((choice) => ({
        value: environmentKey(choice),
        label: t(labelKey(choice)),
        icon: <EnvironmentIcon environment={choice} size={16} />,
        hint: t(`${labelKey(choice)}.hint`),
      }))}
    />
  )
}

/**
 * La ligne de Services qui montre l'environnement d'une session : le dev container du
 * projet, ou son propre bac à sable. Null sur l'hôte non confiné, qui n'y a pas de ligne.
 */
export function environmentServicesPath(
  environment: ExecutionEnvironment,
  session: { id: string; projectId: string | null },
): string | null {
  const id =
    environment.where === 'devcontainer' && !environment.confined && session.projectId
      ? environmentServiceId({ kind: 'devcontainer', projectId: session.projectId })
      : environment.confined
        ? environmentServiceId({ kind: 'sandbox', conversationId: session.id })
        : null
  if (!id) return null
  return `/services?${new URLSearchParams({ environment: id, session: session.id }).toString()}`
}

/**
 * La pastille de l'en-tête d'une session : où elle tourne, figé à sa création. Avec
 * `to`, elle mène à sa ligne dans Services.
 */
export function EnvironmentPill({
  environment,
  to,
  className = 'flex',
}: {
  environment: ExecutionEnvironment
  to?: string | null
  /** Porte l'affichage : `flex`, ou masquée sous une largeur. */
  className?: string
}) {
  const t = useTranslate()
  const label = t(labelKey(environment))
  const classes = cx(
    'shrink-0 items-center gap-1 rounded-md bg-surface-high px-1.5 py-0.5 text-micro text-ink-soft',
    to && 'hover:text-accent',
    className,
  )
  const content = (
    <>
      <EnvironmentIcon environment={environment} size={11} />
      <span className="max-w-40 truncate">{label}</span>
    </>
  )
  return to ? (
    <Link to={to} className={classes} title={t('environment.pill.services', { environment: label })}>
      {content}
    </Link>
  ) : (
    <span className={classes} title={t('environment.pill.title', { environment: label })}>
      {content}
    </span>
  )
}
