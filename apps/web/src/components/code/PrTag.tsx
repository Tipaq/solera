import { GitPullRequest } from 'lucide-react'
import { cx } from '@solera/ui'
import { PR_TONE, type CodeTone, type CodePr } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'

/** Le ton d'une PR (T-10.4) en teinte de texte : la couleur dit l'état, sans pastille pleine. */
const TONE_TEXT: Record<CodeTone, string> = {
  neutral: 'text-ink-faint',
  accent: 'text-accent',
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
}

/**
 * Une PR en une ligne : l'icône, le numéro, l'état en toutes lettres. Un lien vers la
 * forge quand on en connaît l'adresse ; sinon du texte, qui n'a pas l'air cliquable. Le
 * clic ne remonte pas : la ligne qui la porte s'ouvre elle-même au clic (un `div` qui
 * navigue, jamais un `<a>`, qui ne pourrait pas en contenir un autre).
 *
 * `compact` : le numéro seul, l'état dit par la couleur, l'infobulle et le lecteur
 * d'écran — la colonne de 4 rem du graphe des branches (A-4.4). Sans PR : « — ».
 */
export function PrTag({ pr, compact = false }: { pr: CodePr | null; compact?: boolean }) {
  const t = useTranslate()
  if (!pr) {
    if (!compact) return <span className="text-xs text-ink-faint">{t('code.pr.none')}</span>
    return (
      <span className="text-xs text-ink-faint">
        <span aria-hidden>—</span>
        <span className="sr-only">{t('code.pr.none')}</span>
      </span>
    )
  }
  const state = t(`code.pr.${pr.state}`)
  const body = (
    <>
      <GitPullRequest size={12} className="shrink-0" />
      <span className="tabular-nums">#{pr.number}</span>
      <span className={cx(compact && 'sr-only')}>{state}</span>
    </>
  )
  const shape = cx('inline-flex items-center gap-1 text-xs', TONE_TEXT[PR_TONE[pr.state]])
  const title = compact ? state : undefined
  if (!pr.url) return <span className={shape} title={title}>{body}</span>
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={(event) => event.stopPropagation()}
      className={cx(shape, 'hover:underline')}
    >
      {body}
    </a>
  )
}
