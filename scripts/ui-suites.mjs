#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Lance un lot des suites d'interface `scripts/*-ui-check.mjs`, pour le job `ui` de la CI.
 *
 *   node scripts/ui-suites.mjs 2/3   lance le deuxième des trois lots
 *
 * Chaque suite est rangée ici, dans un lot ou hors CI avec sa raison. Une suite qui
 * n'est rangée nulle part fait échouer tous les lots : hors CI, une suite pourrit en
 * silence, et c'est arrivé à une douzaine d'entre elles (carte #258).
 *
 * Les lots sont équilibrés à la main sur les durées mesurées (en secondes, à côté de
 * chaque nom) ; le résumé de fin les redonne pour les rééquilibrer.
 */

const root = join(fileURLToPath(import.meta.url), '../..')

const BATCHES = [
  [
    'frontend', // 140
    'project-settings', // 125
    'travail', // 45
    'settings', // 40
    'board', // 30
    'shell', // 12
    'skills', // 8
    'viewport', // 7
  ],
  [
    'schedule', // 95
    'milestones', // 70
    'claude-login', // 35
    'windows-feedback', // 22
    'schedule-check', // 18
    'services', // 15
    'claude-accounts', // 14
    'card-draft', // 13
    'brief-field', // 12
    'grok-accounts', // 12
    'panel-project', // 11
    'decisions', // 11
    'explorer', // 10
    'worktree-status', // 10
    'api-mcp', // 9
    'palette', // 9
  ],
  [
    'git', // 65, le double sur une machine chargée
    'places', // 55
    'composer', // 30
    'sidebar', // 28
    'terminals', // 26
    'desktop-updates', // 14
    'vault', // 14
    'schedule-builder', // 9
    'session-references', // 9
    'checkpoints', // 8
    'activity', // 7
    'tool-styles', // 7
    'web', // 7
    'agenda', // 6
    'api-projects', // 6
    'toolbar', // 6
    'tooltips', // 6
    'worktree-gone', // 6
    'codex', // 5
    'fil-images', // 5
    'image-viewer', // 5
    'skill-updates', // 5
    'grok', // 4
    'opencode', // 4
    'session-works', // 4
  ],
]

/** Hors CI, et pourquoi. Une suite n'y reste que le temps de sa carte. */
const OUTSIDE = {
  desktop: "l'app empaquetée, éprouvée par le job desktop sur main",
  actions: 'instable, lignes en double (#259)',
  sessions: 'boucle de rendu de la sidebar à 1280×800 (#262)',
  onboarding: 'page.goto bloque par intermittence (#263)',
  'codex-accounts': 'lance le vrai codex, qui joint OpenAI (#264)',
  'draft-account': 'sonde les vrais codex et claude (#264)',
}

const onDisk = readdirSync(join(root, 'scripts'))
  .filter((file) => file.endsWith('-ui-check.mjs'))
  .map((file) => file.slice(0, -'-ui-check.mjs'.length))
const ranked = [...BATCHES.flat(), ...Object.keys(OUTSIDE)]
const problems = [
  ...onDisk.filter((name) => !ranked.includes(name)).map((name) => `${name} : rangée nulle part`),
  ...ranked.filter((name) => !onDisk.includes(name)).map((name) => `${name} : scripts/${name}-ui-check.mjs n'existe pas`),
  ...ranked.filter((name, i) => ranked.indexOf(name) !== i).map((name) => `${name} : rangée deux fois`),
]
if (problems.length) {
  for (const problem of problems) console.log(`::error file=scripts/ui-suites.mjs::${problem}`)
  process.exit(1)
}

const match = /^(\d+)\/(\d+)$/.exec(process.argv[2] ?? '')
if (!match || Number(match[2]) !== BATCHES.length || Number(match[1]) < 1 || Number(match[1]) > BATCHES.length) {
  console.error(`Usage : node scripts/ui-suites.mjs <lot>/${BATCHES.length}, avec autant de lots dans la matrice du job ui.`)
  process.exit(1)
}

const results = []
for (const name of BATCHES[Number(match[1]) - 1]) {
  console.log(`::group::${name}`)
  const start = Date.now()
  const { status } = spawnSync(process.execPath, [join(root, 'scripts', `${name}-ui-check.mjs`)], { cwd: root, stdio: 'inherit' })
  console.log('::endgroup::')
  const seconds = Math.round((Date.now() - start) / 1000)
  if (status !== 0) console.log(`::error::${name}-ui-check a échoué (${seconds} s)`)
  results.push({ name, ok: status === 0, seconds })
}

console.log('')
for (const { name, ok, seconds } of results) console.log(`${ok ? 'ok   ' : 'ÉCHEC'} ${String(seconds).padStart(4)} s  ${name}`)
process.exit(results.every((result) => result.ok) ? 0 : 1)
