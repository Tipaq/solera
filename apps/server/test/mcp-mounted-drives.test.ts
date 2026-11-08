import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { attachments, cards, conversations, events, openDatabase, projectImages, projects, runMigrations, users } from '@solera/db'

/**
 * Le serveur MCP tourne sur l'hôte, la session dans un conteneur : sous Windows natif,
 * elle voit `C:\…` en `/mnt/c/…`, et le `.mjs` traduit ce qu'il échange avec elle (#153).
 * Les chemins de la base sont donc ici ceux d'un hôte Windows.
 */
function harness(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'solera-mounted-drives-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({
    id: 'project', name: 'project', workspacePath: 'C:\\Users\\me\\project', ownerId: 'owner', visibility: 'private', createdAt: 1,
  }).run()
  for (const id of ['me', 'other']) {
    db.insert(conversations).values({
      id, projectId: 'project', userId: 'owner', title: `Session ${id}`, agent: 'claude', config: '{}', status: 'idle',
      createdAt: 1, updatedAt: Date.now(),
    }).run()
  }
  db.insert(cards).values({ id: 'card', projectId: 'project', number: 1, title: 'Carte', column: 'todo', createdBy: 'owner', createdAt: 1, updatedAt: 1 }).run()
  db.insert(attachments).values({
    id: 'file', cardId: 'card', userId: 'owner', filename: 'brief.md', mimeType: 'text/markdown', sizeBytes: 1,
    storagePath: 'C:\\Users\\me\\.solera\\attachments\\file', createdAt: 1,
  }).run()
  db.insert(events).values({
    conversationId: 'other', seq: 1, ts: Date.now(), type: 'file.edited',
    payload: JSON.stringify({ type: 'file.edited', path: 'C:\\Users\\me\\project\\src\\a.ts', action: 'modified' }),
  }).run()

  const call = (name: string, args: object, mountedDrives = true) => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: {
        ...process.env,
        SOLERA_MCP_DB: dbPath,
        SOLERA_MCP_PROJECT: 'project',
        SOLERA_MCP_CONVERSATION: 'me',
        ...(mountedDrives ? { SOLERA_MCP_MOUNTED_DRIVES: '1' } : {}),
      },
      // Les chemins d'un hôte Windows se résolvent ici depuis ce dossier : `C:\\…` y est un nom de fichier.
      cwd: dir,
      encoding: 'utf8',
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n',
      timeout: 10000,
    })
    assert.equal(child.status, 0, child.stderr)
    return (JSON.parse(child.stdout).result as { content: { text: string }[] }).content[0]!.text
  }
  return { db, dir, call }
}

test("read_card rend les pièces jointes au chemin que le conteneur voit", (t) => {
  const { call } = harness(t)
  const text = call('read_card', { number: 1 })
  assert.ok(text.includes('/mnt/c/Users/me/.solera/attachments/file'), text)
  assert.ok(!text.includes('C:\\\\'), "aucun chemin de l'hôte")

  // Sans le drapeau, la session voit les chemins de l'hôte : rien ne se traduit.
  assert.ok(call('read_card', { number: 1 }, false).includes('C:\\\\Users\\\\me\\\\.solera\\\\attachments\\\\file'))
})

test("find_file_edits lit un chemin du conteneur, et le rend tel", (t) => {
  const { call } = harness(t)
  const text = call('find_file_edits', { path: '/mnt/c/Users/me/project/src/a.ts' })
  assert.match(text, /- \/mnt\/c\/Users\/me\/project\/src\/a\.ts \| modifié/)
  assert.match(text, /par other/)

  const all = call('find_file_edits', {})
  assert.ok(all.includes('/mnt/c/Users/me/project/src/a.ts'), all)
})

test("set_project_image lit sur l'hôte le fichier que la session nomme", (t) => {
  const { db, dir, call } = harness(t)
  // Sous Linux, `C:\Users\me\logo.png` résolu depuis `dir` est ce nom de fichier-là :
  // le lire, c'est avoir lu le chemin de l'hôte et non celui du conteneur.
  writeFileSync(join(dir, 'C:\\Users\\me\\logo.png'), Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))

  assert.match(call('set_project_image', { path: '/mnt/c/Users/me/logo.png' }), /Image du projet mise à jour/)
  assert.equal(db.select().from(projectImages).where(eq(projectImages.projectId, 'project')).get()?.mimeType, 'image/png')

  // Sans le drapeau, `/mnt/c/…` est lu tel quel, et n'existe pas.
  assert.match(call('set_project_image', { path: '/mnt/c/Users/me/logo.png' }, false), /Lecture de \/mnt\/c\/Users\/me\/logo\.png impossible/)
})
