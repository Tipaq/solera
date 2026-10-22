import type { TurnCheckpoint } from '../../lib/chat-fold'

/** Un tour capturé, tel que le replie `chat-fold` : partagé par les stories du fil et du panneau. */
export const turnCheckpoint: TurnCheckpoint = {
  key: '3f6c2a1e-9b7d-4c55-8e21-7a0d4b9c1f30',
  seq: 41,
  openerId: 'msg_1',
  openerText: 'Ajoute une entrée au CHANGELOG et retire la fixture périmée.',
  status: 'ready',
  files: [
    { path: 'CHANGELOG.md', oldPath: null, kind: 'added', added: 3, removed: null },
    { path: 'README.md', oldPath: null, kind: 'modified', added: 2, removed: 1 },
    { path: 'src/lib/forecast.ts', oldPath: null, kind: 'deleted', added: null, removed: 48 },
    { path: 'src/lib/cache.ts', oldPath: 'src/lib/store.ts', kind: 'renamed', added: 4, removed: 4 },
  ],
  truncated: false,
  excluded: 0,
  reason: null,
  restored: false,
}
