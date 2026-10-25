# Le serveur MCP de Solera depuis un client extérieur

Solera monte dans chaque conversation un serveur MCP `solera` qui rend au CLI ce que la
plateforme sait : l'historique, le board, les sessions en cours, la mémoire, et les
gestes qui passent par le daemon (lancer une session, créer une carte, planifier). Ce
même serveur, `apps/server/src/mcp/solera-mcp.mjs`, se branche aussi depuis un client
hors de Solera : un Claude Code sur un portable, une app de bureau, un assistant sur le
téléphone. Il sert alors toute l'instance, au nom d'un compte, et c'est la façon de
lire et piloter ses sessions de loin.

Il parle en stdio et lit la base SQLite directement. Par HTTP, c'est un jeton d'API qui
authentifie ; lancé à la main sur la machine, il fait confiance à qui peut le lancer.

## Trois portées

| Variable | Conversation | Fil libre | Mode global |
|---|---|---|---|
| `SOLERA_MCP_DB` | chemin de `solera.db` | idem | idem |
| `SOLERA_MCP_GLOBAL` | — | — | **`1`** |
| `SOLERA_MCP_PROJECT` | projet servi | vide | **absent** |
| `SOLERA_MCP_CONVERSATION` | conversation courante | idem | **absent** |
| `SOLERA_MCP_USER` | — | — | compte au nom duquel écrire ; facultatif si la base n'a qu'un compte |
| `SOLERA_MCP_MEMORY` | dossier de mémoire du projet | celui du compte | racine de la mémoire (`memory/` à côté de la base par défaut) ; vide, mémoire refusée |
| `SOLERA_MCP_PROJECTS` | — | — | liste blanche d'identifiants, séparés par des virgules ; posée par le pont HTTP d'après le jeton |

**Le mode global s'ouvre par un drapeau, jamais par l'absence de projet.** Une
conversation sans projet est un *fil libre*, qui n'expose que la mémoire du compte et
la partie globale de SOLERA.md. Déduire le mode global d'une variable absente ouvrirait
toute l'instance à une session lancée avec un oubli ; le serveur refuse donc de démarrer
si `SOLERA_MCP_GLOBAL` arrive avec un projet ou une conversation.

## Ce que voit un client global

- `list_projects` donne les projets que le compte voit (les siens et les partagés,
  bornés par la liste blanche du jeton), avec leur dossier, leurs sessions en train de
  travailler et leur dernière activité.
- Les autres outils prennent un paramètre `project` : l'identifiant, le nom exact, ou un
  fragment du nom s'il ne désigne qu'un projet. Il est **requis** pour le board,
  l'historique, les lancements et les tâches planifiées ; **facultatif** pour
  `list_sessions` (omis : tous les projets du compte, et ses fils libres sans liste
  blanche), la mémoire (omis : celle du compte, la même que ses fils libres) et
  SOLERA.md (omis : la partie globale, en écriture pour les administrateurs seulement).
- `add_card_note` prend `card`, le numéro de la carte.
- Les écritures sont au nom du compte : la carte créée a cet auteur, la note aussi, sans
  note de provenance ; la session lancée appartient au compte et reçoit la mission nue,
  comme si elle avait été tapée dans Solera, à la racine du projet et sous Claude si
  `worktree` et `agent` sont omis.

### Dialoguer avec une session

Les outils de session sont ceux qu'une session Solera a déjà, au nom du compte cette
fois, plus deux qui n'ont d'équivalent que dans l'interface :

| Outil | En mode global |
|---|---|
| `read_conversation` | L'état d'abord (statut, outil en cours, et la permission, la question, le plan ou la saisie qu'elle attend, avec ce qu'il faut pour y répondre), puis le fil. `wait_seconds` attend la fin du tour, 100 s au plus. Lit toute session d'un projet que le compte voit. |
| `send_session_message` | Écrit comme l'utilisateur dans Solera : glissé dans le tour en cours si le CLI le permet, mis en file sinon ; une session au repos reprend. Sans enveloppe « d'une autre session », sans `reply_to`. |
| `interrupt_session` | Arrête le tour en cours ; un message la fait reprendre. |
| `reply_session` | Répond à la sollicitation ouverte, dans la forme qu'elle impose (`decision` et `scope` pour une permission, `answers` pour une question, etc.). |

Écrire, interrompre et répondre sont réservés aux sessions du compte, même dans un
projet partagé, comme dans l'interface et l'API. Ces trois gestes passent par le daemon
(`agent_requests`, genres `message_session`, `interrupt_session`, `reply_session`).

### Ce qui n'est pas proposé

- La messagerie entre sessions (`broadcast_session_message`, `notify_when_done`,
  `read_session_messages`) : un client hors session n'a pas de tour où être relancé ;
  `read_conversation` avec `wait_seconds` en tient lieu.
- Les demandes qui attendent le clic d'une personne (`move_conversation`,
  `request_card_change`, `propose_cards`, `request_decision`) et `create_project` : en mode global,
  l'appelant est cette personne. Les familles d'autorisation, qui bornent ce qu'un agent
  fait sans l'utilisateur, ne s'y appliquent donc pas : la barrière est la portée `mcp`
  du jeton.
