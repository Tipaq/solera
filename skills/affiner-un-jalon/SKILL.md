---
name: affiner-un-jalon
description: "Affine un jalon du board jusqu'à un découpage en cartes : lit le jalon et le projet, pose les questions qui manquent, puis propose les cartes par propose_cards. Use when the message starts with /affiner-un-jalon #N (optionally --decouper), when the user asks to refine or split a milestone, or when a message starts with « Ajout au jalon »."
---

# Affiner un jalon

Un jalon est une carte du board qui regroupera des cartes enfants. Ton travail : l'amener
de l'idée à **un découpage validable** — des cartes reliées par leurs dépendances —, en
ne demandant à l'utilisateur que ce que tu ne peux pas trouver seul.

Le message d'appel porte le numéro du jalon (`#N`), parfois `--decouper`, puis le texte
que l'utilisateur a écrit (une phrase ou un brief) et ses pièces jointes (cartes `#M`,
liens).

## 1. Lire

1. `read_card` sur le jalon `#N` : sa description, ses enfants s'il en a déjà, ses notes.
2. `read_card` sur chaque carte citée ; ouvre les liens joints si tu le peux.
3. `list_cards` : ce qui existe déjà et touche au sujet — à citer plutôt qu'à recréer.
4. Le code et les docs du projet là où le sujet les touche (`AGENTS.md`, les fichiers
   concernés), assez pour savoir ce qui est faisable et dans quel ordre.

**Fini quand** tu sais ce que le jalon vise, ce qui existe déjà, et ce que tu ne sais pas.

## 2. Décider : questions ou découpage

Tu découpes **sans demander** si tu sais écrire chaque carte sans deviner : la cible,
le périmètre (et ce qui est hors champ), l'ordre. C'est le cas d'un brief détaillé, ou
quand `--decouper` est passé et que rien d'essentiel ne manque.

Sinon, pose **au plus 4 questions**, une par sujet, avec **l'outil de question de ton CLI**
(`AskUserQuestion`, `request_user_input`…), toutes dans un seul appel, puis attends les
réponses : la page du jalon les montre et on y répond sur place. Chacune porte ta
proposition par défaut (« Je partirais sur X — ça te va ? ») :
- la **cible** : à quoi on reconnaîtra que c'est fini ;
- le **hors champ** : ce qu'on ne fait pas ;
- l'**ordre** ou les dépendances quand il y a un vrai choix ;
- l'**échéance**, seulement si le sujet en appelle une.

Ne pose pas une question dont la réponse est dans le code, les cartes ou le brief. Sans
outil de question, écris-les dans ta réponse et termine ton tour.
Après les réponses, complète la description du jalon (`append_card_description`) avec
ce qui a été décidé — c'est elle que les sessions des cartes liront.

`--decouper` avec un point vraiment ouvert : une seule question, puis le découpage.

**Fini quand** tu as tout pour écrire les cartes, ou que tes questions sont posées.

## 3. Proposer le découpage

`propose_cards` avec `parent: N` (le jalon) — jamais `create_card` : c'est le clic de
l'utilisateur qui crée.

- Une carte = **une session, une PR**. Les petits pas vont en sous-tâches.
- Chaque description se lit **sans ce fil** : le besoin, ce qui est décidé, les fichiers
  concernés, les critères pour dire que c'est fini.
- Les dépendances en `after` (entre cartes du brouillon) ou `blocked_by` (cartes
  existantes). Garde du parallèle : ne chaîne que ce qui dépend vraiment.
- Cite les cartes proches dans `related` ; une carte jointe « à inclure » devient une
  enfant (mentionne-la), une carte « en référence » reste un lien.
- Pas d'échéance qu'on ne t'a pas donnée.

Termine par **une ligne** qui résume : combien de cartes, combien de vagues (ce qui peut
partir en parallèle), et ce qui reste ouvert s'il y a lieu.

S'il corrige le découpage dans le fil, redépose un brouillon **entier**.

**Fini quand** un brouillon attend son clic.

## 4. Après la validation

Quand le message de validation arrive avec les numéros, réponds en une ligne et arrête-
toi. Ne lance pas le jalon et n'ouvre pas de sessions : ranger n'est pas exécuter. S'il
veut lancer, il le fera depuis la page du jalon.

## Un ajout au jalon

Un message « Ajout au jalon : … » prolonge un jalon déjà découpé. Lis-le comme au 1,
puis range-le **là où il tient** :
- une carte du jalon en parle déjà : ses **sous-tâches**, par `request_card_change` sur
  cette carte avec `add_subtasks`, la raison disant pourquoi elle ;
- sinon, des **nouvelles cartes** : `propose_cards` avec `parent: N`, `blocked_by` la
  carte la plus proche.

**Fini quand** la proposition attend son clic.
