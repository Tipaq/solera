# @solera/ui

Les primitives d'interface de Solera, et les jetons dont elles sont faites.

**Ce paquet ne sait rien du produit.** Pas de CLI, pas de projet, pas de conversation :
un bouton, un champ, un menu. La frontière n'est plus une convention écrite dans un
document, c'est le graphe de dépendances — le paquet ne dépend pas de `@solera/web`, donc
il ne *peut pas* importer du code applicatif.

C'est ce qui a motivé l'extraction. Trois primitives franchissaient déjà la ligne sans
que rien ne l'empêche : `Select` et `ConfirmDialog` allaient chercher des libellés dans
le catalogue de traduction de l'application, et `Tooltip` un hook dans ses utilitaires.
Les deux premières prennent maintenant leurs libellés en props — **un design system ne
possède pas la copie du produit** — et le hook a été versé ici, où il est générique.

## Ce qu'il contient

| | |
| --- | --- |
| `src/*.tsx` | Les primitives, et leurs stories à côté |
| `src/tokens.ts` | Les échelles statiques — rayons, pas de texte, polices — avec leur rôle |
| `src/styles/scales.generated.css` | Généré depuis `tokens.ts` par `pnpm ui:tokens`. Ne pas éditer |
| `src/styles/tokens.css` | Les jetons `--sg-*`, les trois thèmes, les dix palettes de syntaxe |
| `src/styles/index.css` | Le mapping vers Tailwind, les utilitaires et la base partagés |

Les **couleurs** ne sont pas dans `tokens.ts` et ne peuvent pas y être : elles sont
calculées à l'exécution en `oklch()` depuis `--sg-hue`, `--sg-tint` et `--sg-lift`, que
les réglages d'apparence déplacent. Qui veut en afficher la valeur la lit sur le document.

## S'en servir

```ts
import { Button, Card, Field } from '@solera/ui'
import { RADII, TEXT_STEPS } from '@solera/ui/tokens'
```

```css
@import '@solera/ui/styles.css';
```

Tailwind ne scanne pas `node_modules` : l'application qui consomme ce paquet doit
déclarer `@source` vers ses sources, sinon aucune classe des primitives n'est générée.

## La règle

Les règles de conception vivent dans le catalogue, `apps/catalog/src/*.mdx` — ses pages
sont du markdown, lisibles sans ouvrir un navigateur. Les valeurs des échelles statiques
vivent dans `src/tokens.ts`, et nulle part ailleurs. Une primitive ajoutée ici reçoit sa
story dans le même commit.
