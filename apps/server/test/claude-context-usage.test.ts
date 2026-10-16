import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import { CONTEXT_DETAIL_MAX_ROWS, soleraEventSchema } from '@solera/protocol'
import { contextBreakdown, contextWindow } from '../src/agents/claude/context-usage.js'

/**
 * Le socle est copié d'une réponse réellement observée (CLI 2.1.273, `claude-opus-5[1m]`,
 * tour d'un seul message) : les champs que le SDK déclare mais que ce CLI n'a pas
 * renvoyés — `systemTools`, `systemPromptSections`, `deferredBuiltinTools` — sont donc
 * absents ici aussi, et c'est exactement ce que la lecture doit tolérer.
 */
const response = (fields: Record<string, unknown> = {}): SDKControlGetContextUsageResponse =>
  ({
    model: 'claude-opus-5[1m]',
    totalTokens: 19_813,
    maxTokens: 1_000_000,
    rawMaxTokens: 1_000_000,
    percentage: 2,
    isAutoCompactEnabled: true,
    autoCompactThreshold: 967_000,
    categories: [
      { name: 'System tools', tokens: 4618, color: 'inactive', kind: 'used' },
      { name: 'MCP tools (deferred)', tokens: 8057, color: 'inactive', isDeferred: true, kind: 'deferred' },
      { name: 'Memory files', tokens: 44, color: 'claude', kind: 'used' },
      { name: 'Skills', tokens: 5463, color: 'warning', kind: 'used' },
      { name: 'Messages', tokens: 9688, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', kind: 'buffer' },
      { name: 'Free space', tokens: 947_187, color: 'promptBorder', kind: 'free' },
    ],
    memoryFiles: [{ path: '/w/CLAUDE.md', type: 'Project', tokens: 44 }],
    mcpTools: [
      { name: 'mcp__solera__read_card', serverName: 'solera', tokens: 310, isLoaded: false },
      { name: 'mcp__solera__list_cards', serverName: 'solera', tokens: 120, isLoaded: false },
    ],
    agents: [{ agentType: 'Explore', source: 'projectSettings', tokens: 220 }],
    skills: {
      totalSkills: 2,
      includedSkills: 2,
      tokens: 5463,
      skillFrontmatter: [
        { name: 'dataviz', source: 'built-in', tokens: 482 },
        { name: 'solera:pr', source: 'plugin', pluginName: 'solera', tokens: 0 },
      ],
    },
    gridRows: [],
    apiUsage: null,
    ...fields,
  }) as unknown as SDKControlGetContextUsageResponse

test('le relevé de contexte devient un détail par catégorie, et un événement valide', () => {
  const breakdown = contextBreakdown(response())
  assert.equal(breakdown.axis, 'categories')
  if (breakdown.axis !== 'categories') return

  // Les quatre lignes `used` tombent sur `totalTokens`, et `used + buffer + free` sur la
  // fenêtre : c'est l'invariant qui permet d'afficher les parts sans les recalculer.
  const sum = (kind: string) =>
    breakdown.categories.filter((row) => row.kind === kind).reduce((n, row) => n + row.tokens, 0)
  assert.equal(sum('used'), 19_813)
  assert.equal(sum('used') + sum('buffer') + sum('free'), 1_000_000)
  // Les lignes hors fenêtre sont gardées, et restent hors du calcul.
  assert.equal(sum('deferred'), 8057)

  assert.deepEqual(breakdown.memoryFiles, [{ name: '/w/CLAUDE.md', source: 'Project', tokens: 44 }])
  assert.deepEqual(breakdown.mcpTools, [
    { name: 'mcp__solera__read_card', source: 'solera', tokens: 310 },
    { name: 'mcp__solera__list_cards', source: 'solera', tokens: 120 },
  ])
  assert.deepEqual(breakdown.agents, [{ name: 'Explore', source: 'projectSettings', tokens: 220 }])
  // Le nominatif des skills vient de `skillFrontmatter`, et le skill à zéro jeton tombe.
  assert.deepEqual(breakdown.skills, [{ name: 'dataviz', source: 'built-in', tokens: 482 }])

  const event = soleraEventSchema.safeParse({
    type: 'usage.updated',
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    context: { usedTokens: 19_813, maxTokens: 1_000_000, ratio: 0.019813, breakdown },
  })
  assert.ok(event.success, JSON.stringify(event.error?.issues))
})

test('la fenêtre est celle de l’auto-compaction, et les listes sont coupées au plus lourd', () => {
  // `rawMaxTokens` l'emporte : c'est contre elle que le CLI calcule son pourcentage, donc
  // la seule qui réconcilie la pastille et la modale quand les deux bornes diffèrent.
  assert.equal(contextWindow(response({ rawMaxTokens: 200_000, maxTokens: 1_000_000 })), 200_000)
  // Repli sur `maxTokens` quand la fenêtre crue manque, et aveu d'ignorance sinon : une
  // fenêtre nulle ne se remplace pas par un défaut, il n'y aurait pas de part à afficher.
  assert.equal(contextWindow(response({ rawMaxTokens: 0 })), 1_000_000)
  assert.equal(contextWindow(response({ rawMaxTokens: 0, maxTokens: undefined })), null)

  const many = Array.from({ length: CONTEXT_DETAIL_MAX_ROWS + 10 }, (_, index) => ({
    name: `mcp__big__tool_${index}`,
    serverName: 'big',
    tokens: index + 1,
  }))
  const breakdown = contextBreakdown(response({ mcpTools: many }))
  assert.equal(breakdown.axis, 'categories')
  if (breakdown.axis !== 'categories') return
  assert.equal(breakdown.mcpTools.length, CONTEXT_DETAIL_MAX_ROWS)
  assert.equal(breakdown.mcpTools[0]?.tokens, CONTEXT_DETAIL_MAX_ROWS + 10)
})

test('une réponse amputée ne fait pas échouer la lecture', () => {
  const breakdown = contextBreakdown(
    response({
      categories: undefined,
      memoryFiles: undefined,
      mcpTools: undefined,
      agents: undefined,
      skills: undefined,
    }),
  )
  assert.equal(breakdown.axis, 'categories')
  if (breakdown.axis !== 'categories') return
  assert.deepEqual(breakdown.categories, [])
  assert.deepEqual(breakdown.skills, [])
})
