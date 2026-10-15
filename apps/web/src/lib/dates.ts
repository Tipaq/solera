import { locale } from './i18n'

/**
 * Ancienneté d'un horodatage, dans la langue de l'interface.
 *
 * Calculée ici et non par git : `%cr` sort dans la langue du serveur, qui n'est pas
 * celle du lecteur, et se fige au moment de la requête alors qu'une liste de commits
 * reste affichée longtemps.
 */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 30],
  ['month', 12],
  ['year', Infinity],
]

export function relativeDate(ts: number): string {
  const format = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })

  let value = (ts - Date.now()) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(value) < size) return format.format(Math.round(value), unit)
    value /= size
  }
  return format.format(Math.round(value), 'year')
}

/**
 * Durée écoulée en deux caractères et une unité : « 4 min », « 1 h », « 3 j ».
 *
 * `relativeDate` écrit « il y a une heure », ce qui est juste dans une phrase et trop
 * long dans une tuile où le chiffre qui compte est déjà à côté, en grand. Celle-ci ne
 * rend que l'écart, à charge de l'appelant de dire « depuis ».
 */
export function elapsed(ts: number): string {
  const seconds = Math.max(0, (Date.now() - ts) / 1000)
  let value = seconds
  for (const [unit, size] of UNITS) {
    if (value < size) {
      return new Intl.NumberFormat(locale(), {
        style: 'unit',
        unit,
        unitDisplay: 'narrow',
        maximumFractionDigits: 0,
      }).format(Math.round(value))
    }
    value /= size
  }
  return new Intl.NumberFormat(locale(), { style: 'unit', unit: 'year', unitDisplay: 'narrow' })
    .format(Math.round(value))
}

/**
 * Ancienneté en une poignée de caractères : « 4 min », « 1 h », « 3 j ».
 *
 * `relativeDate` écrit une phrase (« il y a 4 minutes ») : juste, mais trop longue pour
 * une ligne de 32 px qui porte déjà un titre, une puce et un état. L'unité la plus
 * grande qui reste vraie suffit — à cette taille, personne ne lit à la minute près.
 *
 * Une unité formatée plutôt qu'un temps relatif : `Intl.NumberFormat` en `style: 'unit'`
 * rend « 4 min » sans le « il y a » qu'il faudrait sinon découper à la main.
 */
const SHORT_UNITS: [Intl.NumberFormatOptions['unit'], number][] = [
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', Infinity],
]

export function shortAge(ts: number): string {
  let value = Math.max(0, Date.now() - ts) / 60_000
  for (const [unit, size] of SHORT_UNITS) {
    if (value < size) {
      return new Intl.NumberFormat(locale(), { style: 'unit', unit, unitDisplay: 'short' })
        .format(Math.max(1, Math.round(value)))
    }
    value /= size
  }
  return ''
}

/**
 * Une échéance est un jour, pas un instant.
 *
 * Elle se stocke comme n'importe quel horodatage — un entier de millisecondes, comme
 * le reste du schéma, et les chronologies à venir s'en servent telles quelles — mais
 * elle se pose et se lit à la journée. Ces fonctions sont la charnière entre les deux,
 * et le minuit choisi est celui du lecteur : une date posée le 20 doit se relire
 * le 20, sans qu'un décalage horaire la rende au 19 au soir.
 */
export function dayInputValue(ts: number): string {
  const date = new Date(ts)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Le minuit local du jour saisi, ou `null` quand le champ est vide ou incomplet. */
export function dayFromInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const ts = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
  return Number.isNaN(ts) ? null : ts
}

/** Le jour, écrit court et dans la langue de l'interface : « 20 oct. ». */
export function formatDay(ts: number): string {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(ts)
}

/** Jours restants avant une échéance, négatifs quand elle est dépassée. */
export function daysUntil(ts: number): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((ts - today.getTime()) / 86_400_000)
}
