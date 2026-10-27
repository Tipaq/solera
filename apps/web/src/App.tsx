import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { AppearanceSync } from './lib/appearance-sync'
import { visibleSections } from './components/settings/sections'
import { LEGACY_SETTINGS_SECTIONS, openSettings } from './lib/settings-dialog'
import { useInstance } from './lib/instance'
import { useCurrentUser } from './lib/session'
import { useProjects } from './lib/projects'
import { useUserSettings } from './lib/user-settings'
import { ConversationPage } from './routes/ConversationPage'
import { DraftConversationPage } from './routes/DraftConversationPage'
import { HomePage } from './routes/HomePage'
import { ServicesPage } from './routes/ServicesPage'
import { DecisionsPage } from './routes/DecisionsPage'
import { LoginPage } from './routes/LoginPage'
import { BoardPage } from './routes/BoardPage'
import { PortfolioBoardPage } from './routes/PortfolioBoardPage'
import { PortfolioJournalPage } from './routes/PortfolioJournalPage'
import { PortfolioLayout } from './routes/PortfolioLayout'
import { PortfolioTimelinePage } from './routes/PortfolioTimelinePage'
import { ProjectJournalPage } from './routes/ProjectJournalPage'
import { ProjectLayout } from './routes/ProjectLayout'
import { ProjectOverviewPage } from './routes/ProjectOverviewPage'
import { ProjectTimelinePage } from './routes/ProjectTimelinePage'
import { ProjectPage } from './routes/ProjectPage'
import { ProjectsPage } from './routes/ProjectsPage'
import { NewProjectPage } from './routes/NewProjectPage'
import { SchedulePage } from './routes/SchedulePage'
import { SchedulesPage } from './routes/SchedulesPage'

/**
 * L'éditeur de skill, chargé à part.
 *
 * C'est la seule route qui importe `CodeEditor`, donc CodeMirror et son thème : 339 Ko
 * — le premier poste du bundle principal, 16 % à lui seul — pour un écran qu'on
 * n'ouvre qu'en venant éditer un skill. Le bundle principal frôle la limite de
 * précache du service worker (2 Mio), et la dépasser **casse le build** au lieu de le
 * ralentir, avec une erreur qui ne nomme pas la cause.
 *
 * `EditorPane`, l'autre consommateur de `CodeEditor`, est déjà dans le panneau du
 * Travail chargé à part : c'est le même geste, sur la dernière route qui restait.
 */
const SkillEditorPage = lazy(() =>
  import('./routes/SkillEditorPage').then((m) => ({ default: m.SkillEditorPage })),
)

/**
 * Les deux pages du vault arrivent à part.
 *
 * Elles portent l'éditeur de note, donc CodeMirror, sa grammaire markdown et son
 * autocomplétion : trois cents kilooctets qu'une instance sans vault ne téléchargerait
 * jamais, et que le reste de l'application n'utilise pas. Le bundle principal frôlait
 * déjà la limite de précache du service worker — 2 Mio — et les y laisser la faisait
 * dépasser, ce qui **casse le build** au lieu de le ralentir.
 *
 * Même raison et même geste que pour le panneau du Travail, chargé à part lui aussi.
 */
const VaultPage = lazy(() => import('./routes/VaultPage').then((m) => ({ default: m.VaultPage })))
const VaultBrowsePage = lazy(() =>
  import('./routes/VaultBrowsePage').then((m) => ({ default: m.VaultBrowsePage })),
)

/**
 * La visite de première ouverture, chargée à part : elle ne sert qu'une fois par compte,
 * et son code n'a rien à faire dans le paquet principal, qui frôle la limite de précache.
 */
