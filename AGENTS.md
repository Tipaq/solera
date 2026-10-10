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

## Les trois instances de la machine

| port | quoi | données |
| --- | --- | --- |
| 7517 | Solera stable (service systemd, build) | `~/.local/share/solera` |
| 7417 | Solera dev (`scripts/dev.sh`, `tsx watch`) + vite sur 5417 | `~/.local/share/solera-dev` |
| 7317 | **Sillage installé — le produit de Marl, gardé pour suivre son travail en utilisateur** | `~/.local/share/sillage` |

**Ne jamais toucher à `~/.local/share/sillage` ni à l'unité `sillage.service`.** Ce n'est
pas notre produit, et les données qui s'y trouvent sont celles du travail quotidien.

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
  Le réglage *Settings > Pages > Source = GitHub Actions* n'a volontairement pas été fait ;
- `release.yml` publierait sur `ghcr.io/tipaq/solera`, jamais déclenché pour l'instant.

## Chromium ne tourne pas sur cette machine

`playwright install` pose bien le binaire, mais il lui manque `libnspr4` et `libnss3`,
que seul `playwright install-deps` installe — par apt, donc avec un `sudo` qu'on n'a pas.

Conséquence : tous les scripts `*-ui-check.mjs` et `screenshots.mjs` sont inutilisables
ici. `brand-assets.mjs` a été basculé sur `@resvg/resvg-js`, un binaire autonome sans
dépendance système, et tourne donc normalement.

## Ce qui reste à faire avant de montrer Solera à quiconque

- **Le site.** Le gros a été repris, mais trois `À CHANGER` restent dans
  `site/index.html` : le film annoncé n'a jamais été tourné (seul `film/poster.jpg`
  existe), `avatar-tipaq.jpg` est absent, et les rubans de fond prolongent encore le
  dessin de Marl alors que la marque est devenue la bague. La note « Where Solera comes
  from » dit des faits vérifiables et attend d'être signée de tes propres mots.
- **Ouvrir le dépôt**, puis activer Pages — dans cet ordre, sinon le site part avec des
  commandes d'installation mortes.
