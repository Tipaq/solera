import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEVCONTAINER_ENVIRONMENT,
  HOST_ENVIRONMENT,
  type ProjectDevcontainerDto,
  type ProjectDto,
  type ProjectEnvironmentsDto,
} from '@solera/protocol'

const { settingsBaseOf, changedFields, settingsPatchOf, draftOf, draftProblem } = await import('../../web/src/lib/project-settings.js')

const project = {
  id: 'p1',
  name: 'Nimbus',
  workspacePath: '/w/nimbus',
  visibility: 'private',
  color: null,
  cap: null,
  turnCheckpoints: true,
} as ProjectDto

const environments: ProjectEnvironmentsDto = {
  default: HOST_ENVIRONMENT,
  choices: [HOST_ENVIRONMENT, DEVCONTAINER_ENVIRONMENT],
  suggested: null,
  autonomousConfined: false,
}

const devcontainer = { repository: null, managed: null, template: '{}', compose: true, confinedServices: 'shared' } as ProjectDevcontainerDto

test('base : les champs du projet, et ceux des requêtes à mesure qu’elles arrivent', () => {
  const alone = settingsBaseOf(project)
  assert.deepEqual(alone, { name: 'Nimbus', workspacePath: '/w/nimbus', visibility: 'private', color: null, cap: '', turnCheckpoints: true })
  const full = settingsBaseOf(project, environments, devcontainer)
  assert.deepEqual(full.environment, HOST_ENVIRONMENT)
  assert.equal(full.autonomousConfined, false)
  assert.equal(full.confinedServices, 'shared')
  // Sans docker-compose, les services des sessions confinées ne se règlent pas.
  assert.equal('confinedServices' in settingsBaseOf(project, environments, { ...devcontainer, compose: false }), false)
})

test('modifications : seules celles qui diffèrent de l’enregistré comptent', () => {
  const base = settingsBaseOf(project, environments, devcontainer)
  assert.deepEqual(changedFields(base, {}), [])
  // Revenir à la valeur enregistrée efface la modification.
  assert.deepEqual(changedFields(base, { name: 'Nimbus', color: null }), [])
  assert.deepEqual(changedFields(base, { name: 'Nimbus 2', color: '#e11d48' }), ['name', 'color'])
  // L'environnement se compare par sa clé, pas par l'identité de l'objet.
  assert.deepEqual(changedFields(base, { environment: { ...HOST_ENVIRONMENT } }), [])
  assert.deepEqual(changedFields(base, { environment: DEVCONTAINER_ENVIRONMENT }), ['environment'])
  // Des espaces autour du nom ou du cap ne sont pas une modification : le serveur les retire.
  assert.deepEqual(changedFields(base, { name: ' Nimbus ', cap: '  ' }), [])
})

test('brouillon : l’enregistré, puis les modifications par-dessus', () => {
  const base = settingsBaseOf(project, environments, devcontainer)
  const draft = draftOf(base, { cap: 'Un cap.' })
  assert.equal(draft.cap, 'Un cap.')
  assert.equal(draft.name, 'Nimbus')
})

test('enregistrement : un seul PATCH, avec les seuls champs modifiés', () => {
  const base = settingsBaseOf(project, environments, devcontainer)
  assert.deepEqual(settingsPatchOf(base, {}), {})
  assert.deepEqual(
    settingsPatchOf(base, { name: '  Nimbus 2 ', cap: '  Où va le projet. ', visibility: 'private', turnCheckpoints: false, environment: DEVCONTAINER_ENVIRONMENT }),
    { name: 'Nimbus 2', cap: 'Où va le projet.', turnCheckpoints: false, environment: DEVCONTAINER_ENVIRONMENT },
  )
  // Un cap vidé part en `null` : le serveur le retire.
  assert.deepEqual(settingsPatchOf(settingsBaseOf({ ...project, cap: 'Ancien.' }), { cap: '' }), { cap: null })
})

test('brouillon : ce qui empêche d’enregistrer', () => {
  const base = settingsBaseOf(project)
  assert.equal(draftProblem(draftOf(base, {})), null)
  assert.equal(draftProblem(draftOf(base, { name: '   ' })), 'nameEmpty')
  assert.equal(draftProblem(draftOf(base, { workspacePath: '' })), 'pathEmpty')
  assert.equal(draftProblem(draftOf(base, { cap: 'x'.repeat(281) })), 'capTooLong')
  assert.equal(draftProblem(draftOf(base, { cap: 'x'.repeat(280) })), null)
})