const OnboardingPage = lazy(() =>
  import('./routes/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
)

/**
 * L'onglet Activité d'un projet, chargé à part : le paquet principal frôle la limite de
 * précache, et cette vue n'est pas celle d'arrivée.
 */
const ProjectActivityPage = lazy(() =>
  import('./routes/ProjectActivityPage').then((m) => ({ default: m.ProjectActivityPage })),
)

/** L'Activité du portefeuille (#117), chargée à part pour la même raison. */
const PortfolioActivityPage = lazy(() =>
  import('./routes/PortfolioActivityPage').then((m) => ({ default: m.PortfolioActivityPage })),
)

/**
 * La vue d'un jalon lancé (#116), chargée à part : on n'y vient que par le bandeau de
 * l'Activité ou la frise des Jalons.
 */
const ProjectMilestonePage = lazy(() =>
  import('./routes/ProjectMilestonePage').then((m) => ({ default: m.ProjectMilestonePage })),
)

/** Après la visite : la création du premier projet s'il n'y en a aucun, sinon l'accueil. */
function OnboardingExit() {
  const { data: projects } = useProjects()
  if (!projects) return null
  return <Navigate to={projects.length === 0 ? '/projects/new' : '/'} replace />
}

/**
 * Les anciennes adresses des réglages, qui ne sont plus des pages.
 *
 * Elles ont circulé — un favori, un lien dans une phrase d'aide, l'historique du
 * navigateur — et les faire tomber sur l'accueil sans rien ouvrir perdrait le geste.
 * La modale s'ouvre donc sur la section demandée, et l'adresse rend la main : une
 * modale n'a pas d'URL, c'est ce qui la distingue d'une page.
 */
function LegacySettingsRoute() {
  const { section } = useParams()
  const { data: user } = useCurrentUser()
  const { data: instance } = useInstance()
  // Parmi les sections que cette instance montre : une adresse vers une section cachée
  // (les notifications, en bureau) ouvre la modale sur sa section par défaut.
  const legacy = section ? LEGACY_SETTINGS_SECTIONS[section] : undefined
  const wanted = legacy?.section ?? section
  const known = visibleSections(user?.isAdmin, instance?.capabilities).find((entry) => entry.id === wanted)

  useEffect(() => {
    openSettings(known?.id ?? null, legacy?.subscription)
  }, [known?.id, legacy?.subscription])

  // « projets » n'a jamais été une section : c'était déjà une redirection vers le
  // formulaire de création, et il reste le bon endroit où arriver.
  return <Navigate to={section === 'projets' ? '/projects/new' : '/'} replace />
}

export function App() {
  const { data: user, isPending } = useCurrentUser()
  // Attendu avec la session : les écrans lisent ses capacités sans état intermédiaire.
  const { data: instance, isPending: instancePending } = useInstance()
  // Les réglages du compte décident si la visite est due : attendus aussi, pour ne pas
  // dessiner l'application une fraction de seconde avant de l'ouvrir.
  const { data: settings, isPending: settingsPending } = useUserSettings(Boolean(user))

  // Écran vide plutôt qu'un spinner : la vérification de session est locale et brève,
  // un spinner qui clignote est plus désagréable que rien.
  if (isPending || instancePending || (user && settingsPending)) return null

  const onboarding = (
    <Suspense fallback={null}>
      <OnboardingPage />
    </Suspense>
  )

  if (!user) {
    // Une base sans compte n'a pas de page de connexion à proposer : la visite
    // commence par créer le premier compte, sur n'importe quelle adresse.
    if (instance?.needsSetup && instance.capabilities.passwordAuth) {
      return (
        <BrowserRouter>
          <Routes>
            <Route path="*" element={onboarding} />
          </Routes>
        </BrowserRouter>
      )
    }
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  // La visite due prend toute la place : rien d'autre à voir tant qu'elle n'est pas
  // finie ou passée, et elle reprend à son étape sur n'importe quel appareil.
  if (settings?.onboarding.pending) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/bienvenue" element={onboarding} />
          <Route path="*" element={<Navigate to="/bienvenue" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      {/* Hors des routes : les réglages s'ouvrent depuis n'importe où — le menu du
          compte, la palette, une phrase d'explication — et ne remplacent pas la vue
          qu'on avait sous les yeux. */}
      <AppearanceSync />
      <SettingsDialog />
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/bienvenue" element={<OnboardingExit />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          {/* Le portefeuille a la même grammaire qu'un projet, un cran au-dessus. La
              création d'un projet reste dehors : c'est un formulaire, pas une vue du
              portefeuille, et il doit s'ouvrir plein écran. */}
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects" element={<PortfolioLayout />}>
            <Route index element={<ProjectsPage />} />
            <Route path="board" element={<PortfolioBoardPage />} />
            <Route path="activity" element={<Suspense fallback={null}><PortfolioActivityPage /></Suspense>} />
            {/* Travail s'est fondu dans l'Activité (#117) : l'ancienne adresse y mène. */}
            <Route path="work" element={<Navigate to="/projects/activity" replace />} />
            <Route path="timeline" element={<PortfolioTimelinePage />} />
            <Route path="journal" element={<PortfolioJournalPage />} />
          </Route>
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/decisions" element={<DecisionsPage />} />
          {/* Avant la note : « parcourir » ne doit pas être pris pour un chemin de note.
              Pas de voile d'attente : la page arrive quand son code est là, plutôt que
              de faire clignoter un écran vide entre deux notes. */}
          <Route path="/vault/parcourir" element={<Suspense fallback={null}><VaultBrowsePage /></Suspense>} />
          <Route path="/vault/note/*" element={<Suspense fallback={null}><VaultPage /></Suspense>} />
          <Route path="/vault" element={<Suspense fallback={null}><VaultPage /></Suspense>} />
          <Route path="/services" element={<ServicesPage />} />
          {/* Les vues d'un projet partagent une coque : la bande, qui ne dépend pas de
              la vue, et la rangée d'onglets qui les porte. Les réglages restent dehors —
              ils ne sont pas une vue mais une destination du `⋯` — et les conversations
              aussi, leur bande nommant la session plutôt que le projet. */}
          <Route path="/p/:projectId" element={<ProjectLayout />}>
            <Route index element={<ProjectOverviewPage />} />
            <Route path="activity" element={<Suspense fallback={null}><ProjectActivityPage /></Suspense>} />
            <Route path="board" element={<BoardPage />} />
            <Route path="schedules" element={<SchedulePage />} />
            <Route path="timeline" element={<ProjectTimelinePage />} />
            <Route path="timeline/:number" element={<Suspense fallback={null}><ProjectMilestonePage /></Suspense>} />
            <Route path="journal" element={<ProjectJournalPage />} />
          </Route>
          <Route path="/p/:projectId/settings" element={<ProjectPage />} />
          {/* Avant l'identifiant : « new » ne doit pas être pris pour une conversation. */}
          <Route path="/p/:projectId/c/new" element={<DraftConversationPage />} />
          <Route path="/p/:projectId/c/:conversationId" element={<ConversationPage />} />
          {/* Les fils libres, hors de tout projet : mêmes pages, sans le segment qui
              nomme un projet qu'ils n'ont pas. */}
          <Route path="/c/new" element={<DraftConversationPage />} />
          <Route path="/c/:conversationId" element={<ConversationPage />} />
          <Route
            path="/skills/:skillId"
            element={
              <Suspense fallback={null}>
                <SkillEditorPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="/settings" element={<LegacySettingsRoute />} />
        <Route path="/settings/:section" element={<LegacySettingsRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
