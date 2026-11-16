import assert from 'node:assert/strict'
import { test } from 'node:test'

// Modules purs du champ d'écriture (carte #192) : la lecture du brief et les mentions.
const { readBrief, titleFromBrief, announce, spottedChips } = await import('../../web/src/lib/brief.js')
const {
  dismissMention,
  highlightSegments,
  insertMention,
  linkPiece,
  mentionQuery,
  mentionedNumbers,
  normalizeUrl,
  removeMention,
  sizeParts,
  startMention,
  suggestCards,
  urlsIn,
} = await import('../../web/src/lib/writing.js')

/* ------------------------------------------------------------------ readBrief */

const FR_BRIEF = `# Mode hors-ligne complet

## Objectif
Pouvoir relire et répondre aux sessions sans réseau.

## Étapes
- Cache local des fils
- File d'envoi des réponses (voir #156)
- Resynchronisation au retour du réseau

## Contraintes
- Rien ne se perd à la coupure

## Hors champ
- Lancer une session hors ligne

Faut-il chiffrer le cache ?
Le format du cache reste à décider.`

test('brief : un brief français complet est lu section par section', () => {
  const reading = readBrief(FR_BRIEF)
  assert.equal(reading.objective, 'Pouvoir relire et répondre aux sessions sans réseau.')
  assert.deepEqual(reading.steps, ['Cache local des fils', "File d'envoi des réponses (voir #156)", 'Resynchronisation au retour du réseau'])
  assert.deepEqual(reading.constraints, ['Rien ne se perd à la coupure'])
  assert.deepEqual(reading.outOfScope, ['Lancer une session hors ligne'])
  assert.deepEqual(reading.openPoints, ['Faut-il chiffrer le cache ?', 'Le format du cache reste à décider.'])
  assert.equal(reading.sufficient, true)
})

test('brief : un brief anglais se lit avec les mêmes règles', () => {
  const reading = readBrief(`# Offline mode

## Goal
Read and answer sessions without a network.

## Steps
- Local cache of threads
- Outgoing reply queue

## Constraints
- Nothing is lost on disconnect

## Out of scope
- Starting a session offline

Should the cache be encrypted?
Cache format is to be decided.`)
  assert.equal(reading.objective, 'Read and answer sessions without a network.')
  assert.deepEqual(reading.steps, ['Local cache of threads', 'Outgoing reply queue'])
  assert.deepEqual(reading.constraints, ['Nothing is lost on disconnect'])
  assert.deepEqual(reading.outOfScope, ['Starting a session offline'])
  assert.deepEqual(reading.openPoints, ['Should the cache be encrypted?', 'Cache format is to be decided.'])
  assert.equal(reading.sufficient, true)
})

test('brief : le premier titre est celui du jalon, pas une étape', () => {
  assert.deepEqual(readBrief('# Le jalon\n- une étape').steps, ['une étape'])
  assert.deepEqual(readBrief('## Le jalon\n- une étape').steps, ['une étape'])
})

test('brief : un brief qui commence par sa section « Objectif » garde son objectif', () => {
  // Le prototype prenait ce premier `## Objectif` pour le titre du jalon et perdait l'objectif.
  const reading = readBrief('## Objectif\nPouvoir travailler hors ligne.\n## Étapes\n- Cache')
  assert.equal(reading.objective, 'Pouvoir travailler hors ligne.')
  assert.deepEqual(reading.steps, ['Cache'])
})

test('brief : objectif sur une ligne, en français et en anglais', () => {
  assert.equal(readBrief('Objectif : rendre le board lisible').objective, 'rendre le board lisible')
  assert.equal(readBrief('But — tenir la charge').objective, 'tenir la charge')
  assert.equal(readBrief('Goal: make the board readable').objective, 'make the board readable')
})

test('brief : un objectif en ligne, même long', () => {
  const long = 'pouvoir relire et répondre aux sessions sans aucun réseau, partout'
  assert.equal(readBrief(`Mode hors ligne\nObjectif : ${long}`).objective, long)
  assert.equal(readBrief(`Offline\nGoal: ${long}`).objective, long)
})

test('brief : une phrase qui commence par un mot de section n’ouvre pas de section', () => {
  // « But » anglais, « Plan de… » : ni titre, ni « mot : … ».
  const reading = readBrief('Refonte\nBut it must stay fast\nPlan de migration progressif\n- a')
  assert.equal(reading.objective, null)
  assert.deepEqual(reading.steps, ['a'])
})

