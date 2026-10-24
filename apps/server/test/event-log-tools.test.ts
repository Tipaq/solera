import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { EventLog } from '../src/events/event-log.js'

test('rawOfTool : le dernier natif non vide de chaque sorte, dans sa seule conversation', () => {
  const { db, sqlite } = openDatabase(':memory:')
  try {
    runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
    db.insert(users).values({ id: 'u', username: 'u', displayName: 'u', passwordHash: '', createdAt: 1 }).run()
    db.insert(projects).values({ id: 'p', name: 'Test', workspacePath: '/tmp', ownerId: 'u', visibility: 'private', createdAt: 1 }).run()
    for (const id of ['one', 'two']) db.insert(conversations).values({
      id, projectId: 'p', userId: 'u', title: id, agent: 'codex', config: '{}', status: 'idle', createdAt: 1, updatedAt: 1,
    }).run()
    const log = new EventLog(db)
    const started = (toolCallId: string) => ({ type: 'tool.started' as const, toolCallId, name: 'Edit', input: {}, parentToolCallId: null })
    const completed = (toolCallId: string) => ({ type: 'tool.completed' as const, toolCallId, output: '', isError: false, durationMs: 1 })

    log.append('one', started('edit'), { before: 'original' })
    log.append('one', completed('edit'), { after: 'first' })
    log.append('one', completed('other'), { after: 'unrelated' })
    // Un identifiant réutilisé peut répéter l'une ou l'autre sorte ; un `raw` absent
    // n'efface pas le dernier natif disponible (comportement de l'ancienne lecture).
    log.append('one', started('edit'), { before: 'first' })
    log.append('one', completed('edit'), { after: 'second' })
    log.append('one', started('edit'))
    log.append('one', completed('edit'))
    log.append('two', started('edit'), { before: 'another conversation' })
    log.append('two', completed('edit'), { after: 'another conversation' })
    assert.deepEqual(log.rawOfTool('one', 'edit'), { started: { before: 'first' }, completed: { after: 'second' } })
    assert.deepEqual(log.rawOfTool('one', 'absent'), { started: null, completed: null })
    assert.deepEqual(log.rawOfTool('absent', 'edit'), { started: null, completed: null })
    assert.deepEqual(log.rawOfTool('one', 'other'), { started: null, completed: { after: 'unrelated' } })

    // Un `null` JSON explicite est une valeur native, et remplace le résultat précédent.
    const last = log.append('one', completed('edit'), null)
    assert.deepEqual(log.rawOfTool('one', 'edit'), { started: { before: 'first' }, completed: null })
    // Les chaînes SQL vides d'avant étaient ignorées elles aussi, indépendamment du `null` JSON.
    sqlite.prepare("update events set raw = '' where conversation_id = ? and seq = ?").run('one', last.seq)
    assert.deepEqual(log.rawOfTool('one', 'edit'), { started: { before: 'first' }, completed: { after: 'second' } })
  } finally {
    sqlite.close()
  }
})
