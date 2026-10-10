# Solera — consignes de travail

## D'où vient ce dépôt

Solera descend de [Sillage](https://github.com/MarlBurroW/sillage) (MIT, MarlBurroW),
cloné le 2026-10-09 à la hauteur de `upstream/main` = `54bf5e8`. Tout le code de départ
est le sien ; la licence et son copyright sont conservés dans `LICENSE`.

**Le cordon est coupé.** Le remote `upstream` reste là, en lecture seule, comme **source
d'idées** — jamais comme parent. On ne fusionne pas, on ne *cherry-pick* pas.

Pour voir ce qu'il a fait et décider si on le veut :

```sh
git log -p upstream/main -- apps/server/src/agents/claude
```

Puis on le réimplémente dans les termes de Solera, avec nos besoins. `git diff upstream/main`
est inutilisable : tous les fichiers diffèrent à cause du renommage.

Ce qu'on perd en coupant, et qu'il faut assumer : il entretenait la plomberie des CLI
(~8 commits par mois sur `agents/claude`, `agents/codex`, `cli/`). Quand Claude Code ou
Codex changent leur protocole, c'est à nous de réparer.

## Le nom

Le produit s'appelle **Solera** — le système de barriques du xérès, où l'on recomplète la
vieille avec la jeune : la recette ne bouge pas, le résultat ne dérive pas, et ce qui est
validé est réinjecté au lieu d'être redemandé.

Le renommage depuis « sillage » est **exhaustif et définitif**. Ne jamais revenir en
arrière, ne jamais accepter les deux noms : un agent qui lit deux noms pour le même outil
hésite sur le fichier de consignes et sur le serveur MCP.

Deux endroits où « sillage » subsiste légitimement, et qu'on ne touche pas :

- `packages/db/migrations/**` — un registre historique ne se réécrit pas. Renommer un
  fichier de migration ou son contenu change les empreintes et casse toute base existante.
- `LICENSE` — le copyright de l'auteur original.

## L'interface suit un document, pas le goût du moment

`docs/design-system.md` est la référence normative de l'interface web : jetons, échelle
typographique, rayons, densités, gabarit de dialogue, primitives. **À lire avant de
toucher à un composant**, et à modifier dans le même commit quand on change une règle —
si le code et le document divergent, c'est le code qui est en dette.

Le design system est un **paquet**, `@solera/ui` : les primitives, les jetons, la
feuille partagée. Il ne dépend pas de `@solera/web`, donc il ne *peut pas* importer du
code applicatif — la règle « les primitives ne savent rien du produit » est tenue par le
graphe de dépendances et non par une relecture.

Les **échelles statiques** — rayons, pas de texte, polices — ont une seule source,
`packages/ui/src/tokens.ts`, qui porte la valeur *et* le rôle de chaque pas. Le bloc
`@theme` qui les déclare en est **généré** :

```sh
pnpm ui:tokens         # réécrit packages/ui/src/styles/scales.generated.css
pnpm ui:tokens:check   # échoue si le CSS commité a dérivé — en CI
```

Ne pas éditer `scales.generated.css` à la main : la prochaine génération l'écrase. Les
**couleurs** ne sont pas là et ne peuvent pas y être : elles sont calculées à l'exécution
en `oklch()` depuis les réglages d'apparence de l'utilisateur.

Le catalogue qui le montre est un Storybook, dans son propre espace de travail :

```sh
pnpm --filter @solera/catalog dev   # http://localhost:6417
```

Ni l'un ni l'autre n'est une fonctionnalité de Solera : rien n'en part dans le bundle.
Les stories, elles, restent **à côté de ce qu'elles montrent** — celles des primitives
dans `packages/ui`, celles des composants d'application dans `apps/web` — parce qu'une
primitive renommée casse alors sa story au `typecheck`. Le catalogue ne fait que les
rassembler, et porter la documentation.

**Une primitive ajoutée à `packages/ui` reçoit sa story dans le même commit.**

Le document porte un relevé des écarts restants (§14) : c'est le chantier en cours, pas
une liste de vœux.

## Les trois instances de la machine

| port | quoi | données |
| --- | --- | --- |
| 7517 | Solera stable (service systemd, build) | `~/.local/share/solera` |
| 7417 | Solera dev (`scripts/dev.sh`, `tsx watch`) + vite sur 5417 | `~/.local/share/solera-dev` |
| 7317 | **Sillage installé — le produit de Marl, gardé pour suivre son travail en utilisateur** | `~/.local/share/sillage` |

**Ne jamais toucher à `~/.local/share/sillage`.** Ce n'est pas notre produit, et les
données qui s'y trouvent sont celles du travail quotidien. L'unité `sillage.service` est
arrêtée et `disable` depuis le 2026-10-10, à la demande de Tim, pour rendre ses 2 Go au
reste de la machine ; `systemctl --user enable --now sillage.service` la ramène, et c'est
la seule chose à faire sur elle sans qu'il le demande.

Les deux instances de Solera sont des unités systemd utilisateur, `solera` et
`solera-dev`, écrites à la main dans `~/.config/systemd/user/` — pas par `install.sh`,
qui rendrait un nom de service fixe et écraserait celui de Sillage.

**Publier une version** : la stable tourne depuis le worktree `~/projects/solera-stable`
sur la branche `stable`. Donc :

```sh
git -C ~/projects/solera-stable merge main && \
  (cd ~/projects/solera-stable && pnpm build) && \
  systemctl --user restart solera
```

Le dev se lance par `scripts/dev.sh`, et seulement par lui : les variables
`SOLERA_DATA_DIR`, `SOLERA_CONFIG`, `SOLERA_PORT` sont posées là et nulle part ailleurs.
Ne jamais lancer `pnpm dev` à la main avec un environnement improvisé — c'est comme ça
qu'on finit avec une instance dont la configuration ne survit pas au redémarrage.

## Le garde-porte WSL

WSL éteint une distribution une quinzaine de secondes après la sortie du dernier process
lancé *depuis Windows* — les services systemd ne comptent pas dans ce calcul. Il faut
donc un process d'origine Windows qui ne fait rien d'autre qu'exister :
`~/.local/share/solera/wsl/keepalive`, qui finit sur `flock -n keepalive.lock sleep
infinity`. Le `flock` évite qu'un second raccourci empile un second gardien.

Deux raccourcis Windows le lancent, posés le 2026-10-10 : `Solera.lnk` dans le menu
Démarrer (avec `--open`, qui attend `/api/health` puis ouvre le navigateur) et le même
dans *Démarrage*, sans `--open`, à la connexion Windows. Tous deux passent par
`wslg.exe -d Ubuntu --`, qui n'ouvre pas de console.

Le script et les raccourcis ont été écrits à la main, en recopiant le bloc `KEEPER=` et
`ps_shortcuts()` d'`install.sh` (`install.sh:546`) : garder les deux alignés. Avant cette
date, c'était le gardien de **Sillage** qui tenait la porte ouverte pour toute la machine
— tuer son `flock` aurait emporté Solera avec lui. Ce n'est plus le cas, et son entrée
`Sillage.lnk` dans *Démarrage* est désormais redondante.

## La mise à jour intégrée est éteinte

`apps/server/src/update/release-checker.ts` ne vise plus aucun dépôt
(`SOLERA_UPDATE_REPO` vide par défaut). C'est volontaire : pointer sur les releases
d'upstream ferait proposer l'installation de Sillage par-dessus Solera.

## Le dépôt

`origin` est [Tipaq/solera](https://github.com/Tipaq/solera), **privé** pour l'instant,
créé le 2026-10-10. `main` et `stable` y sont, la CI y passe.

Tant qu'il est privé, trois choses ne marchent pas et c'est normal :

- les one-liners d'installation du site tirent `install.sh` depuis
  `raw.githubusercontent.com`, qui répond 404 sur un dépôt privé ;
- `pages.yml` ne peut pas déployer — GitHub Pages sur dépôt privé demande un compte Pro.
  Son déclenchement sur `push` est donc commenté, pour qu'un échec permanent ne masque
  pas les vrais ; il reste lançable à la main. Le réglage *Settings > Pages > Source =
  GitHub Actions* n'a volontairement pas été fait ;
- `release.yml` publierait sur `ghcr.io/tipaq/solera`, jamais déclenché pour l'instant.

## Chromium tourne, sans sudo

`playwright install` pose les binaires, mais ils ne démarrent pas : il leur manque une
vingtaine de bibliothèques système que seul `playwright install-deps` poserait — par
apt, donc avec un `sudo` qu'on n'a pas.

**Ce n'est pas bloquant, contrairement à ce qui était écrit ici.** `apt-get download`
n'a jamais demandé de privilèges, et `dpkg -x` extrait un `.deb` où l'on veut :

```sh
./scripts/chromium-deps.sh
export LD_LIBRARY_PATH="$HOME/.local/lib/chromium-deps/usr/lib/x86_64-linux-gnu"
```

26 Mo dans `~/.local`, rien d'installé pour le système. La liste des paquets vient de
`deb.deps`, que Playwright livre à côté du binaire — c'est sa propre déclaration, pas
une liste devinée.

Les scripts `*-ui-check.mjs` et `screenshots.mjs` fonctionnent donc, de même que toute
capture d'écran du catalogue. `brand-assets.mjs` reste sur `@resvg/resvg-js`, un binaire
autonome sans dépendance système.

## Ce qui reste à faire avant de montrer Solera à quiconque

- **Le site.** Le gros a été repris, mais trois `À CHANGER` restent dans
  `site/index.html` : le film annoncé n'a jamais été tourné (seul `film/poster.jpg`
  existe), `avatar-tipaq.jpg` est absent, et les rubans de fond prolongent encore le
  dessin de Marl alors que la marque est devenue la bague. La note « Where Solera comes
  from » dit des faits vérifiables et attend d'être signée de tes propres mots.
- **Ouvrir le dépôt**, puis activer Pages — dans cet ordre, sinon le site part avec des
  commandes d'installation mortes.
