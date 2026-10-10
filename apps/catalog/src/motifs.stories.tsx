import type { Meta, StoryObj } from '@storybook/react-vite'
import { Eye, FileText, Globe, Pencil, WrapText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Banner, cx } from '@solera/ui'

/**
 * Motifs recopiés à la main, montrés **avec leurs divergences, côte à côte**.
 *
 * C'est la seule chose utile qu'un catalogue puisse faire d'un motif qui a dérivé : mis
 * en face l'un de l'autre, trois onglets qui se croient identiques cessent de passer en
 * revue. Dans l'application, le défaut est invisible — les trois copies vivent sur trois
 * écrans différents.
 *
 * Les classes sont donc recopiées ici **telles qu'elles sont dans le code**, et non
 * nettoyées en passant : une vitrine qui montre la version idéale d'un motif cassé ne
 * sert à rien.
 *
 * Les démos à état sont des composants nommés et non des fonctions `render` anonymes :
 * un hook appelé dans `render` fait échouer `react-hooks/rules-of-hooks`, et la règle a
 * raison — c'est bien un composant, il doit donc porter un nom de composant.
 */
const meta = {
  title: 'Motifs/Non alignés',
  parameters: {
    docs: {
      description: {
        component:
          "Des chaînes de classes recopiées à la main, qui devraient être des primitives et ne le sont pas. Montrées telles qu'elles sont dans le code — **cette section est un chantier, pas une référence**.",
      },
    },
  },
} satisfies Meta
export default meta

type Story = StoryObj<typeof meta>

function Specimen({ name, where, children }: { name: string; where: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {children}
      <span className="flex flex-wrap items-baseline gap-x-2">
        <code className="font-mono text-meta text-ink-soft">{name}</code>
        <code className="font-mono text-meta text-ink-faint">{where}</code>
      </span>
    </div>
  )
}

const RAIL = 'flex gap-1 rounded-lg bg-sunken p-1'

function SegmentedDemo() {
  const [small, setSmall] = useState(false)
  const [large, setLarge] = useState<'project' | 'global'>('project')

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Banner tone="caution">
        Trois copies sans primitive : <code>CardEditor</code>, <code>Instructions</code> (deux
        fois). Les trois portent le même habillage, à la taille près — c'est donc le motif le
        plus mûr pour devenir un composant.
      </Banner>

      <Specimen name="px-2.5 py-1.5 text-xs" where="CardEditor · Instructions">
        <div className={RAIL}>
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={small === value}
              onClick={() => setSmall(value)}
              className={cx(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs',
                small === value ? 'surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
              )}
            >
              {value ? <Eye size={13} /> : <Pencil size={13} />}
              {value ? 'Aperçu' : 'Écrire'}
            </button>
          ))}
        </div>
      </Specimen>

      <Specimen name="px-3 py-1.5 text-sm" where="Instructions (dialogue)">
        <div className={RAIL}>
          {(['project', 'global'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={large === value}
              onClick={() => setLarge(value)}
              className={cx(
                'rounded-md px-3 py-1.5 text-sm',
                large === value ? 'surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink',
              )}
            >
              {value === 'project' ? 'Projet' : 'Global'}
            </button>
          ))}
        </div>
      </Specimen>

      <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-xs text-ink-faint">
        <p>
          <code className="text-ink-soft">shadow-sm</code> — l'ombre brute de Tailwind au lieu de{' '}
          <code className="text-ink-soft">shadow-card</code>. Elle ne disparaît donc pas sur le
          thème contrasté, dont c'est pourtant la règle.
        </p>
        <p>
          <code className="text-ink-soft">py-1.5</code> — environ 30 px de haut, sous la cible
          tactile de 44 px, pour un contrôle qu'on touche.
        </p>
      </div>
    </div>
  )
}

/** Trois copies, habillage identique à la taille près. */
export const ControleSegmente: Story = {
  name: 'Contrôle segmenté',
  render: () => <SegmentedDemo />,
}

const TAB_LABELS = ['Ensemble', 'À débloquer', 'Non lues']