- Ce qui suppose le répertoire de travail d'une session (`find_file_edits`,
  `create_worktree`, `set_project_image`, et les deux bouts de la revue d'une PR,
  `request_review` et `submit_review`) ou une vue Web à côté du fil (les outils du
  design system).

Les gestes qui passent par le daemon restent soumis à ses gardes : au plus six
lancements par heure et par compte pour tout ce qui vient hors session, et le daemon
doit tourner, sinon la demande expire.

## Citer une session

`session:<id>` désigne une conversation de Solera. La forme survit à un renommage et à
l'archivage, et ne dépend ni de l'hôte du serveur ni du port du bureau. `list_sessions`,
`search_history` et `read_conversation` la rendent, et `read_conversation` l'accepte
comme `id`.

Dans un message, l'interface en fait une puce : le CLI et le titre courant de la
session, avec son aperçu au survol (ou par le ⓘ au doigt). Elle reconnaît aussi
l'adresse d'un fil copiée du navigateur, et un UUID nu quand il nomme une session du
projet. Le code reste du code, sauf un `` `session:<id>` `` seul. Dans la barre de
saisie, `@@` cherche une session du projet, archivées comprises. Le menu « + » →
**Insérer** liste les préfixes que le champ sait compléter : `@`, `@@`, `#`, `/` et `$`.

Un message qui cite des sessions part au modèle avec quelques lignes de plus : leur
titre, leur CLI, et si elles sont archivées. Le journal garde le texte tel qu'il a été
écrit. Rien du fil cité n'est joint, l'agent le lit avec `read_conversation`, et citer
une session ne réveille pas son agent. Une session d'un autre projet ne livre rien
d'elle, pas même son titre.

## Par HTTP, avec un jeton d'API

`POST /api/v1/mcp`, transport « streamable HTTP » de MCP, derrière un jeton d'API qui
porte la portée **`mcp`** (Réglages → API et MCP, « Créer un jeton MCP », qui affiche
aussi le guide de branchement avec le jeton dedans). Le pont
(`apps/server/src/http/v1/mcp.ts`) ne réimplémente aucun outil : chaque session HTTP est
un process du serveur en mode global, au nom du compte du jeton et borné à la liste de
projets du jeton s'il en a une, et chaque message JSON-RPC lui est transmis.

- `initialize` ouvre la session et rend un en-tête `Mcp-Session-Id`, à présenter
  ensuite ; sans lui, ou après trente minutes sans requête, `404` : le client
  recommence par `initialize`. `DELETE` ferme la session.
- Toujours une réponse JSON, jamais un flux SSE ; `GET` répond `405`.
- Au plus quatre sessions par jeton ; au-delà, la plus ancienne est fermée.
- La mémoire suit l'interrupteur de l'instance `mcp.agentMemory`.

L'adresse est celle par laquelle on ouvre Solera. Depuis un autre appareil, c'est
l'adresse privée de l'instance, Tailscale d'ordinaire ([remote-access.md](remote-access.md)) :
le pont n'ouvre aucun port de plus.

Claude Code :

```bash
claude mcp add --transport http solera https://<hôte>.<tailnet>.ts.net/api/v1/mcp \
  --header "Authorization: Bearer solera_pat_…"
```

Codex, dans `~/.codex/config.toml` :

```toml
[mcp_servers.solera]
url = "https://<hôte>.<tailnet>.ts.net/api/v1/mcp"
http_headers = { "Authorization" = "Bearer solera_pat_…" }
```

Le jeton est la frontière : il écrit consignes et mémoire, lance des sessions, répond à
leurs permissions. Le restreindre à quelques projets limite ce qu'il atteint s'il fuit ;
le révoquer ferme ses sessions au prochain message.

## En stdio, sur la machine

Le `.mjs` dépend de `better-sqlite3` compilé pour le Node du daemon : à lancer avec le
même `node`. Dans une installation par le script Linux, la release courante est sous
`~/.local/share/solera/app/current`.

```bash
claude mcp add --scope user solera \
  -e SOLERA_MCP_GLOBAL=1 -e SOLERA_MCP_DB=$HOME/.local/share/solera/solera.db \
  -- node $HOME/.local/share/solera/app/current/server/mcp/solera-mcp.mjs
```

## Dans le code

- `GLOBAL`, `selectProject`, `globalTools` et `callGlobalTool` dans `solera-mcp.mjs` : le
  projet est un état du process posé au début de chaque appel, et les appels sont
  traités un par un pour qu'ils ne se chevauchent pas.
- `http/v1/mcp.ts` : le pont HTTP, un process par session, portée `mcp` des jetons.
- `agent_requests.user_id` (migration 0050) : une demande à conversation vide porte le
  compte pour qui agir ; `AgentRequests.handleGlobal` et `principal` en font un
  demandeur sans session.
- Tests : `apps/server/test/mcp-global.test.ts` et `mcp-http.test.ts`.
