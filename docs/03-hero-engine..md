# 🌍 Hero Engine

> Version : 1.0
>
> Le Hero est la signature visuelle de PokéTracker.
>
> Ce document explique sa philosophie, son architecture et les règles qui garantissent sa cohérence.
>
> Le Hero ne doit évoluer qu'avec une excellente raison.

---

# Sommaire

1. Pourquoi le Hero existe
2. Philosophie
3. Architecture
4. Theme Engine
5. Hero Worlds
6. Composition
7. Lisibilité
8. Animations
9. Responsive
10. Évolution
11. Anti-patterns
12. Checklist

---

# 1. Pourquoi le Hero existe

Le Hero n'est pas une bannière.

Il n'est pas une décoration.

Il est la première émotion ressentie lorsqu'un utilisateur ouvre PokéTracker.

Avant même de lire un chiffre, un nom ou un prix, l'utilisateur doit ressentir que l'application est dédiée aux collectionneurs.

Le Hero définit cette première impression.

---

# 2. Philosophie

## La carte est le héros

Le Hero ne parle pas du type Pokémon.

Le Hero parle de la carte.

Le type sert uniquement à définir son univers.

La carte reste toujours le point focal.

Tout le reste est secondaire.

---

## Le monde raconte une histoire

Nous ne représentons pas un élément.

Nous représentons un monde.

Exemple :

❌ Type Électrik

✔ Tempête céleste

---

❌ Type Eau

✔ Maelström

---

❌ Type Plante

✔ Forêt sacrée

---

Cette approche crée une identité plus forte et plus intemporelle.

---

## L'univers reste crédible

Les Hero Worlds doivent évoquer un lieu réel.

Ils ne doivent jamais ressembler à :

- un fond abstrait
- un wallpaper gaming
- une illustration de carte

Chaque univers pourrait exister indépendamment de Pokémon.

---

# 3. Architecture

```
Card

↓

Card Type

↓

Theme Engine

↓

Hero World

↓

Background

↓

Overlay

↓

Glass Panel

↓

Content
```

Chaque couche possède un rôle précis.

---

## Background

Crée l'ambiance.

Ne contient jamais :

- Pokémon
- carte
- texte
- interface

---

## Overlay

Garantit la lisibilité.

Il ne sert jamais à embellir.

---

## Glass Panel

Protège uniquement les informations.

Il ne doit jamais couvrir toute la bannière.

---

## Card

Élément principal.

Toujours.

---

# 4. Theme Engine

Le Theme Engine associe un type Pokémon à un Hero World.

Il ne choisit pas une couleur.

Il choisit un univers.

Exemple :

```ts
Electric

↓

Celestial Storm
```

Le moteur doit rester simple.

Une seule responsabilité :

Associer un type à une ambiance.

---

# 5. Hero Worlds

Chaque univers possède une identité propre.

---

## ⚡ Electric

Nom :

Celestial Storm

Émotions :

- énergie
- puissance
- vitesse

Décor :

- nuages
- éclairs
- lumière dorée
- ciel dramatique

Palette :

Bleu

Or

Noir

---

## 🔥 Fire

Nom :

Volcanic Forge

Émotions :

- chaleur
- force
- intensité

Décor :

- fumée
- roche
- braises
- lave

Palette :

Orange

Rouge

Noir

---

## 🌊 Water

Nom :

The Maelstrom

Émotions :

- profondeur
- mouvement
- fluidité

Décor :

- vagues
- écume
- vortex
- océan

Palette :

Bleu

Turquoise

Blanc

---

## 🌿 Grass

Nom :

Sacred Forest

Émotions :

- calme
- nature
- sérénité

Décor :

- arbres
- mousse
- rayons lumineux
- végétation

Palette :

Vert

Émeraude

Or

---

## 🧠 Psychic

Nom :

Astral Realm

Émotions :

- mystère
- sagesse
- cosmos

Décor :

- nébuleuses
- galaxies
- lumière violette

Palette :

Violet

Bleu

Rose

---

## 🌑 Dark

Nom :

Forgotten Kingdom

Émotions :

- solitude
- puissance
- mystère

Décor :

- falaises
- brume
- ruines
- lune

