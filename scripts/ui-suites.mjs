#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Lance un lot des suites d'interface `scripts/*-ui-check.mjs`, pour la matrice `ui-batch`
 * de la CI (le job `ui` ne fait que réunir le verdict des lots).
 *
 *   node scripts/ui-suites.mjs 2/3   lance le deuxième des trois lots
 *
 * Chaque suite est rangée ici, dans un lot ou hors CI avec sa raison. Une suite qui
 * n'est rangée nulle part fait échouer tous les lots : hors CI, une suite pourrit en
 * silence, et c'est arrivé à une douzaine d'entre elles (carte #258).
 *
 * Les lots sont équilibrés à la main sur les durées mesurées en CI (en secondes, à côté
 * de chaque nom) ; le résumé de fin les redonne pour les rééquilibrer.
 */

const root = join(fileURLToPath(import.meta.url), '../..')

const BATCHES = [
  [
    'frontend', // 131
    'travail', // 77
    'project-settings', // 51
    'board', // 50
    'settings', // 37
    'shell', // 15
    'skills', // 11
    'viewport', // 10
  ],
  [
    'milestones', // 108
    'sessions', // ~90 estimées (185 en local)
    'claude-login', // 35
    'claude-accounts', // 26
    'windows-feedback', // 21
    'explorer', // 18
    'grok-accounts', // 17
    'services', // 16
    'panel-project', // 16
    'decisions', // 16
    'worktree-status', // 16
    'palette', // 16
    'api-mcp', // 15
    'card-draft', // 12
    'brief-field', // 12
  ],
  [
    'git', // 70
    'places', // 56
    'sidebar', // 34
    'composer', // 26
    'terminals', // 26
    'vault', // 14
    'desktop-updates', // 12
    'schedule-builder', // 10
    'checkpoints', // 10
    'web', // 9
    'activity', // 8
    'worktree-gone', // 8
    'session-references', // 7
    'tool-styles', // 7
    'api-projects', // 7
    'tooltips', // 7
    'toolbar', // 6
    'fil-images', // 6
    'skill-updates', // 6
    'agenda', // 5
    'codex', // 5
    'session-works', // 5
    'image-viewer', // 4
    'grok', // 4
    'opencode', // 4
  ],
]

/** Hors CI, et pourquoi : la carte qui doit l'y ramener, ou le job qui l'éprouve ailleurs. */
const OUTSIDE = {
  desktop: "l'app empaquetée, éprouvée par le job desktop sur main",
  actions: 'instable, lignes en double (#259)',
  onboarding: 'page.goto bloque par intermittence (#263)',
  'codex-accounts': 'lance le vrai codex, qui joint OpenAI (#264)',
  'draft-account': 'sonde les vrais codex et claude (#264)',
  schedule: 'un vrai tour du CLI Claude du poste (#267)',
  'schedule-check': 'un vrai tour du CLI Claude du poste (#267)',
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
  console.error(`Usage : node scripts/ui-suites.mjs <lot>/${BATCHES.length}, autant de lots que la matrice ui-batch de la CI.`)
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
