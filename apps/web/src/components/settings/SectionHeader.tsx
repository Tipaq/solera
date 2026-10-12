/**
 * Le chapeau d'une section de réglages : la phrase qui dit ce qu'on y règle.
 *
 * Le titre ne s'écrit plus ici. La modale le porte dans sa barre, au-dessus du trait,
 * et l'écrire une seconde fois en tête du contenu le répétait à deux lignes d'écart.
 * Le prop reste reçu — chaque section le donne, et il dit au lecteur du code de quelle
 * section il s'agit — mais c'est le catalogue qui le rend, une fois, dans la barre.
 */
export function SectionHeader({ description }: { title: string; description?: string }) {
  if (!description) return null
  return <p className="mb-4 text-sm text-ink-faint">{description}</p>
}