test('brief : « sans-serif » n’est pas « sans »', () => {
  assert.deepEqual(readBrief('- Police sans-serif partout').steps, ['Police sans-serif partout'])
})

test('brief : une ligne de liste qui dit « doit », « ne pas » ou « sans » est une contrainte', () => {
  const reading = readBrief('- Le cache doit tenir 50 Mo\n- Ne pas bloquer l’interface\n- Sans dépendance nouvelle\n- Ajouter un bouton')
  assert.deepEqual(reading.constraints, ['Le cache doit tenir 50 Mo', 'Ne pas bloquer l’interface', 'Sans dépendance nouvelle'])
  assert.deepEqual(reading.steps, ['Ajouter un bouton'])
  const english = readBrief('- The cache must stay under 50 MB\n- Do not block the UI\n- Add a button')
  assert.deepEqual(english.constraints, ['The cache must stay under 50 MB', 'Do not block the UI'])
  assert.deepEqual(english.steps, ['Add a button'])
})

test('brief : dans une section « Étapes », « sans » reste une étape', () => {
  assert.deepEqual(readBrief('Étapes :\n- Relire sans réseau\n- Répondre').steps, ['Relire sans réseau', 'Répondre'])
})

test('brief : les sous-titres et les listes numérotées sont des étapes', () => {
  assert.deepEqual(readBrief('Titre\n## Cache local\n1. Envoi\n2) Reprise').steps, ['Cache local', 'Envoi', 'Reprise'])
})

test('brief : les variantes de sections hors champ', () => {
  for (const heading of ['Hors champ', 'Hors-champ', 'Hors périmètre', 'Pas dans ce jalon', 'Non-objectifs', 'Out of scope', 'Non-goals']) {
    assert.deepEqual(readBrief(`Titre\n${heading} :\n- Le mobile`).outOfScope, ['Le mobile'], heading)
  }
})

test('brief : une ligne de liste qui commence par un mot de section reste une étape', () => {
  // « - Plan de reprise » n'ouvre pas une section « Plan ».
  assert.deepEqual(readBrief('- Plan de reprise\n- But du jeu affiché').steps, ['Plan de reprise', 'But du jeu affiché'])
})

test('brief : les mots se comptent, et une phrase seule ne suffit pas', () => {
  const reading = readBrief('Mode hors-ligne complet')
  assert.equal(reading.words, 3)
  assert.equal(reading.sufficient, false)
  assert.equal(readBrief('   \n ').words, 0)
})

test('brief : suffisant avec deux étapes, ou un objectif et 60 mots', () => {
  assert.equal(readBrief('- un\n- deux').sufficient, true)
  assert.equal(readBrief('- un').sufficient, false)
  const filler = Array.from({ length: 60 }, () => 'mot').join(' ')
  assert.equal(readBrief(`Objectif : tenir\n${filler}`).sufficient, true)
  assert.equal(readBrief(`Objectif : tenir\n${filler.split(' ').slice(0, 50).join(' ')}`).sufficient, false)
  assert.equal(readBrief(filler).sufficient, false)
})

/* ------------------------------------------------------------------ titleFromBrief */

test('titre : le premier titre, sans ses dièses ni son gras', () => {
  assert.equal(titleFromBrief('# **Mode** hors-ligne\n\nla suite'), 'Mode hors-ligne')
})

test('titre : sinon la première phrase, sans son point final', () => {
  assert.equal(titleFromBrief('Mode hors-ligne complet. Avec la suite. Et plus.'), 'Mode hors-ligne complet')
  assert.equal(titleFromBrief('Pouvoir relire :'), 'Pouvoir relire')
})

test('titre : 70 caractères au plus, avec « … »', () => {
  const title = titleFromBrief('a'.repeat(100))
  assert.equal(title.length, 68)
  assert.ok(title.endsWith('…'))
  assert.equal(titleFromBrief('b'.repeat(70)), 'b'.repeat(70))
})

test('titre : un brief qui commence par une section prend sa première ligne de texte', () => {
  assert.equal(titleFromBrief('## Objectif\nPouvoir relire hors ligne.\n## Étapes\n- Cache'), 'Pouvoir relire hors ligne')
})

test('titre : une idée courte qui commence par un mot de section reste le titre', () => {
  assert.equal(titleFromBrief('Plan de migration'), 'Plan de migration')
  assert.equal(titleFromBrief('Règles d’automatisation'), 'Règles d’automatisation')
})

