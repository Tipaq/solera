---
status: accepted
date: 2026-11-08
---

# Environnements d'exécution des sessions : où tourne l'agent, et confiné ou non

Tim veut installer Solera sur son poste de travail, sous Windows et WSL. Ses projets de boulot reposent sur des dev containers fournis par l'équipe, qu'il ne peut pas modifier. Il veut aussi, à terme, isoler les sessions qui travaillent seules, à la manière de [Sandcastle](https://github.com/mattpocock/sandcastle). Aujourd'hui, chaque CLI d'agent et chaque terminal est lancé sur l'hôte, dans le dossier du projet. Ses commandes n'ont donc pas la chaîne d'outils du conteneur, et rien ne le confine.

On décide d'une seule notion, l'**environnement d'exécution** d'une session, avec deux axes indépendants :

- **où ça tourne**, c'est-à-dire la chaîne d'outils : l'hôte, le dev container du projet, puis peut-être plus tard le cloud ;
- **le confinement** : aucun, ou confiné.

On n'a pas fait de « mode dev container » et de « mode sandbox » séparés, parce que les combinaisons (dev container confiné pour une session autonome au boulot, par exemple) se seraient construites deux fois.

## Les décisions

- **Le CLI entier tourne dans l'environnement**, pas seulement ses commandes shell. Sinon, les outils de fichiers, les hooks et les serveurs MCP du projet verraient un autre monde que le shell. Le serveur et l'interface de Solera restent sur l'hôte. Un terminal ouvert depuis une session suit l'environnement de cette session, et un terminal ouvert hors session prend celui du projet par défaut.
- **Réglage** : le projet a un environnement par défaut, proposé « dev container » si `.devcontainer/` existe. Une session peut en choisir un autre à sa création, et ne change plus ensuite. Les sessions autonomes (tâches planifiées, sessions lancées depuis une carte ou un jalon) prennent par défaut la version confinée de l'environnement du projet quand la plateforme le permet. Un projet qui n'a rien réglé reste sur l'hôte, non confiné, comme avant.
- **Le dev container est lu, jamais écrit.** Le `devcontainer.json` du dépôt est la source de vérité, et on passe par le CLI officiel `@devcontainers/cli` (`up`, `exec`) au lieu de réimplémenter la spec. Ce dont Solera a besoin s'ajoute par les options de lancement (montages, variables), comme le fait VS Code. Un projet sans `.devcontainer/` qui veut un conteneur utilise un `devcontainer.json` gardé par Solera, hors du dépôt : il n'y a qu'un seul mécanisme de conteneur.

  Précisé à la livraison (#143) : il vit dans `<données>/devcontainers/<projet>/devcontainer.json` et passe au CLI par `--config`, qu'on ne donne que pour lui. Celui du dépôt garde ainsi l'identité de conteneur que VS Code lui donne, et le sien, marqué d'un autre `devcontainer.config_file`, ne se confond pas avec un conteneur de VS Code. Le modèle de départ est l'image `mcr.microsoft.com/devcontainers/base:ubuntu`, qui a git, plus la feature officielle de chaque stack reconnue à un fichier de la racine (`package.json`, `pyproject.toml`, `go.mod`…). Les réglages du projet le créent, l'éditent et le retirent ; dès que le dépôt a son `.devcontainer`, celui de Solera est ignoré. Le retirer ramène à l'hôte un projet qui y avait son environnement par défaut. L'éditer ne touche pas un conteneur déjà démarré : il faut le reconstruire.
- **Le CLI est apporté par Solera, à la manière du serveur de VS Code.** Solera télécharge sur l'hôte la version Linux de chaque CLI pour l'architecture du conteneur, à la même version que sur l'hôte, et la monte en lecture seule. On ne dépend ni de Node dans l'image ni du réseau du conteneur, et on n'installe rien dedans.
- **Un dev container par projet**, partagé par ses sessions non confinées et réutilisé s'il tourne déjà, y compris quand VS Code l'a démarré. Les worktrees y sont montés de façon que les liens de git restent valides. Solera démarre le conteneur à la première session qui en a besoin et ne l'arrête jamais de lui-même. Ses ports (`forwardPorts`, et ceux qu'on détecte) sont redirigés pour l'aperçu web.
- **Une session confinée dans un dev container a son propre conteneur**, éphémère, construit sur la même image, avec son seul worktree monté, et supprimé à la fin de la session. On le paie de quelques secondes de démarrage. En échange, des sessions autonomes en parallèle ne se voient pas.
- **Confiné** signifie :
  - l'agent n'écrit que dans son dépôt ou son worktree, plus un `tmp` et un `home` privés ;
  - les identifiants de l'hôte, les autres dépôts et la base de Solera lui sont invisibles ;
  - `.git/config` et `.git/hooks` sont en lecture seule ;
  - ses processus meurent avec la session ;
  - le réseau reste ouvert pour l'instant.

  Une session confinée peut tourner sans demandes d'autorisation, puisque le confinement est le garde-fou.

  Précisé à la livraison du confinement natif (#144) :
  - **git** : `config` et `hooks` ne suffisent pas, `commondir`, `config.worktree` ou `modules/*/config` redirigent aussi git vers une config que l'agent écrirait. Un worktree n'écrit donc que `objects`, `refs`, `logs` et son propre dossier d'administration, dont `commondir`, `gitdir` et `config.worktree` restent en lecture seule. Le `.git` d'un dépôt simple est en lecture seule en entier : une session confinée qui doit commiter travaille dans un worktree. Hors dépôt, un `.git` vide en lecture seule empêche l'agent de faire `git init` là où le serveur lance git, et la fermeture le retire ; un sous-dossier de dépôt est refusé, ce `.git` y casserait git sur l'hôte. L'entretien automatique de git (`gc.auto`, `maintenance.auto`) est coupé dans le bac à sable.
  - **Ce qu'elle écrit hors de son dossier** : la mémoire du projet, le dossier des prototypes, le home du compte Codex ou Grok, et les transcripts Claude de son dossier de travail. Ces derniers le sont pour que la reprise survive au home privé ; une session non confinée du même dossier peut donc reprendre un historique que l'agent confiné a réécrit.
  - **La fin de la session** est l'arrêt de son runner, y compris par inactivité : le home privé s'efface alors, et la reprise repart des transcripts et du home du compte.
  - **Les pièces jointes** ne sont pas montées, leur dossier mêle tous les projets : chaque fichier envoyé est copié dans le tmp privé de la session.
  - **Pas de sortie par Solera** : une session confinée ne lance que des sessions confinées, ne planifie pas de tâche, et une action de type service qu'elle lance passe par un terminal confiné, pas par systemd.
  - **Refus** : sans compte Solera (la connexion du CLI vit dans le home de l'hôte), et pour OpenCode, qui n'a pas encore de compte isolé.
- **Les identifiants ne traversent pas en fichiers personnels.** Le jeton du compte choisi passe par une variable d'environnement, comme le fait déjà Claude. Pour un CLI qui exige un dossier (Codex, Grok), Solera monte un dossier propre au compte, qui ne contient que ses identifiants. Il n'y a aucun lien vers `~/.codex` ni vers un autre dossier personnel. Solera y recopie à chaque lancement la configuration de l'utilisateur, débarrassée de ce qui peut porter un secret, ses consignes et ses skills ; une conversation passe d'un compte à l'autre par copie de ses fichiers (#139).
- **Le MCP de Solera passe par HTTP avec un jeton de session**, et ce pour tous les environnements, hôte compris. Le script stdio qui lit directement la base SQLite disparaît : il ne fonctionnerait pas dans un conteneur, et confiné il ouvrirait toute la base à l'agent. Le jeton est limité au projet, à la conversation et aux droits de la session, et meurt avec elle. Précisé à la livraison (#138) : c'est le CLI qui ne lance plus le script. Le `.mjs` reste l'implémentation des outils, et c'est le serveur de Solera qui le lance sur l'hôte, derrière le pont HTTP. La base reste ainsi hors de portée de l'agent.
- **Plateformes** :
  - Linux et WSL : dev container, et confinement natif par bwrap ;
  - macOS : dev container, et confinement natif par seatbelt ;
  - Windows natif : dev container, et confinement seulement par un conteneur.

  Une session confinée que la plateforme ne sait pas confiner refuse de démarrer, en disant pourquoi et comment y remédier. Elle ne retombe jamais en silence sur une session non confinée.
- **Visibilité** : la page Services gagne une liste « Environnements ». Pour chacun, elle affiche le type, le projet, les sessions et les terminaux qui l'utilisent, l'état, le CPU, la mémoire, le disque et les ports. Elle permet d'arrêter, de redémarrer, de reconstruire et de voir le journal. Arrêter un environnement utilisé demande une confirmation qui dit qui s'en sert. Pour l'instant, on affiche la consommation sans imposer de plafond.

## Options écartées

- **Faire tourner Solera dans le dev container** : il faudrait une instance par conteneur, et on perdrait la vue sur plusieurs projets.
- **Une consigne `devcontainer exec` dans l'`AGENTS.md`** : ça repose sur la discipline de l'agent, et les outils de fichiers et les hooks restent sur l'hôte.
- **Laisser le CLI sur l'hôte et ne rediriger que ses commandes shell** : l'agent verrait deux mondes à la fois.
- **Installer le CLI dans le conteneur par `npm`** : ça dépend de Node et du réseau de l'image, et ça modifie un environnement qui n'est pas à nous.
- **Monter `~/.claude` ou `~/.codex`** : ça exposerait toutes les connexions de l'hôte et ne distinguerait pas les comptes.
- **Un conteneur par worktree pour toutes les sessions** : les services docker-compose seraient en double, les ports en conflit, et chaque démarrage prendrait des minutes. On ne le garde que pour les sessions confinées.
- **Prendre Sandcastle comme dépendance** : il est taillé pour des tirs non interactifs (`claude --print`), alors que Solera tient des sessions vivantes par le SDK, l'app-server de Codex et ACP. On reprend ses idées (le contrat d'un provider : `exec`, `close`, copie, chemin du worktree ; le montage de git en lecture seule ; les jetons en variables), pas sa bibliothèque.

## Ordre de livraison

1. Hôte et dev container non confiné.
2. Confinement natif.
3. Confinement dans un conteneur et sessions autonomes confinées.
4. Le cloud, peut-être jamais.

Le jalon et ses cartes portent le détail.
