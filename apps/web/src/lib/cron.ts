import { Cron } from 'croner'
import cronstrue from 'cronstrue'
/*
 * Les deux langues de l'interface, et seulement elles.
 *
 * **L'anglais est déjà dans `cronstrue`** : le moteur embarque son propre
 * `enLocaleLoader`, il n'y a rien à importer pour lui (`cronstrue/locales/en` existe
 * mais ne ferait que redéfinir à l'identique, pour 5 Ko de plus). **Le français est
 * cette ligne-ci** : chaque autre langue est un fichier séparé qui se greffe sur
 * `cronstrue.locales` par effet de bord, d'où l'import sans liaison.
 *
 * On importait avant `cronstrue/i18n`, qui fait la même chose pour les quarante langues
 * du paquet : 186 Ko minifiés au lieu de 22, dans le bundle principal, pour
 * trente-huit langues que l'interface n'affiche jamais.
 *
 * Donc : une langue ajoutée à `LOCALE_LABELS` se complète d'une ligne ici. Sans elle,
 * ses phrases cron restent en anglais — `cronstrue` se rabat sur sa langue par défaut
 * avec un avertissement console, il ne lève rien et l'écran ne montre pas de trou.
 */
import 'cronstrue/locales/fr'

/**
 * Lecture humaine d'un motif cron, et prochains passages.
 *
 * Un champ où l'on écrit `45 4 * * *` sans rien d'autre à l'écran est un piège : la
 * faute de frappe ne se voit qu'à l'exécution, le lendemain, et par son absence. La
 * phrase et les trois prochaines dates sont ce qui rend le motif vérifiable au moment
 * où on l'écrit.
 *
 * Calculé dans le navigateur : c'est ce qui met l'aperçu à jour à la frappe, sans
 * aller-retour. Contrepartie assumée, les dates sont celles du poste et non du serveur,
 * ce que l'écran dit.
 */

/** Null quand le motif est invalide, ce qui en fait aussi le test de validité. */
export function cronToHuman(expression: string, locale: string): string | null {
  if (!expression.trim()) return null

  try {
    return cronstrue.toString(expression, {
      locale,
      use24HourTimeFormat: true,
      throwExceptionOnParseError: true,
    })
  } catch {
    return null
  }
}

export function cronNextRuns(expression: string, count: number): Date[] {
  if (!expression.trim()) return []

  try {
    return new Cron(expression).nextRuns(count)
  } catch {
    return []
  }
}