test('titre : vide sans texte', () => {
  assert.equal(titleFromBrief('  \n'), '')
})

/* ------------------------------------------------------------------ announce, spottedChips */

test('annonce : vide, phrase, brief, brief avec des points ouverts', () => {
  assert.deepEqual(announce(readBrief('')), { mode: 'empty', key: 'brief.announce.empty' })
  assert.deepEqual(announce(readBrief('Mode hors-ligne')), { mode: 'phrase', key: 'brief.announce.phrase' })
  assert.deepEqual(announce(readBrief('- un\n- deux')), { mode: 'brief', key: 'brief.announce.brief' })
  assert.deepEqual(announce(readBrief('- un\n- deux\nLe format ?')), { mode: 'brief', key: 'brief.announce.briefOpen' })
})

test('repéré : une puce par chose trouvée, au singulier ou au pluriel', () => {
  const chips = spottedChips(readBrief(FR_BRIEF), { cards: 1, links: 2, files: 0 })
  assert.deepEqual(chips, [
    { key: 'brief.chip.objective', count: 1 },
    { key: 'brief.chip.steps.many', count: 3 },
    { key: 'brief.chip.constraints.one', count: 1 },
    { key: 'brief.chip.outOfScope', count: 1 },
    { key: 'brief.chip.openPoints.many', count: 2 },
    { key: 'brief.chip.cards.one', count: 1 },
    { key: 'brief.chip.links.many', count: 2 },
  ])
  assert.deepEqual(spottedChips(readBrief('Une phrase'), { cards: 0, links: 0, files: 0 }), [])
})

/* ------------------------------------------------------------------ mentions */

const CARDS = [
  { number: 156, title: 'Ranger une idée', column: 'todo' as const },
  { number: 161, title: 'Tiroir commun', column: 'done' as const },
  { number: 170, title: 'Cache hors ligne', column: 'in_progress' as const },
  { number: 15, title: 'Vieille piste', column: 'abandoned' as const },
  { number: 192, title: 'Champ à mentions', column: 'review' as const },
]

test('mentions : les cartes citées, une fois chacune, dans l’ordre du texte', () => {
  assert.deepEqual(mentionedNumbers('voir #161 puis #156, et encore #161'), [161, 156])
  // Ni une ancre d'URL, ni une entité HTML, ni un mot collé.
  assert.deepEqual(mentionedNumbers('https://x.io/a#12 &#38; mot#14 (#15)'), [15])
})

test('mentions : retirer une carte retire toutes ses mentions', () => {
  assert.equal(removeMention('voir #161 puis #156, et #161', 161), 'voir puis #156, et ')
  assert.equal(removeMention('#161\nsuite #1610', 161), '\nsuite #1610')
  assert.equal(removeMention('fin #161 \nligne', 161), 'fin\nligne')
})

test('mentions : le mot `#…` juste avant le curseur ouvre la recherche', () => {
  assert.deepEqual(mentionQuery('voir #', 6), { start: 5, query: '' })
  assert.deepEqual(mentionQuery('voir #Tir', 9), { start: 5, query: 'tir' })
  assert.deepEqual(mentionQuery('#16 et', 3), { start: 0, query: '16' })
  assert.equal(mentionQuery('voir #16 ', 9), null)
  assert.equal(mentionQuery('mot#16', 6), null)
  assert.equal(mentionQuery('https://x.io/a#b', 16), null)
})

test('mentions : au plus six cartes non abandonnées, ouvertes d’abord, numéro décroissant', () => {
  assert.deepEqual(suggestCards(CARDS, '').map((card) => card.number), [192, 170, 156, 161])
  assert.deepEqual(suggestCards(CARDS, '1').map((card) => card.number), [192, 170, 156, 161])
  assert.deepEqual(suggestCards(CARDS, '16').map((card) => card.number), [161])
  assert.deepEqual(suggestCards(CARDS, 'cache').map((card) => card.number), [170])
  assert.deepEqual(suggestCards(CARDS, 'vieille'), [])
  const many = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, title: `Carte ${index + 1}`, column: 'todo' as const }))
  assert.equal(suggestCards(many, '').length, 6)
})

test('mentions : choisir remplace la recherche par `#N ` et place le curseur après', () => {
  assert.deepEqual(insertMention('voir #tir', 5, 9, 161), { text: 'voir #161 ', caret: 10 })
  assert.deepEqual(insertMention('voir #ti et', 5, 8, 161), { text: 'voir #161 et', caret: 10 })
})

