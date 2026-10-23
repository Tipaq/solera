import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useEffect, type KeyboardEvent, type MutableRefObject, type ReactNode } from 'react'
import type { CurrentUser, InstanceProfile, OnboardingAnswers, OnboardingState } from '@solera/protocol'
import { Banner, Button, SegmentedControl, cx } from '@solera/ui'
import { LOCALES, LOCALE_LABELS, setLocale, useLocale, useTranslate, type Locale } from '../../lib/i18n'
import type { OnboardingStepId } from '../../lib/onboarding'
import { Logo } from '../Logo'

/**
 * Ce qu'une étape dit à la page : si « Continuer » est possible, et ce qu'il doit faire
 * avant de passer à la suite.
 *
 * La page tient les boutons, l'étape tient son formulaire : le bouton d'une étape qui
 * crée un compte ne peut pas s'activer tant que le mot de passe est trop court, et c'est
 * l'étape qui le sait.
 */
export interface StepGate {
  canContinue?: boolean
  laterAllowed?: boolean
  skipAllowed?: boolean
}

export interface StepNav {
  commit: MutableRefObject<(() => Promise<void>) | null>
  setGate: (gate: StepGate) => void
}

export interface StepProps {
  nav: StepNav
  state: OnboardingState
  setAnswers: (patch: Partial<OnboardingAnswers>) => void
  profile: InstanceProfile
  /** Null tant que le premier compte n'est pas créé. */
  user: CurrentUser | null
}

/** Ce que « Continuer » exécute d'abord, relu à chaque rendu pour voir les champs à jour. */
export function useCommit(nav: StepNav, fn: (() => Promise<void>) | null): void {
  useEffect(() => {
    nav.commit.current = fn
    return () => {
      nav.commit.current = null
    }
  })
}

export function useGate(nav: StepNav, gate: StepGate): void {
  const { canContinue, laterAllowed, skipAllowed } = gate
  const { setGate } = nav
  useEffect(() => {
    setGate({ canContinue, laterAllowed, skipAllowed })
  }, [setGate, canContinue, laterAllowed, skipAllowed])
}

/** Le titre d'une étape, et la phrase qui dit ce qu'elle apprend. */
export function StepTitle({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {lead ? <p className="text-[0.9375rem] leading-relaxed text-ink-soft">{lead}</p> : null}
    </header>
  )
}

/** Le « pourquoi » d'une étape : ce que le réglage change, dit une fois. */
export function Why({ children }: { children: ReactNode }) {
  return <Banner tone="info">{children}</Banner>
}

/**
 * Une idée de Solera, dans les étapes qui présentent sans régler : une icône, un nom,
 * et la phrase qui dit à quoi elle sert.
 */
export function Idea({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface-high text-ink-soft">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-ink-soft">{children}</span>
      </span>
    </li>
  )
}

