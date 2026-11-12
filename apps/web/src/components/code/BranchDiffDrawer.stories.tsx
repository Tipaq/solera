import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { CompareDto } from '@solera/protocol'
import { Button } from '@solera/ui'
import { compareKey } from '../../lib/worktrees'
import { DrawerLayer } from '../shell/Drawer'
import { BranchDiffDrawer } from './BranchDiffDrawer'

const PROJECT = 'demo'
const BASE = 'main'

const PATCH = `diff --git a/apps/server/src/workspace.ts b/apps/server/src/workspace.ts
index 1111111..2222222 100644
--- a/apps/server/src/workspace.ts
+++ b/apps/server/src/workspace.ts
@@ -80,6 +80,14 @@ export function projectWorkspace(db: Db, projectId: string, userId: string): string {
   return row.workspacePath
 }

+/** Dossier d'un worktree dont ce compte voit le projet. */
+export function worktreeWorkspace(db: Db, worktreeId: string, userId: string): string {
+  const row = readWorktree(db, worktreeId)
+  if (!row) throw notFound('worktree_not_found', 'Worktree not found.')
+  return row.path
+}
+
 /**
  * Dossier visé par le brouillon d'une conversation.
diff --git a/apps/web/src/lib/workspace-scope.ts b/apps/web/src/lib/workspace-scope.ts
index 3333333..4444444 100644
--- a/apps/web/src/lib/workspace-scope.ts
+++ b/apps/web/src/lib/workspace-scope.ts
@@ -12,3 +12,6 @@ const PROJECT_PREFIX = 'project:'
 export const projectScope = (projectId: string): WorkspaceScope =>
   \`\${PROJECT_PREFIX}\${projectId}\`
-
+
+export const worktreeScope = (worktreeId: string): WorkspaceScope =>
+  \`worktree:\${worktreeId}\`
`

const DIFF: CompareDto = {
  files: [
    { path: 'apps/server/src/workspace.ts', added: 8, removed: 0 },
    { path: 'apps/web/src/lib/workspace-scope.ts', added: 4, removed: 1 },
  ],
  patch: PATCH,
  truncated: false,
  ahead: 3,
  behind: 4,
}

const EMPTY: CompareDto = { files: [], patch: '', truncated: false, ahead: 0, behind: 2 }

/** Le tiroir sur une zone de lieu, la réponse du serveur déjà en cache. */
function Place({ branch, data }: { branch: string; data: CompareDto }) {
  const client = useQueryClient()
  useState(() => client.setQueryData(compareKey(PROJECT, BASE, branch), data))
  const [open, setOpen] = useState(true)
  return (
    <div className="flex h-[36rem] flex-col border border-line">
      <div className="h-11 shrink-0 border-b border-line" />
      <div className="relative flex min-h-0 flex-1 overflow-clip">
        <div className="min-w-0 flex-1 p-4 md:p-6">
          <Button size="sm" onClick={() => setOpen(true)}>Diff avec la base</Button>
        </div>
        <DrawerLayer />
      </div>
      <BranchDiffDrawer projectId={PROJECT} base={BASE} branch={branch} open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Code/Diff avec la base",
  component: Place,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Place>

export default meta
type Story = StoryObj<typeof meta>

/** Ce que la branche apporte : ses fichiers, dépliables sur leur patch ; ↑ avance, ↓ retard. */
export const Diff: Story = { args: { branch: 'feat/169-portee-worktree-diff', data: DIFF } }

/** Une branche déjà fusionnée par squash, ou jamais commitée : rien à montrer. */
export const Vide: Story = { args: { branch: 'feat/deja-fusionnee', data: EMPTY } }
