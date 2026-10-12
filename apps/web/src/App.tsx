import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { SETTINGS_SECTIONS } from './components/settings/sections'
import { openSettings } from './lib/settings-dialog'
import { useCurrentUser } from './lib/session'
import { ConversationPage } from './routes/ConversationPage'
import { DraftConversationPage } from './routes/DraftConversationPage'
import { HomePage } from './routes/HomePage'
import { ServicesPage } from './routes/ServicesPage'
import { LoginPage } from './routes/LoginPage'
import { BoardPage } from './routes/BoardPage'
import { ProjectDashboardPage } from './routes/ProjectDashboardPage'
import { ProjectPage } from './routes/ProjectPage'
import { ProjectsPage } from './routes/ProjectsPage'
import { NewProjectPage } from './routes/NewProjectPage'
import { SchedulePage } from './routes/SchedulePage'
import { SchedulesPage } from './routes/SchedulesPage'
import { SkillEditorPage } from './routes/SkillEditorPage'

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
  const known = SETTINGS_SECTIONS.find((entry) => entry.id === section)

  useEffect(() => {
    openSettings(known?.id ?? null)
  }, [known?.id])

  // « projets » n'a jamais été une section : c'était déjà une redirection vers le
  // formulaire de création, et il reste le bon endroit où arriver.
  return <Navigate to={section === 'projets' ? '/projects/new' : '/'} replace />
}

export function App() {
  const { data: user, isPending } = useCurrentUser()

  // Écran vide plutôt qu'un spinner : la vérification de session est locale et brève,
  // un spinner qui clignote est plus désagréable que rien.
  if (isPending) return null

  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      {/* Hors des routes : les réglages s'ouvrent depuis n'importe où — le menu du
          compte, la palette, une phrase d'explication — et ne remplacent pas la vue
          qu'on avait sous les yeux. */}
      <SettingsDialog />
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/services" element={<ServicesPage />} />
          {/* La porte d'un projet est son tableau de bord ; les réglages, qui
              l'occupaient, sont passés dans son `⋯`. */}
          <Route path="/p/:projectId" element={<ProjectDashboardPage />} />
          <Route path="/p/:projectId/settings" element={<ProjectPage />} />
          <Route path="/p/:projectId/board" element={<BoardPage />} />
          <Route path="/p/:projectId/schedules" element={<SchedulePage />} />
          {/* Avant l'identifiant : « new » ne doit pas être pris pour une conversation. */}
          <Route path="/p/:projectId/c/new" element={<DraftConversationPage />} />
          <Route path="/p/:projectId/c/:conversationId" element={<ConversationPage />} />
          <Route path="/skills/:skillId" element={<SkillEditorPage />} />
        </Route>
        <Route path="/settings" element={<LegacySettingsRoute />} />
        <Route path="/settings/:section" element={<LegacySettingsRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