test('mentions : « Carte » insère `#` au curseur, avec une espace si besoin', () => {
  assert.deepEqual(startMention('', 0), { text: '#', caret: 1 })
  assert.deepEqual(startMention('voir', 4), { text: 'voir #', caret: 6 })
  assert.deepEqual(startMention('voir ', 5), { text: 'voir #', caret: 6 })
  assert.deepEqual(startMention('ab', 1), { text: 'a #b', caret: 3 })
})

test('mentions : fermer retire un `#` seul, garde une recherche entamée', () => {
  assert.deepEqual(dismissMention('voir # et', 6, { start: 5, query: '' }), { text: 'voir  et', caret: 5 })
  assert.equal(dismissMention('voir #ti', 8, { start: 5, query: 'ti' }), null)
})

test('surlignage : carte connue, carte inconnue, URL, texte', () => {
  assert.deepEqual(highlightSegments('voir #161 et #9 sur https://x.io/a, fin', new Set([161])), [
    { kind: 'text', text: 'voir ' },
    { kind: 'card', text: '#161' },
    { kind: 'text', text: ' et ' },
    { kind: 'unknown', text: '#9' },
    { kind: 'text', text: ' sur ' },
    // La ponctuation qui suit une URL n'en fait pas partie.
    { kind: 'url', text: 'https://x.io/a' },
    { kind: 'text', text: ', fin' },
  ])
  // Une ancre dans une URL fait partie de l'URL, pas une mention.
  assert.deepEqual(highlightSegments('https://x.io/a#161', new Set([161])), [{ kind: 'url', text: 'https://x.io/a#161' }])
})

/* ------------------------------------------------------------------ liens et fichiers */

test('lien : une PR et une issue GitHub', () => {
  // Le libellé « PR #212 » se traduit dans le composant : la lecture rend le numéro.
  assert.deepEqual(linkPiece('https://github.com/Tipaq/solera/pull/212'), {
    url: 'https://github.com/Tipaq/solera/pull/212', kind: 'pr', number: '212', detail: 'Tipaq/solera',
  })
  assert.deepEqual(linkPiece('https://www.github.com/o/r/issues/34#issuecomment-1'), {
    url: 'https://www.github.com/o/r/issues/34#issuecomment-1', kind: 'issue', number: '34', detail: 'o/r',
  })
})

test('lien : le dernier segment du chemin, lisible, sinon l’hôte', () => {
  assert.deepEqual(linkPiece('https://www.example.com/docs/offline-first_sync.html'), {
    url: 'https://www.example.com/docs/offline-first_sync.html', kind: 'web', label: 'Offline first sync', detail: 'example.com',
  })
  // Sans titre lisible, l'hôte devient le libellé, et n'est pas répété en gris.
  assert.deepEqual(linkPiece('https://example.com/'), { url: 'https://example.com/', kind: 'web', label: 'example.com', detail: '' })
  assert.deepEqual(linkPiece('https://example.com/items/1234'), { url: 'https://example.com/items/1234', kind: 'web', label: 'example.com', detail: '' })
  assert.deepEqual(linkPiece('https://example.com/ab'), { url: 'https://example.com/ab', kind: 'web', label: 'example.com', detail: '' })
  const piece = linkPiece(`https://example.com/${'a'.repeat(60)}`)
  const long = piece.kind === 'web' ? piece.label : ''
  assert.equal(long.length, 46)
  assert.ok(long.endsWith('…'))
})

test('lien : une adresse invalide reste telle quelle', () => {
  assert.deepEqual(linkPiece('pas une url'), { url: 'pas une url', kind: 'web', label: 'pas une url', detail: '' })
})

test('lien : les URL d’un texte, et le préfixe ajouté à une adresse tapée', () => {
  assert.deepEqual(urlsIn('voir https://a.io/x. et (http://b.io) fin'), ['https://a.io/x', 'http://b.io'])
  assert.equal(normalizeUrl(' example.com/a '), 'https://example.com/a')
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com')
  assert.equal(normalizeUrl('  '), null)
})

test('fichier : la taille en octets, kilo-octets, méga-octets', () => {
  assert.deepEqual(sizeParts(512), { unit: 'bytes', value: 512 })
  assert.deepEqual(sizeParts(12 * 1024 + 100), { unit: 'kb', value: 12 })
  assert.deepEqual(sizeParts(1.4 * 1024 * 1024), { unit: 'mb', value: 1.4 })
})
