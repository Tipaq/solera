import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bot, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Select, type SelectOption } from './Select'

const AGENTS: SelectOption<string>[] = [
  { value: 'claude', label: 'Claude Code', icon: <Sparkles size={15} />, hint: 'Agent SDK' },
  { value: 'codex', label: 'Codex', icon: <Bot size={15} />, hint: 'app-server' },
  { value: 'gemini', label: 'Gemini CLI', icon: <Bot size={15} />, disabled: true },
]

const meta = {
  title: 'Primitives/Select',
  parameters: {
    docs: {
      description: {
        component:
          "Un choix parmi beaucoup, avec icône et ligne d'aide par option — ce qu'un `<option>` natif ne sait pas porter. Radix fournit la navigation clavier, le rôle `listbox` et le comportement tactile.\n\nUne option momentanément impossible reste **affichée et désactivée** plutôt que retirée : la voir grisée dit qu'elle existe et qu'elle reviendra.\n\nEn dessous d'une demi-douzaine d'options qui portent chacune une explication, c'est `ChoiceList` qu'il faut.",
      },
    },
  },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

function Demo() {
  const [value, setValue] = useState('claude')
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Select label="CLI" value={value} onChange={setValue} options={AGENTS} className="w-64" />
      <Select value={value} onChange={setValue} options={AGENTS} disabled className="w-48" />
    </div>
  )
}

export const Defaut: Story = {
  name: 'Par défaut',
  render: () => <Demo />,
}
