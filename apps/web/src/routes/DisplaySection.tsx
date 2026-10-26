import { Card, SwitchRow } from '@solera/ui'
import { SectionHeader } from '../components/settings/SectionHeader'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { setDisplay, useDisplaySettings, type DisplayKey } from '../lib/display-settings'

/**
 * *Affichage* : ce que la colonne de gauche montre.
 *
 * Deux listes et une règle. Les lieux d'abord — *Fils* et *Projets* ne se décrochent
 * pas, les quatre autres oui — puis les trois détails qui font la densité de la
 * colonne. La règle est écrite en tête parce qu'elle seule rend ces interrupteurs
 * inoffensifs : ce qu'on retire de la colonne reste joignable par la palette.
 */

interface Toggle {
  name: DisplayKey
  labelKey: MessageKey
  descriptionKey: MessageKey
}

/** Les lieux figés, qui n'ont pas d'interrupteur : la palette y renvoie, eux restent. */
const PINNED: { labelKey: MessageKey; descriptionKey: MessageKey }[] = [
  { labelKey: 'display.place.threads', descriptionKey: 'display.place.threads.description' },
  { labelKey: 'display.place.projects', descriptionKey: 'display.place.projects.description' },
]

const PLACES: Toggle[] = [
  {
    name: 'knowledge',
    labelKey: 'display.place.knowledge',
    descriptionKey: 'display.place.knowledge.description',
  },
  {
    name: 'schedules',
    labelKey: 'display.place.schedules',
    descriptionKey: 'display.place.schedules.description',
  },
  {
    name: 'skills',
    labelKey: 'display.place.skills',
    descriptionKey: 'display.place.skills.description',
  },
  {
    name: 'services',
    labelKey: 'display.place.services',
    descriptionKey: 'display.place.services.description',
  },
]

const DETAILS: Toggle[] = [
  {
    name: 'activity',
    labelKey: 'display.detail.activity',
    descriptionKey: 'display.detail.activity.description',
  },
  {
    name: 'sessionAge',
    labelKey: 'display.detail.sessionAge',
    descriptionKey: 'display.detail.sessionAge.description',
  },
  {
    name: 'projectDot',
    labelKey: 'display.detail.projectDot',
    descriptionKey: 'display.detail.projectDot.description',
  },
]

export function DisplaySection() {
  const t = useTranslate()
  const values = useDisplaySettings()

  const switches = (toggles: Toggle[]) =>
    toggles.map((toggle) => (
      <SwitchRow
        key={toggle.name}
        checked={values[toggle.name]}
        onCheckedChange={(next) => setDisplay(toggle.name, next)}
        label={t(toggle.labelKey)}
        description={t(toggle.descriptionKey)}
      />
    ))

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.section.display')} description={t('display.rule')} />

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-sm font-medium text-ink">{t('display.places')}</h3>
        <Card className="flex flex-col gap-0.5 p-1.5">
          {PINNED.map((place) => (
            <div
              key={place.labelKey}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 wrap-anywhere">
                <span className="block text-sm text-ink">{t(place.labelKey)}</span>
                <span className="mt-0.5 block text-meta text-ink-faint">
                  {t(place.descriptionKey)}
                </span>
              </span>
              {/* Un interrupteur grisé se tente quand même ; un mot dit pourquoi
                  il n'y en a pas. */}
              <span className="shrink-0 text-meta text-ink-faint">{t('display.always')}</span>
            </div>
          ))}
          {switches(PLACES)}
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-sm font-medium text-ink">{t('display.details')}</h3>
        <Card className="flex flex-col gap-0.5 p-1.5">{switches(DETAILS)}</Card>
      </section>
    </div>
  )
}