Palette :

Noir

Gris

Violet

---

## 🐉 Dragon

Nom :

Celestial Kingdom

Émotions :

- majesté
- puissance
- légende

Décor :

- montagnes flottantes
- ciel
- temples
- lumière divine

Palette :

Bleu

Blanc

Or

---

## ⭐ Neutral

Nom :

Hall of Legends

Émotions :

- prestige
- héritage
- collection

Décor :

- marbre
- colonnes
- architecture
- lumière dorée

Palette :

Blanc

Or

Pierre

---

# 6. Composition

Tous les Hero Worlds suivent exactement la même composition.

```
┌──────────────────────────────────────────┐

Texte

██████████

██████████


              Carte Pokémon


          Point focal lumineux


        Hero World

└──────────────────────────────────────────┘
```

---

## Zone gauche

Toujours plus sombre.

Elle protège le texte.

---

## Zone centrale

Transition.

---

## Zone droite

Point focal.

Toujours situé derrière la carte.

---

# 7. Lisibilité

Le Hero doit rester parfaitement lisible.

Même sur :

- Fire
- Electric
- Dragon

Le texte ne dépend jamais du background.

Il dépend de l'overlay.

---

## Glass Panel

Le panneau ne sert pas à faire joli.

Il sert à protéger :

- le nom
- le set
- les statistiques
- le prix

---

# 8. Animations

Le Hero flotte lentement.

Pourquoi ?

Parce qu'un mouvement lent inspire davantage la qualité.

Une animation rapide rappelle davantage un jeu vidéo.

PokéTracker n'est pas un jeu.

---

## Hover

Les interactions doivent rester discrètes.

Le Hero ne saute jamais.

Le Hero ne rebondit jamais.

---

# 9. Responsive

Le Hero doit fonctionner sur :

Desktop

Tablet

Mobile

La carte reste toujours dominante.

Même lorsque le Hero est réduit.

---

# 10. Faire évoluer le Hero

Avant toute modification :

Se poser ces questions.

La carte reste-t-elle dominante ?

Le texte reste-t-il lisible ?

Le Hero est-il plus simple ?

Le Hero paraît-il plus premium ?

Si une réponse est NON :

Ne pas implémenter.

---

# 11. Anti-patterns

Ne jamais :

❌ ajouter un Pokémon dans le background

❌ ajouter une carte supplémentaire

❌ ajouter du texte

❌ utiliser plusieurs points focaux

❌ utiliser des effets de particules

❌ ajouter des SVG décoratifs

❌ créer un Hero différent pour chaque page

❌ utiliser un Hero World abstrait

❌ ajouter des effets de glow excessifs

❌ ajouter des animations rapides

Le Hero est volontairement sobre.

Sa force vient de son équilibre.

---

# 12. L'histoire du Hero

Le Hero actuel est le résultat de plusieurs itérations.

Au cours du projet, plusieurs approches ont été testées puis abandonnées :

- effets CSS par type (éclairs, flammes, etc.) ;
- halos lumineux très prononcés ;
- fonds abstraits ;
- vortex trop présents ;
- animations de hover trop marquées.

Ces expérimentations ont permis d'identifier un principe fondamental :

> **Le Hero est meilleur lorsqu'il s'efface derrière la carte.**

Cette idée guide désormais toutes les évolutions.

---

# Checklist

Avant toute modification du Hero :

## Architecture

- [ ] Le Theme Engine reste simple.
- [ ] Aucun nouveau niveau de complexité n'est introduit.
- [ ] Les Hero Worlds restent cohérents.

---

## Design

- [ ] La carte reste l'élément principal.
- [ ] Le fond raconte un univers.
- [ ] Le texte est parfaitement lisible.
- [ ] Le point focal est correctement placé.

---

## Technique

- [ ] Les performances restent excellentes.
- [ ] Les animations utilisent `transform`.
- [ ] Aucun effet coûteux n'est ajouté.

---

# Règle d'or

> **Le Hero n'est pas conçu pour attirer le regard. Il est conçu pour donner envie de regarder la carte.**

Si un utilisateur admire davantage le fond que la carte, alors le Hero a échoué.