import type { Query, Settings } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeConfig } from '@solera/protocol'

/**
 * La couche « flag » des réglages du CLI, celle de `--settings` au lancement et
 * d'`applyFlagSettings` à chaud : ce que la conversation impose par-dessus les fichiers
 * de réglages du poste.
 *
 * Le mode rapide y est toujours écrit, même à faux : c'est la conversation qui décide,
 * pas le `settings.json` de l'utilisateur, et le CLI exige de toute façon que la
 * session le demande (`sdk_opt_in_required`, relevé à la sonde). Ultracode n'est écrit
 * qu'allumé : éteint, il n'a rien à annoncer. Les deux autres clés sont omises quand la
 * configuration ne dit rien, pour laisser le CLI à son défaut.
 *
 * Les règles `deny` de la bibliothèque de skills n'y sont posées qu'au lancement, comme
 * le masque des consignes du dépôt quand le projet tient les siennes dans SOLERA.md et
 * le dossier de mémoire. `applyFlagSettings` ne retire que les clés qu'on lui passe à
 * `null` : ne jamais nommer `permissions`, `claudeMdExcludes`, `autoMemoryDirectory` ni
 * `autoMemoryEnabled` à chaud suffit à les garder. Décocher la mémoire sous un runner
 * lancé attend donc sa relance, comme la bibliothèque de skills.
 */
export function flagSettings(
  config: ClaudeConfig,
  deny: string[] = [],
  excludes: string[] = [],
  memoryDir: string | null = null,
): Settings {
  return {
    fastMode: config.fastMode,
    ...(config.ultracode ? { ultracode: true } : {}),
    ...(config.outputStyle ? { outputStyle: config.outputStyle } : {}),
    ...(config.advisorModel ? { advisorModel: config.advisorModel } : {}),
    ...(deny.length > 0 ? { permissions: { deny } } : {}),
    ...(excludes.length > 0 ? { claudeMdExcludes: excludes } : {}),
    // La mémoire automatique de Claude, rangée chez Solera pour que Codex la partage et
    // que l'interface la montre. Claude l'écrit comme la sienne, sans permission.
    //
    // Sans dossier, la mémoire est *éteinte* et non laissée à son défaut : omettre la
    // seule clé de chemin renverrait Claude à `~/.claude/projects/<cwd>/memory`, qu'il
    // écrit tout aussi volontiers mais que personne ne voit ni ne partage — la case
    // « Mémoire » décochée aurait menti. `autoMemoryEnabled: false` lui retire le
    // dossier sans repli : sondé sur Claude Code 2.1.291, plus aucun chemin de mémoire
    // n'apparaît dans la session, et la question « as-tu un dossier de mémoire » reçoit
    // « non » pour réponse. C'est ce qui a permis d'écrire « Mémoire » plutôt que
    // « Mémoire partagée », et de dire la même phrase pour les trois CLI.
    //
    // Les sondes passent null elles aussi, et gardent donc la mémoire du poste éteinte
    // plutôt que celle-ci : ce qu'elles vérifient ne la regarde pas.
    ...(memoryDir ? { autoMemoryDirectory: memoryDir } : { autoMemoryEnabled: false }),
  }
}

/**
 * La même couche, à chaud, pour passer de `previous` à `next`. `null` retire une clé,
 * donc rend le CLI à son défaut, là où l'omettre laisserait la valeur précédente en
 * place. Le mode rapide ne prend effet qu'au tour suivant, et son état revient par le
 * `result` : sondé, `applyFlagSettings({ fastMode: true })` suffit, sans relancer.
 */
export function liveFlagSettings(
  previous: ClaudeConfig,
  next: ClaudeConfig,
): Parameters<Query['applyFlagSettings']>[0] {
  // Ultracode quand il change : chaque bascule glisse au modèle un avis « Ultracode is
  // on/off », relevé à la sonde, qu'un autre réglage n'a pas à répéter. `null` l'éteint
  // en gardant l'effort courant, que la configuration porte de toute façon. Et quand
  // l'effort change alors qu'il est allumé : depuis 2.1.284, un `effortLevel` qui
  // déplace le niveau sans la clé `ultracode` l'éteint (sondé sur 2.1.286 et 2.1.291),
  // pendant que le composer continuerait de l'afficher.
  const ultracodeKey =
    next.ultracode !== previous.ultracode || (next.ultracode && next.effort !== previous.effort)
  return {
    effortLevel: next.effort,
    fastMode: next.fastMode,
    outputStyle: next.outputStyle || null,
    advisorModel: next.advisorModel || null,
    ...(ultracodeKey ? { ultracode: next.ultracode ? true : null } : {}),
  }
}
