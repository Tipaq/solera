import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Banner, SaveBar, SegmentedControl, Switch } from '@solera/ui'
import { SettingsPage, type SettingsCategory } from './SettingsPage'
import type { SettingItem } from './SettingRow'

const CATEGORIES: SettingsCategory[] = [
  { key: 'general', label: 'Général' },
  { key: 'agents', label: 'Agents' },
  { key: 'danger', label: 'Zone de danger', danger: true },
]

const input = 'h-9 w-full rounded-md border border-line bg-sunken px-3 text-sm text-ink outline-none focus:border-accent'

/** Une page de démonstration : trois réglages dans un brouillon, le reste pour défiler. */
function Demo({ readOnly = false }: { readOnly?: boolean }) {
  const [saved, setSaved] = useState({ name: 'Nimbus', visibility: 'private', checkpoints: true })
  const [draft, setDraft] = useState(saved)
  const changed = (Object.keys(saved) as (keyof typeof saved)[]).filter((key) => draft[key] !== saved[key])
  const items: SettingItem[] = [
    {
      id: 'name', category: 'general', group: 'Identité', label: 'Nom', kind: 'row', disabled: readOnly,
      help: 'Affiché dans la bande, la sidebar et le portefeuille.', changed: changed.includes('name'),
      render: () => <input aria-label="Nom" className={input} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />,
    },
    {
      id: 'visibility', category: 'general', group: 'Identité', label: 'Visibilité', kind: 'row', disabled: readOnly,
      help: 'Privé : toi seul. Partagé : les membres de l’instance le voient.', changed: changed.includes('visibility'),
      render: () => (
        <SegmentedControl
          label="Visibilité"
          value={draft.visibility}
          onChange={(visibility) => setDraft({ ...draft, visibility })}
          segments={[{ value: 'private', label: 'Privé' }, { value: 'shared', label: 'Partagé' }]}
        />
      ),
    },
    {
      id: 'cap', category: 'general', group: 'Identité', label: 'Cap', kind: 'block', disabled: readOnly,
      help: 'Une phrase, facultative : où va le projet.',
      render: () => <textarea aria-label="Cap" rows={2} className={`${input} h-auto py-2`} />,
    },
    {
      id: 'checkpoints', category: 'general', group: 'Exécution', label: 'Points de reprise par tour', kind: 'row', disabled: readOnly,
      help: 'Capture le workspace avant et après chaque tour.', changed: changed.includes('checkpoints'),
      render: () => <Switch label="Points de reprise par tour" checked={draft.checkpoints} onCheckedChange={(checkpoints) => setDraft({ ...draft, checkpoints })} />,
    },
    {
      id: 'memory', category: 'agents', group: 'Ce que les agents savent', label: 'Mémoire', kind: 'block',
      help: 'Les notes que les agents gardent d’une session à l’autre.',
      render: () => <p className="text-sm text-ink-faint">Aucune note pour l’instant.</p>,
    },
    {
      id: 'remove', category: 'danger', group: 'Irréversible', label: 'Retirer le projet', kind: 'row',
      help: 'Retirer le projet supprime ses conversations.',
      render: () => <span className="text-sm text-critical">Retirer le projet</span>,
    },
  ]
  return (
    <div className="h-[36rem] border border-line bg-canvas">
      <SettingsPage
        categories={readOnly ? CATEGORIES.slice(0, 2) : CATEGORIES}
        items={readOnly ? items.filter((item) => item.category !== 'danger') : items}
        notice={readOnly ? <div className="pt-4"><Banner tone="info">Projet partagé par Alex. Seul son propriétaire peut le modifier.</Banner></div> : null}
        footer={
          <SaveBar
            count={changed.length}
            labels={{ pending: `${changed.length} modification${changed.length > 1 ? 's' : ''} non enregistrée${changed.length > 1 ? 's' : ''}`, cancel: 'Annuler', save: 'Enregistrer' }}
            onCancel={() => setDraft(saved)}
            onSave={() => setSaved(draft)}
          />
        }
      />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Page de réglages à menu gauche",
  component: Demo,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Une page de réglages qui défile d'un bloc, son menu à gauche (page projet v2, R-1 et R-2). Les catégories en texte, celle qu'on lit en pilule teintée ; leurs groupes le long d'un rail, celui qu'on lit en accent avec un trait épais ; un point sur une catégorie qui a des modifications en attente ; la Zone de danger à part, en bas.\n\nChaque groupe tient ses rangées dans **une seule surface légère** : libellé et aide sur 22 rem, contrôle plafonné à 36 rem, empilés au téléphone, où un sélecteur « Catégorie › Groupe » remplace le menu. La loupe ou la touche `/` ouvrent la recherche ; choisir un résultat amène le réglage au centre et le surligne.\n\nLa page ne sait rien du brouillon : chaque réglage dit s'il est `changed`, et la `SaveBar` arrive par `footer`.",
      },
    },
  },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

/** Le propriétaire : tout se règle, la Zone de danger en bas du menu. */
export const Proprietaire: Story = { name: 'Propriétaire' }

/** Un projet partagé : la bannière en tête, les contrôles éteints, ni Zone de danger. */
export const Partage: Story = { name: 'Projet partagé', args: { readOnly: true } }
