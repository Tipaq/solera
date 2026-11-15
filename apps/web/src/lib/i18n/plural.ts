/** Une règle par langue : le choix du pluriel tourne dans des listes. */
const rules = new Map<string, Intl.PluralRules>()

/**
 * La forme d'un compte, pour les clés `….one` / `….other` : celle que la règle `Intl`
 * de la langue choisit, et non `count === 1`. En français, 0 se met au singulier
 * (« 0 ligne ») ; en anglais, au pluriel (« 0 lines »).
 *
 * À part de `index.ts`, qui touche au navigateur dès son import : les tests le lisent
 * depuis Node.
 */
export function pluralIn(lang: string, count: number): 'one' | 'other' {
  let rule = rules.get(lang)
  if (!rule) rules.set(lang, (rule = new Intl.PluralRules(lang)))
  return rule.select(count) === 'one' ? 'one' : 'other'
}
