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

Ce que chaque adaptateur suppose de son CLI, tel qu'il a été sondé, est écrit à côté du
code : `docs/CODEX.md`, `docs/OPENCODE.md` et `docs/GROK.md` (Grok Build, le quatrième,
piloté par l'Agent Client Protocol et ses extensions `_x.ai/…`). C'est la première
chose à relire quand un CLI change de version, et à tenir à jour après la réparation.

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

## L'interface a une référence, et une seule

**Le design system vit dans son propre dépôt, [`Tipaq/solera-ds`](https://github.com/Tipaq/solera-ds),
cloné en `~/projects/solera-ds`.** Ses pages de règles sont du markdown — `docs/Principes.mdx`,
les *Fondations*, les *Gabarits* — donc lisibles comme n'importe quel fichier, sans
ouvrir un navigateur. **À lire avant de toucher à un composant.** Si le code et ces pages
divergent, c'est le code qui est en dette — sauf si le code a raison, auquel cas on change
la page d'abord, dans le dépôt du design system.

**Une valeur se change dans `src/tokens.ts` du design system, et nulle part ailleurs.**
Les primitives, les jetons et leurs règles ne se modifient pas depuis ce dépôt : voir
`AGENTS.md` du design system.

L'interface est **bilingue de structure** : aucune chaîne en dur dans un composant, tout
passe par `t('clé')` (`apps/web/src/lib/i18n`). Une chaîne écrite en français dans du
JSX est un bug, pas un raccourci — et le français est plus long que l'anglais, donc
c'est lui qui fait déborder un libellé de bouton.

### Comment Solera le consomme

`@solera/ui` est une dépendance comme une autre, **épinglée à un commit** du dépôt du
design system, dans `apps/web/package.json` et `apps/catalog/package.json` :

```jsonc
"@solera/ui": "github:Tipaq/solera-ds#<commit>"
```

Le dépôt est public : pnpm le télécharge en archive, sans jeton, en local comme en CI et
dans le `Dockerfile`. Il doit le rester, ou passer à une autre forme de dépendance : un
dépôt privé serait cloné, et le `#` du commit dans le chemin installé empêche Vite de
résoudre les imports du paquet.

Le paquet est livré en sources TypeScript, compilées par Vite avec l'application. Rien
n'en part dans la release qui ne soit pas dans le bundle.

**Changer le design system pour Solera** : on le modifie et on le pousse dans son dépôt,
puis on épingle le nouveau commit ici, dans les deux `package.json`, et `pnpm install`.
Un essai se fait de la même façon, sur une branche du design system : n'importe quel
commit poussé s'épingle. Ne pas lier le clone par `link:` : il apporterait son propre
React, chargé à côté de celui de l'application.

La règle « les primitives ne savent rien du produit » est tenue par la séparation des
dépôts : le design system n'a pas Solera parmi ses dépendances, il ne *peut pas* en
importer du code. Les deux libellés que ses primitives portent sont fournis par
l'application (`UiLabelsProvider`, posé dans `main.tsx`).

### Le catalogue de Solera

`apps/catalog` est un Storybook qui ne montre que **les composants d'application** — ceux
qui savent ce qu'est un CLI, un projet ou une conversation — et les règles propres à
Solera (`app.css` : le markdown, le confort de lecture). Il compose le Storybook du
design system par ses `refs` : les deux se parcourent dans une seule fenêtre.

```sh
cd ~/projects/solera-ds && pnpm dev # http://localhost:6418, la section « Design system »
pnpm --filter @solera/catalog dev   # http://localhost:6417
```

**Le design system d'abord.** Au démarrage, le serveur du catalogue vérifie lui-même que
la ref répond. S'il ne la trouve pas, le navigateur la charge ensuite avec ses cookies,
la politique CORS du serveur de dev du design system le refuse, et la section affiche
« Something went wrong » jusqu'au prochain redémarrage du catalogue.

Les stories restent **à côté de ce qu'elles montrent**, dans `apps/web` : un composant
renommé casse sa story au `typecheck`. **Un composant d'application ajouté reçoit sa
story dans le même commit.**

`pnpm build` ne construit pas le catalogue : il reste hors du chemin de release, pour
qu'un Storybook cassé ne fasse pas échouer une publication qui ne l'embarque pas. La CI
le construit à part, par `pnpm build:catalog`.

### Où vit quoi

| Fichier | Contenu |
| --- | --- |
| `apps/web/src/styles/index.css` | L'entrée : Tailwind, le paquet, les sources à scanner (dont `node_modules/@solera/ui/src`) |
| `apps/web/src/styles/app.css` | Les règles propres à Solera : géométrie, fil, markdown |
| `apps/web/src/lib/theme.ts` | L'application du thème, et la recopie du canevas dans `theme-color`. La liste des thèmes vient du design system |
| `apps/web/src/lib/syntax-theme.ts` | L'application de la palette de syntaxe. La liste des palettes vient du design system |
| `apps/web/src/lib/appearance.ts` | Les réglages d'apparence |
| `apps/catalog/.storybook/` | La configuration du catalogue : sources, `refs` vers le design system, thème, langue, providers |
| `apps/catalog/src/` | La page des règles propres à Solera, et ses spécimens |
| `scripts/chromium-deps.sh` | Pose Chromium sans sudo, pour capturer le catalogue |
| `docs/brand/README.md` | Le symbole, ses exemplaires, et la règle de mise à jour |

`docs/SPEC.md` §12.6 décrit l'ancien jeu de jetons (`--bg-base`, `--fg-primary`,
`--accent-subtle`, `--gradient-canvas`…), un thème personnalisé et un fond à deux halos :
rien de tout cela n'existe plus dans le code. Le design system le remplace sur le sujet
du design, et §12.6 doit y renvoyer.

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
`solera-dev`, dans `~/.config/systemd/user/`. `solera-dev` est écrite à la main — port
7417, données dans `~/.local/share/solera-dev`, et elle lance `pnpm dev` depuis le
worktree. `solera.service` vient de `deploy/solera.service.tmpl` et correspond, à
substitution des placeholders près, à ce que `install.sh` rendrait aujourd'hui.

Cette ligne a dit jusqu'au 2026-10-14 qu'`install.sh` « écraserait le service de
Sillage » : c'était vrai de l'installeur d'upstream, qui rendait son propre nom, et ça
ne l'est plus — il écrit `solera.service`, pas `sillage.service`. La raison de ne pas
l'utiliser ici est ailleurs : il résout la dernière version par l'API publique de
GitHub, ce que le dépôt privé interdit, et il bascule sans avoir éprouvé la release.

**Publier une version.** `solera.service` ne tourne **pas** depuis le worktree : il
tourne depuis le layout de l'installeur, `~/.local/share/solera/app/current`, un lien
vers `releases/<version>`. Construire dans `~/projects/solera-stable` et redémarrer le
service ne change donc rien à ce qui est servi — c'est ce que disait cette section
jusqu'au 2026-10-11, et ça a fait croire à un déploiement qui n'avait pas eu lieu.

Le worktree reste la source : on y fusionne et on y construit, puis on **stage** un
arbre d'exécution et on bascule le lien. Les quatre étapes ci-dessous sont dans cet
ordre pour une raison, et la publication du 2026-10-11 (`v0.16.0-20-g70b0852`) dit
laquelle : la bascule a eu lieu sur une release sans `node_modules`, le serveur est
mort au démarrage sur `ERR_MODULE_NOT_FOUND: drizzle-orm`, systemd a abandonné après
cinq essais, et l'agent qui publiait était déjà mort — tué par son propre
`restart` — donc personne n'a vu l'échec. Tim a réparé à la main.

**1. La release doit être complète avant la bascule.**

```sh
V=v$(git -C ~/projects/solera-stable describe --tags --always | sed 's/^v//')
APP=~/.local/share/solera/app
PREV=$(basename "$(readlink "$APP/current")")   # à garder : c'est le retour arrière
git -C ~/projects/solera-stable merge --ff-only main
(cd ~/projects/solera-stable && pnpm build && SOLERA_VERSION=$V node scripts/stage-runtime.mjs "$APP/releases/$V")
```

`stage-runtime.mjs` laisse les dépendances runtime externes : l'arbre staged n'a pas de
`node_modules`, il faut les y matérialiser. **D'abord vérifier que les dépendances du
serveur n'ont pas bougé** — si ce diff n'est pas vide, on s'arrête et on prévient Tim,
parce qu'il faut alors un vrai `npm install --omit=dev` et que cette machine ne sait pas
compiler les modules natifs (ni `make` ni `cc`, et sudo est verrouillé) :

```sh
git -C ~/projects/solera-stable diff "$PREV".."$V" -- apps/server/package.json
```

Vide : on recopie en liens durs depuis la release en place, ce qui évite la compilation.

```sh
cp -al "$APP/releases/$PREV/node_modules" "$APP/releases/$V/node_modules"
cp "$APP/releases/$PREV/package-lock.json" "$APP/releases/$V/"
test -d "$APP/releases/$V/node_modules/drizzle-orm"   # la release est-elle complète ?
```

Stager **dans** `$APP/releases` et non dans `/tmp` : les liens durs ne traversent pas
les systèmes de fichiers, et un `cp -al` qui échoue à mi-chemin laisse exactement l'arbre
incomplet qui a cassé le service.

**2. Éprouver l'arbre sur un port et des données à part.** Pas de bascule sans un
`/api/health` qui répond. `NODE_ENV` doit valoir `production`, sinon le serveur cherche
`pino-pretty`, absent d'un arbre sans devDependencies, et meurt au démarrage :

```sh
NODE_ENV=production SOLERA_PORT=7619 SOLERA_DATA_DIR=/tmp/solera-smoke \
  SOLERA_WEB_ROOT="$APP/releases/$V/web" \
  ~/.local/share/solera/node/current/bin/node "$APP/releases/$V/server/main.js" &
curl -sf http://127.0.0.1:7619/api/health   # doit répondre avant d'aller plus loin
```

**3. Prévenir Tim avant de basculer**, parce que le redémarrage va le couper de la
session : les agents sont des process enfants du service. Lui donner les deux commandes
dont il aura besoin seul — la vérification et le retour arrière :

```sh
curl -s http://127.0.0.1:7517/api/health
ln -sfn "releases/$PREV" "$APP/current.tmp" && mv -T "$APP/current.tmp" "$APP/current" && systemctl --user restart solera
```

**4. Basculer et redémarrer en une seule commande détachée**, pour qu'elle survive à la
mort de la session qui l'a lancée. Détachée *et* enchaînée : une bascule faite dans une
commande et un redémarrage dans la suivante laisse un lien neuf devant un service qui
tourne encore sur l'ancien code, et la seconde commande peut ne jamais partir.

```sh
setsid sh -c 'ln -sfn "releases/'"$V"'" "'"$APP"'/current.tmp" \
  && mv -T "'"$APP"'/current.tmp" "'"$APP"'/current" \
  && systemctl --user restart solera' >/dev/null 2>&1 < /dev/null &
```

Pour vérifier qu'une publication a bien eu lieu, comparer l'empreinte du bundle servi à
celle du disque — un `is-active` ne dit rien, et un service en échec répété non plus :

```sh
curl -s http://127.0.0.1:7517/ | grep -o 'assets/index-[^"]*\.js'
systemctl --user status solera --no-pager | head -5
```

Le dev se lance par `scripts/dev.sh`, et seulement par lui : les variables
`SOLERA_DATA_DIR`, `SOLERA_CONFIG`, `SOLERA_PORT` sont posées là et nulle part ailleurs.
Ne jamais lancer `pnpm dev` à la main avec un environnement improvisé — c'est comme ça
qu'on finit avec une instance dont la configuration ne survit pas au redémarrage.

**Un paquet du workspace qui change demande `pnpm install` puis `systemctl --user
restart solera-dev`.** Le `vite` d'une instance ouverte depuis des jours garde en cache
la version pré-optimisée d'un paquet lié et sert alors un mélange d'ancien et de neuf.
Le symptôme ne ressemble pas à sa cause : `does not provide an export named 'Tabs'` sur
un `@solera/ui` qui exporte bien `Tabs`, par exemple.

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

## La mise à jour intégrée

`apps/server/src/update/release-checker.ts` lit les releases de `Tipaq/solera`
(`SOLERA_UPDATE_REPO` pour en viser un autre, vide pour l'éteindre). Jamais celles
d'upstream : elles feraient installer Sillage par-dessus Solera. Le serveur de l'app de
bureau ne lit aucune release, l'app se met à jour seule.

Les versions de Solera suivent leur propre suite (v0.18.0, v0.19.0…), sans égard pour
les numéros de Sillage. Une version construite hors tag (`0.18.0-113-g29f39cc4`) vaut
sa version de base : la release suivante lui est proposée.

## Le dépôt

`origin` est [Tipaq/solera](https://github.com/Tipaq/solera), créé le 2026-10-10,
**public** depuis le 2026-10-28. `main` et `stable` y sont, la CI y passe, gratuitement :
c'est le passage en public qui a débloqué Actions, refusé jusque-là faute de
facturation. Les one-liners d'installation et les liens de téléchargement marchent sans
compte. `pages.yml` a toujours son déclenchement sur `push` commenté.

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

Une suite lance son navigateur par `launchBrowser()` (`scripts/checks/browser.mjs`), jamais
par `chromium.launch` : Playwright logerait la mémoire partagée de Chromium dans `/tmp`, et
un `/tmp` presque plein donne une page Vite blanche, en `ERR_INSUFFICIENT_RESOURCES`, à
une étape au hasard. Une suite qui monte un composant seul prend ses fournisseurs (React
Query, routeur, `@solera/ui`) par `viteDependency()` (`scripts/checks/vite-deps.mjs`).

## Ce qui reste à faire avant de montrer Solera à quiconque

- **Le site.** Le gros a été repris, mais trois `À CHANGER` restent dans
  `site/index.html` : le film annoncé n'a jamais été tourné (seul `film/poster.jpg`
  existe), `avatar-tipaq.jpg` est absent, et les rubans de fond prolongent encore le
  dessin de Marl alors que la marque est devenue la bague. La note « Where Solera comes
  from » dit des faits vérifiables et attend d'être signée de tes propres mots.
- **Ouvrir le dépôt**, puis activer Pages — dans cet ordre, sinon le site part avec des
  commandes d'installation mortes.
