/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { Pause, Play, RotateCcw, StepForward } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { cx } from '@solera/ui'
import { answerBlock, demoWaiting, resetDemo, setAutoTick, stepDemo } from './demo-store'
import { useProtoData } from './model'

/**
 * Les commandes de la démo à états : le défilement automatique du pilotage simulé (un
 * tic toutes les 3 s), un pas à la fois, et la remise à zéro. Rien hors démo.
 */
export function DemoControls() {
  const { projectId } = useParams()
  const data = useProtoData(projectId)
  if (!data.demo || !data.store) return null
  const auto = data.store.autoTick
  const waiting = demoWaiting(data.store)
  const shape = 'inline-flex items-center gap-1 rounded-lg border border-fuchsia-500/50 px-2 py-1 text-xs text-fuchsia-700 hover:bg-fuchsia-500/10 dark:text-fuchsia-300'

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={cx(shape, auto && 'bg-fuchsia-500/10')} onClick={() => setAutoTick(!auto)} title="Le pilotage simulé avance tout seul, un cran toutes les 3 s">
        {auto ? <Pause size={12} /> : <Play size={12} />}
        {auto ? 'Défilement auto' : 'Défilement en pause'}
      </button>
      <button type="button" className={shape} onClick={stepDemo} title="Chaque carte d'un jalon lancé avance d'un cran">
        <StepForward size={12} /> Avancer d'un pas
      </button>
      <button
        type="button"
        className={shape}
        onClick={() => {
          if (window.confirm('Remettre la démo à son état de départ ?')) resetDemo()
        }}
      >
        <RotateCcw size={12} /> Réinitialiser la démo
      </button>
      {/* Une question de session fige les cartes qui dépendent d'elle : le dire ici, là où
          l'on presse « Avancer d'un pas » sans comprendre pourquoi rien ne bouge. */}
      {waiting.map((entry) => (
        <span key={entry.milestoneId} className="inline-flex items-center gap-1.5 rounded-lg bg-caution/15 px-2 py-1 text-xs text-caution">
          #{entry.cardNumber} attend ta réponse : la suite est figée
          <button
            type="button"
            className="rounded px-1.5 font-medium underline-offset-2 hover:underline"
            onClick={() => answerBlock(entry.milestoneId, 'Réponse donnée depuis la démo.')}
            title={entry.question}
          >
            Répondre
          </button>
        </span>
      ))}
    </span>
  )
}