function TabsDemo() {
  const [a, setA] = useState(0)
  const [b, setB] = useState(0)
  const [c, setC] = useState(0)

  return (
    <div className="flex max-w-2xl flex-col gap-7">
      <Banner tone="caution">
        Trois traitements actifs — <code>font-semibold text-ink</code>, <code>text-ink</code>,{' '}
        <code>text-accent</code> — et trois hauteurs : 44, 44, 48 px.
      </Banner>

      <Specimen
        name="border-accent font-semibold text-ink"
        where="SidebarActivity · min-h-11 · text-xs"
      >
        <div className="flex gap-1 border-b border-line" role="group">
          {TAB_LABELS.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={a === index}
              onClick={() => setA(index)}
              className={cx(
                'flex min-h-11 flex-1 items-center justify-center gap-2 border-b-2 px-1 py-2 text-xs transition-colors',
                a === index
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Specimen>

      <Specimen name="border-accent text-ink" where="SkillsControl · min-h-11 · text-sm">
        <div className="flex gap-2" role="group">
          {TAB_LABELS.slice(0, 2).map((label, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={b === index}
              onClick={() => setB(index)}
              className={cx(
                'min-h-11 flex-1 border-b-2 px-2 text-sm',
                b === index
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Specimen>

      <Specimen
        name="border-accent text-accent"
        where="CardPanel · min-h-12 · text-sm font-medium"
      >
        <nav className="flex gap-5 border-b border-line" aria-label="Sections">
          {TAB_LABELS.slice(0, 2).map((label, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={c === index}
              onClick={() => setC(index)}
              className={cx(
                'flex min-h-12 items-center gap-2 border-b-2 text-sm font-medium transition-colors',
                c === index
                  ? 'border-accent text-accent'
                  : 'border-transparent text-ink-faint hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </Specimen>

      <p className="text-xs text-ink-faint">
        Souligner en accent <em>et</em> colorer le texte en accent dit deux fois la même chose :
        l'un des deux suffit.
      </p>
    </div>
  )
}

/** Trois copies, trois traitements actifs, trois hauteurs. */
export const Onglets: Story = { render: () => <TabsDemo /> }

const ROW_ACTIVE = [
  ['bg-accent-wash font-medium text-ink', 'AppShell · navigation'],
  ['bg-accent-wash text-ink', 'QuickOpen · MentionPicker · TokenPicker'],
  ['bg-accent-wash text-accent', 'SidebarActivity · SidePanel'],
  ['bg-surface-high text-ink', 'CommandPalette'],
] as const

/** Quatre réponses à « cette ligne est sélectionnée », dont une qui pose un vrai problème. */
export const LigneSelectionnee: Story = {
  name: 'Ligne de liste sélectionnée',
  render: () => (
    <div className="flex max-w-2xl flex-col gap-6">
      <Banner tone="caution">
        Trois partent du lavis d'accent et diffèrent sur le texte. Le quatrième prend{' '}
        <code>surface-high</code>, qui est la couleur du survol — un élément sélectionné y
        ressemble donc à un élément survolé.
      </Banner>

      {ROW_ACTIVE.map(([active, where]) => (
        <Specimen key={active} name={active} where={where}>
          <ul className="flex w-64 flex-col gap-1 rounded-md border border-line bg-surface p-1">
            {['tokens.css', 'index.css'].map((label, index) => (
              <li key={label}>
                <span
                  className={cx(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm',
                    index === 0 ? active : 'text-ink-soft hover:bg-surface-high',
                  )}
                >
                  <FileText size={14} className="shrink-0 text-ink-faint" />
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </Specimen>
      ))}
    </div>
  ),
}

const TOGGLE_ACTIVE = [
  ['bg-surface-high text-ink', 'CodeBlock'],
  ['bg-accent-wash text-ink', 'ToolCall'],
  ['bg-accent-wash text-accent', 'SidePanel'],
] as const

/** Même question que la ligne de liste, trois réponses de plus. */
export const BasculeOutil: Story = {
  name: "Bascule de barre d'outils",
  render: () => (
    <div className="flex max-w-2xl flex-col gap-6">
      <Banner tone="caution">
        À trancher en même temps que la ligne de liste, puisque c'est le même problème.
      </Banner>
      <div className="flex flex-wrap gap-6">
        {TOGGLE_ACTIVE.map(([active, where]) => (
          <Specimen key={active} name={active} where={where}>
            <span className="flex gap-1 rounded-md border border-line bg-surface p-1">
              <span className={cx('flex size-7 items-center justify-center rounded-md', active)}>
                <WrapText size={13} />
              </span>
              <span className="flex size-7 items-center justify-center rounded-md text-ink-faint">
                <Globe size={13} />
              </span>
            </span>
          </Specimen>
        ))}
      </div>
    </div>
  ),
}

const DOTS = [
  ['size-1.5', "Posée dans le coin d'une icône"],
  ['size-2.5', "Dans une ligne, à côté d'un libellé"],
  ['size-3', 'Légende de couleur, échantillon'],
] as const

/** Le seul motif de cette section qui n'a pas dérivé. */
export const Pastilles: Story = {
  name: "Pastilles d'état",
  render: () => (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-end gap-6">
        {DOTS.map(([size, role]) => (
          <Specimen key={size} name={`${size} rounded-full`} where={role}>
            <span className="flex h-6 items-center">
              <span className={cx('rounded-full bg-accent', size)} />
            </span>
          </Specimen>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {(['bg-accent', 'bg-positive', 'bg-caution', 'bg-critical', 'bg-loop'] as const).map(
          (tone) => (
            <span key={tone} className="flex items-center gap-1.5">
              <span className={cx('size-2.5 rounded-full', tone)} />
              <code className="font-mono text-meta text-ink-faint">{tone}</code>
            </span>
          ),
        )}
      </div>
      <p className="text-xs text-ink-faint">
        Une pastille ne porte jamais d'information seule : elle double un libellé ou un intitulé
        accessible, parce que la couleur ne se lit pas pour tout le monde.
      </p>
    </div>
  ),
}