export function Ideas({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-4">{children}</ul>
}

/**
 * La langue, à portée de main dès le premier écran : c'est la première chose qu'on règle
 * quand l'interface ne parle pas la sienne, et l'étape Apparence vient trop tard pour
 * une visite qui n'a pas encore commencé.
 */
function LanguageSwitch() {
  const active = useLocale()
  return (
    <SegmentedControl<Locale>
      label="Language"
      value={active}
      segments={LOCALES.map((option) => ({ value: option, label: LOCALE_LABELS[option] }))}
      onChange={(option) => {
        // Un échec laisse l'interface dans sa langue, entière : un nouveau clic retentera.
        setLocale(option).catch((error: unknown) => console.warn(error))
      }}
    />
  )
}

export interface ShellStep {
  id: OnboardingStepId
  title: string
  sub: string
  status: 'done' | 'skipped' | 'current' | 'todo'
  /** Cliquable : en arrière, ou en avant vers une étape déjà traversée. */
  reachable: boolean
}

/**
 * Le cadre de la visite : la liste des étapes à gauche sur grand écran, une barre de
 * progression en haut au téléphone, et les boutons en bas. Plein écran, sans la colonne
 * de l'application : rien d'autre à regarder.
 */
export function OnboardingShell({
  steps,
  index,
  onGoto,
  onSkipAll,
  onBack,
  onNext,
  onLater,
  nextLabel,
  pending,
  canContinue,
  laterAllowed,
  skipAllowed,
  error,
  children,
}: {
  steps: ShellStep[]
  index: number
  onGoto: (index: number) => void
  onSkipAll: () => void
  onBack: () => void
  onNext: () => void
  onLater: () => void
  nextLabel: string
  pending: boolean
  canContinue: boolean
  laterAllowed: boolean
  skipAllowed: boolean
  error: string | null
  children: ReactNode
}) {
  const t = useTranslate()
  const current = steps[index]
  const first = index === 0
  const last = index === steps.length - 1

  /*
   * Entrée dans un champ vaut le bouton d'action de l'étape, comme dans un formulaire.
   * Les étapes n'en sont pas un : les formulaires qu'elles embarquent (ajout de compte,
   * consignes) ont le leur, et deux formulaires ne s'imbriquent pas. Un champ posé dans
   * l'un d'eux garde donc son propre bouton. Dans une zone de texte, Entrée reste un
   * retour à la ligne.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (['checkbox', 'radio', 'range', 'button', 'submit'].includes(target.type)) return
    if (target.closest('form')) return
    event.preventDefault()
    if (canContinue && !pending) onNext()
  }

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink md:grid md:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface p-5 md:flex">
        <div className="flex items-center gap-3">
          <span className="gradient-accent shadow-float grid size-9 place-items-center rounded-xl">
            <Logo size={20} className="text-accent-ink" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Solera</span>
            <span className="block text-xs text-ink-faint">{t('onboarding.shell.subtitle')}</span>
          </span>
        </div>
        <ol className="flex flex-col gap-0.5">
          {steps.map((step, i) => (
            <li key={step.id}>
              {/* Ligne entièrement cliquable : elle porte son état, un `Button` y
                  mettrait un cadre dans un cadre. */}
              <button
                type="button"
                // On ne saute pas vers l'inconnu : une étape future peut dépendre de celle-ci.
                disabled={!step.reachable || i === index}
                aria-current={step.status === 'current' ? 'step' : undefined}
                onClick={() => onGoto(i)}
                className={cx(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-default',
                  step.status === 'current'
                    ? 'bg-accent-wash text-ink'
                    : step.status === 'todo'
                      ? 'text-ink-faint'
                      : 'text-ink-soft hover:bg-surface-high',
                )}
              >
                <span
                  className={cx(
                    'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                    step.status === 'done'
                      ? 'border-positive bg-positive text-accent-ink'
                      : step.status === 'current'
                        ? 'border-accent text-accent'
                        : step.status === 'skipped'
                          ? 'border-dashed border-line-strong'
                          : 'border-line-strong',
                  )}
                >
                  {step.status === 'done' ? <Check size={13} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{step.title}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {step.status === 'skipped' ? t('onboarding.shell.skipped') : step.sub}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-auto text-xs leading-relaxed text-ink-faint">{t('onboarding.shell.foot')}</p>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Téléphone : la progression en tête, l'étape nommée. La marge de l'encoche
            s'ajoute à celle du bloc. */}
        <div
          className="flex shrink-0 flex-col gap-2 px-4 md:hidden"
          style={{ paddingTop: 'calc(0.75rem + var(--sg-safe-top))' }}
        >
          <div className="flex items-center gap-2">
            <span className="gradient-accent grid size-7 place-items-center rounded-lg">
              <Logo size={15} className="text-accent-ink" />
            </span>
            <span className="text-sm font-semibold">{t('onboarding.shell.subtitle')}</span>
            <span className="ml-auto flex items-center gap-2">
              <LanguageSwitch />
              {skipAllowed ? (
                <Button variant="ghost" size="sm" onClick={onSkipAll}>
                  {t('onboarding.shell.skip.short')}
                </Button>
              ) : null}
            </span>
          </div>
          <div className="flex gap-1" aria-hidden>
            {steps.map((step, i) => (
              <i key={step.id} className={cx('block h-0.5 flex-1 rounded-full', i <= index ? 'bg-accent' : 'bg-line')} />
            ))}
          </div>
          <p className="text-xs text-ink-faint">
            {t('onboarding.shell.progress', { step: index + 1, total: steps.length, title: current?.title ?? '' })}
          </p>
        </div>

        <div className="hidden shrink-0 px-6 pt-3 md:block">
          <div className="flex w-full items-center justify-end gap-3">
            <LanguageSwitch />
            {skipAllowed ? (
              <Button variant="ghost" size="sm" onClick={onSkipAll} icon={<X size={14} />}>
                {t('onboarding.shell.skip')}
              </Button>
            ) : null}
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-14 md:py-2" onKeyDown={onKeyDown}>
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-6">{children}</div>
        </main>

        <footer
          className="shrink-0 border-t border-line bg-surface px-4 pt-3 md:px-14"
          style={{ paddingBottom: 'calc(0.75rem + var(--sg-safe-bottom))' }}
        >
          {/* Sur toute la largeur, les boutons aux coins : c'est là qu'on les cherche. */}
          <div className="flex w-full items-center gap-2">
            {first ? null : (
              <Button variant="secondary" onClick={onBack} disabled={pending} icon={<ArrowLeft size={15} />}>
                <span className="hidden sm:inline">{t('onboarding.shell.back')}</span>
              </Button>
            )}
            {error ? <span className="min-w-0 truncate text-xs text-critical">{error}</span> : null}
            <span className="flex-1" />
            {laterAllowed && !last ? (
              <Button variant="ghost" onClick={onLater} disabled={pending}>
                {t('onboarding.shell.later')}
              </Button>
            ) : null}
            <Button onClick={onNext} disabled={pending || !canContinue} icon={last ? undefined : <ArrowRight size={15} />}>
              {nextLabel}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
