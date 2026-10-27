import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AppearanceSync } from './lib/appearance-sync'
import { visibleSections } from './components/settings/sections'
import { LEGACY_SETTINGS_SECTIONS, openSettings, useSettingsDialog } from './lib/settings-dialog'
import { useInstance } from './lib/instance'
import { useCurrentUser } from './lib/session'
import { useProjects } from './lib/projects'
import { useUserSettings } from './lib/user-settings'
import { ConversationPage } from './routes/ConversationPage'
import { DraftConversationPage } from './routes/DraftConversationPage'
import { HomePage } from './routes/HomePage'
import { LoginPage } from './routes/LoginPage'
import { PortfolioLayout } from './routes/PortfolioLayout'
import { ProjectLayout } from './routes/ProjectLayout'
import { ProjectOverviewPage } from './routes/ProjectOverviewPage'
import { ProjectsPage } from './routes/ProjectsPage'

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

/**
 * Les vues qu'on n'ouvre pas au démarrage, chargées à part (#128).
 *
 * Le paquet d'entrée remontait vers la limite de précache du service worker (2 Mio,
 * dont le dépassement **casse le build**) : 91 % au 2026-10-27, un peu plus à chaque
 * carte. On arrive sur l'accueil ou sur une conversation ; le board, les réglages d'un
 * projet, les tâches planifiées, les jalons, le journal, les décisions et les services
 * sont des destinations, et leur code peut attendre qu'on y aille. Chaque morceau reste
 * précaché (`globPatterns`) : la navigation marche hors ligne et n'attend pas le réseau.
 *
 * Restent dans le tronc les layouts, qui portent les onglets et la bande, et les vues
 * d'arrivée : l'accueil, le portefeuille, la vue d'ensemble d'un projet, la conversation.
 */
const NewProjectPage = lazy(() => import('./routes/NewProjectPage').then((m) => ({ default: m.NewProjectPage })))
const PortfolioBoardPage = lazy(() =>
  import('./routes/PortfolioBoardPage').then((m) => ({ default: m.PortfolioBoardPage })),
)
const PortfolioTimelinePage = lazy(() =>
  import('./routes/PortfolioTimelinePage').then((m) => ({ default: m.PortfolioTimelinePage })),
)
const PortfolioJournalPage = lazy(() =>
  import('./routes/PortfolioJournalPage').then((m) => ({ default: m.PortfolioJournalPage })),
)
const SchedulesPage = lazy(() => import('./routes/SchedulesPage').then((m) => ({ default: m.SchedulesPage })))
const ServicesPage = lazy(() => import('./routes/ServicesPage').then((m) => ({ default: m.ServicesPage })))
const BoardPage = lazy(() => import('./routes/BoardPage').then((m) => ({ default: m.BoardPage })))
const SchedulePage = lazy(() => import('./routes/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const ProjectTimelinePage = lazy(() =>
  import('./routes/ProjectTimelinePage').then((m) => ({ default: m.ProjectTimelinePage })),
)
const ProjectJournalPage = lazy(() =>
  import('./routes/ProjectJournalPage').then((m) => ({ default: m.ProjectJournalPage })),
)
const ProjectPage = lazy(() => import('./routes/ProjectPage').then((m) => ({ default: m.ProjectPage })))

/** Une vue chargée à part, sans voile d'attente : elle arrive quand son code est là. */
function Deferred({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}

const SettingsDialog = lazy(() =>
  import('./components/settings/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
)

/**
 * La modale des réglages, chargée à sa première ouverture.
 *
 * Elle importe toutes ses sections — jetons d'API, comptes, abonnements, permissions —
 * pour une modale que la plupart des visites n'ouvrent pas. Une fois chargée, elle reste
 * montée : la fermeture garde son animation, et la réouverture est immédiate.
 */
function SettingsDialogMount() {
  const { open } = useSettingsDialog()
  const [wanted, setWanted] = useState(open)
  if (open && !wanted) setWanted(true)
  if (!wanted) return null
  return (
    <Suspense fallback={null}>
      <SettingsDialog />
    </Suspense>
  )
}

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
      <AppearanceSync />
      {/* Hors des routes : les réglages s'ouvrent depuis n'importe où — le menu du
          compte, la palette, une phrase d'explication — et ne remplacent pas la vue
          qu'on avait sous les yeux. */}
      <SettingsDialogMount />
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/bienvenue" element={<OnboardingExit />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          {/* Le portefeuille a la même grammaire qu'un projet, un cran au-dessus. La
              création d'un projet reste dehors : c'est un formulaire, pas une vue du
              portefeuille, et il doit s'ouvrir plein écran. */}
          <Route path="/projects/new" element={<Deferred><NewProjectPage /></Deferred>} />
          <Route path="/projects" element={<PortfolioLayout />}>
            <Route index element={<ProjectsPage />} />
            <Route path="board" element={<Deferred><PortfolioBoardPage /></Deferred>} />
            <Route path="activity" element={<Suspense fallback={null}><PortfolioActivityPage /></Suspense>} />
            {/* Travail s'est fondu dans l'Activité (#117) : l'ancienne adresse y mène. */}
            <Route path="work" element={<Navigate to="/projects/activity" replace />} />
            <Route path="timeline" element={<Deferred><PortfolioTimelinePage /></Deferred>} />
            <Route path="journal" element={<Deferred><PortfolioJournalPage /></Deferred>} />
          </Route>
          <Route path="/schedules" element={<Deferred><SchedulesPage /></Deferred>} />
          {/* Avant la note : « parcourir » ne doit pas être pris pour un chemin de note.
              Pas de voile d'attente : la page arrive quand son code est là, plutôt que
              de faire clignoter un écran vide entre deux notes. */}
          <Route path="/vault/parcourir" element={<Suspense fallback={null}><VaultBrowsePage /></Suspense>} />
          <Route path="/vault/note/*" element={<Suspense fallback={null}><VaultPage /></Suspense>} />
          <Route path="/vault" element={<Suspense fallback={null}><VaultPage /></Suspense>} />
          <Route path="/services" element={<Deferred><ServicesPage /></Deferred>} />
          {/* Les vues d'un projet partagent une coque : la bande, qui ne dépend pas de
              la vue, et la rangée d'onglets qui les porte. Les réglages restent dehors —
              ils ne sont pas une vue mais une destination du `⋯` — et les conversations
              aussi, leur bande nommant la session plutôt que le projet. */}
          <Route path="/p/:projectId" element={<ProjectLayout />}>
            <Route index element={<ProjectOverviewPage />} />
            <Route path="activity" element={<Suspense fallback={null}><ProjectActivityPage /></Suspense>} />
            <Route path="board" element={<Deferred><BoardPage /></Deferred>} />
            <Route path="schedules" element={<Deferred><SchedulePage /></Deferred>} />
            <Route path="timeline" element={<Deferred><ProjectTimelinePage /></Deferred>} />
            <Route path="timeline/:number" element={<Suspense fallback={null}><ProjectMilestonePage /></Suspense>} />
            <Route path="journal" element={<Deferred><ProjectJournalPage /></Deferred>} />
          </Route>
          <Route path="/p/:projectId/settings" element={<Deferred><ProjectPage /></Deferred>} />
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
