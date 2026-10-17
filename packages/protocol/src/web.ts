/**
 * Une page du web, lue par le serveur pour la vue *Web* du panneau.
 *
 * Le panneau ne peut pas afficher n'importe quel site dans un cadre : la plupart
 * l'interdisent (`X-Frame-Options`, `frame-ancestors`). Le serveur lit donc la page à
 * sa place et en rend le texte, nettoyé — c'est le mode *Lecture*. `embeddable` dit si
 * le mode *Direct*, le cadre, a une chance de s'afficher.
 */
export interface WebPageDto {
  /** L'adresse finale, redirections suivies : c'est elle que la barre affiche. */
  url: string
  title: string
  siteName: string | null
  byline: string | null
  /**
   * Le contenu lisible, en HTML nettoyé : ni script, ni style, ni attribut
   * d'événement, liens et images en adresses absolues. Null quand la page n'est pas
   * du HTML — une image, un PDF —, que seul le mode *Direct* sait montrer.
   */
  html: string | null
  contentType: string
  /** Faux quand la page interdit qu'on l'affiche dans un cadre. */
  embeddable: boolean
}
