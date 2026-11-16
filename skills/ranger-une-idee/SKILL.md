---
name: ranger-une-idee
description: "Range une idée de l'utilisateur sur le board du projet : petite tâche, ajout à un jalon existant, nouveau jalon, ou questions d'abord. Use when the user's message starts with « idée : » (or /ranger-une-idee), or when they mention in passing a piece of work outside this conversation's subject."
---

# Ranger une idée

L'utilisateur lance une idée en pleine conversation. Ton travail : la ranger au bon niveau
du board **sans qu'il ait à choisir la forme**, et sans rien créer qu'il n'ait validé.

## 1. Déclenchement

- **Explicite** — le message commence par « idée : » ou appelle ce skill : passe à l'étape 2.
- **En passant** — une idée glissée dans un message, qui sort du sujet de cette
  conversation (« ah et un jour il faudrait… »). Fais d'abord ce que le message demande,
  puis termine ta réponse par **une seule ligne** :
  `<l'idée en quelques mots> : je la range comme idée ?`
  S'il dit oui, passe à l'étape 2. S'il ignore la question, n'y reviens pas.

Ne propose pas de ranger :
- ce qu'il te demande de faire maintenant, ou ce qui fait partie de la tâche en cours ;
- une idée déjà rangée ou déjà sur le board ;
- plus d'une idée par message : s'il y en a plusieurs, une seule ligne les nomme toutes.

Hors d'un projet (fil libre), il n'y a pas de board : dis-le en une ligne et arrête-toi.

**Fini quand** : tu as une idée à ranger, ou tu as posé ta ligne et tu attends.

## 2. Situer l'idée

1. `list_cards`, puis `read_card` sur chaque carte dont le titre touche au sujet. Un
   **jalon** est une carte qui a des enfants ; lis ceux qui sont ouverts.
2. Lis le code concerné si la taille du travail en dépend.

**Fini quand** tu sais, pour chaque carte et chaque jalon ouverts proches, s'ils
couvrent déjà l'idée, l'accueilleraient, ou n'ont rien à voir.

## 3. Classer

Une seule des cinq formes :

| Forme | Critère |
| --- | --- |
| **Déjà là** | une carte ouverte demande déjà la même chose |
| **Petite tâche** | une session, une PR, pas de dépendance à poser |
| **Ajout à un jalon** | elle sert la cible d'un jalon ouvert, qu'elle soit petite ou non |
| **Nouveau jalon** | plusieurs PR, ou des étapes qui dépendent les unes des autres, sans jalon qui l'accueille |
| **Trop flou** | tu ne saurais pas écrire le titre d'une carte sans deviner |

Dans le doute entre *petite tâche* et *nouveau jalon*, prends la petite tâche : une carte
qui grossit se découpe plus tard, un jalon vide ne sert à rien.

## 4. Proposer

Commence toujours par **une ligne** qui dit la forme et pourquoi, pour qu'il puisse
corriger d'un mot : « Petite tâche : une PR suffit, rien ne la bloque. »

- **Déjà là** — cite la carte (`#N`) et ce qui la distingue de l'idée, s'il y a
  quelque chose. Demande s'il faut la compléter ; ne crée rien.
- **Petite tâche** — `propose_cards` avec une carte, `parent: 0`.
- **Ajout à un jalon** — `propose_cards` avec `parent: <le jalon>`, et `blocked_by`
  vers les cartes du jalon dont elle a besoin.
- **Nouveau jalon** — si la cible, le périmètre et ce qui est hors champ sont clairs,
  `propose_cards` avec `milestone` et ses cartes, reliées par `after`. Sinon, pose
  d'abord **deux à quatre questions** (la cible, ce qui est hors champ, l'ordre,
  l'échéance s'il en a une), puis propose.
- **Trop flou** — une à trois questions, pas de brouillon.

Toujours `propose_cards`, jamais `create_card` : c'est son clic qui crée. Les
descriptions se lisent sans ce fil. Cite les cartes proches dans `related`. Pas
d'échéance qu'il n'a pas donnée.

S'il corrige la forme (« non, c'est un jalon », « mets-la dans #909 »), redépose un
brouillon **entier** dans la nouvelle forme.

**Fini quand** un brouillon attend son clic, ou que tes questions sont posées, ou que
tu as montré la carte qui existait déjà.

## 5. Revenir au sujet

Quand le message de validation arrive avec les numéros, réponds en une ligne
(« Rangée en #142, sous le jalon #901. ») et reprends le travail de la conversation là
où il était.

Ne lance pas de session et ne lance pas de jalon : ranger n'est pas exécuter. S'il veut
que ça parte, il le dira.
