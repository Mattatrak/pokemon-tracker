# 🎨 PokéTracker Design System

> Version : 1.0
>
> Ce document définit les principes de conception de PokéTracker.
>
> Il constitue la référence graphique du projet.
>
> Toute nouvelle interface, composant ou animation doit respecter les règles décrites ici.

---

# Sommaire

1. Vision
2. Les valeurs du projet
3. Les principes de conception
4. L'identité visuelle
5. Palette de couleurs
6. Typographie
7. Espacements
8. Border Radius
9. Ombres
10. Composants
11. Animations
12. Hero Worlds
13. Responsive
14. Accessibilité
15. Les interdits
16. Checklist de validation

---

# 1. Vision

PokéTracker est une application destinée aux collectionneurs de cartes Pokémon.

L'objectif n'est pas simplement d'afficher des données.

L'objectif est de créer une expérience où chaque carte semble importante.

Une carte Pokémon n'est pas un objet quelconque.

C'est une pièce de collection.

Toute l'interface existe pour mettre cette carte en valeur.

Le design doit transmettre :

- la qualité
- la rareté
- le plaisir de collectionner
- la simplicité
- la confiance

---

# 2. Les valeurs du projet

## Premium

PokéTracker doit ressembler à un produit terminé.

Chaque détail compte.

Un bon espacement vaut mieux qu'une animation.

Une bonne hiérarchie vaut mieux qu'une couleur supplémentaire.

Une belle ombre vaut mieux que trois effets spéciaux.

---

## Sobriété

Le design doit respirer.

L'espace vide fait partie du design.

Tous les éléments doivent avoir une raison d'être.

Lorsque deux solutions sont possibles, choisir la plus simple.

---

## Pokémon

PokéTracker est inspiré de Pokémon.

Pas de l'univers fan-made.

Nous évitons :

- les interfaces surchargées
- les dizaines de Pokéballs
- les icônes Pokémon partout
- les effets cartoon

L'identité Pokémon passe principalement par :

- les cartes
- les Hero Worlds
- les couleurs
- quelques références discrètes

---

## Collection

Une collection mérite d'être contemplée.

Une carte ne doit jamais sembler perdue dans l'interface.

Le regard doit naturellement être attiré vers elle.

---

## Cohérence

Tous les écrans doivent sembler appartenir au même produit.

Une nouvelle page ne doit jamais introduire un nouveau langage graphique.

---

# 3. Les principes de conception

## La carte est toujours la priorité.

L'interface ne doit jamais voler l'attention.

Elle accompagne.

Elle met en scène.

Elle ne concurrence pas.

---

## Le contenu avant la décoration.

Avant d'ajouter un effet visuel, toujours se demander :

"Est-ce que cela améliore la compréhension ?"

Si la réponse est non, ne pas l'ajouter.

---

## Une seule façon de faire.

Lorsqu'un composant existe déjà :

on le réutilise.

On ne crée jamais une nouvelle variante sans raison.

---

## Le mouvement doit être discret.

Les animations doivent être ressenties.

Jamais remarquées.

---

# 4. L'identité visuelle

Le design repose sur quatre idées.

## Obscur

Les fonds sont principalement sombres.

Ils mettent naturellement les cartes en valeur.

---

## Élégant

Les dégradés sont subtils.

Les ombres sont douces.

Les bordures sont discrètes.

---

## Moderne

Glassmorphism léger.

Coins arrondis.

Transitions fluides.

Espaces généreux.

---

## Vivant

Le Hero change selon le type de la carte.

L'application semble vivante sans devenir distrayante.

---

# 5. Palette de couleurs

## Fonds

```
--bg-primary
--bg-secondary
--bg-surface
```

Les fonds sont volontairement neutres.

Les Hero Worlds apportent la couleur.

---

## Texte

```
--text-primary
--text-secondary
--text-muted
```

Le contraste doit toujours respecter l'accessibilité.

---

## Couleurs d'accent

```
--gold
--green
--danger
```

Le doré est réservé :

- aux valeurs importantes
- aux éléments premium
- aux statistiques remarquables

Le vert est réservé :

- aux évolutions positives
- aux confirmations

Le rouge :

- uniquement pour les erreurs.

---

# 6. Typographie

Une seule hiérarchie est autorisée.

```
Hero Title

Section Title

Card Title

Heading

Body

Label

Caption
```

Les labels ne doivent jamais attirer davantage l'œil que les données.

---

# 7. Espacements

PokéTracker utilise une grille de 4 px.

Valeurs autorisées :

```
4

8

12

16

20

24

32

40

48

64
```

Ne jamais utiliser :

```
17

23

29

37
```

Si une valeur semble manquer, choisir la plus proche.

La cohérence est plus importante que la précision.

---

# 8. Border Radius

Valeurs autorisées :

```
8

12

16

20

999
```

Utilisation recommandée :

| Élément | Radius |
|---------|--------|
| Hero | 20 |
| Cards | 16 |
| Inputs | 12 |
| Boutons | 12 |
| Badges | 999 |

---

# 9. Ombres

Trois niveaux seulement.

## Small

Utilisée sur :

- boutons
- inputs

---

## Medium

Utilisée sur :

- panneaux
- cartes
- menus

---

## Hero

Réservée :

- Hero
- cartes mises en avant

Aucune autre ombre n'est autorisée.

---

# 10. Composants

Chaque composant doit appartenir à une famille.

Par exemple :

```
Panel

↓

Card

↓

Button

↓

Badge

↓

Input

↓

Modal
```

Chaque famille possède :

- une seule apparence
- une seule logique
- une seule animation

---

# 11. Animations

Les animations servent uniquement à améliorer la perception.

Jamais à impressionner.

Durées autorisées :

```
150 ms

250 ms

400 ms

600 ms
```

Hover :

150 à 200 ms.

Transitions :

250 ms.

Apparitions :

400 ms.

Hero Float :

6 à 8 secondes.

Toujours utiliser :

```
ease-out

ou

ease-in-out
```

Jamais :

```
bounce

elastic

spring
```

---

# 12. Hero Worlds

Le Hero est la signature visuelle de PokéTracker.

Chaque type possède un univers.

| Type | Univers |
|------|----------|
| ⚡ Electric | Tempête céleste |
| 🔥 Fire | Fournaise volcanique |
| 🌊 Water | Maelström |
| 🌿 Grass | Forêt sacrée |
| 🧠 Psychic | Royaume psychique |
| 🌑 Dark | Royaume oublié |
| 🐉 Dragon | Royaume céleste |
| ⭐ Neutral | Hall des légendes |

Le Hero n'est pas décoratif.

Il raconte une ambiance.

---

# 13. Responsive

Le responsive ne consiste pas à réduire des éléments.

Il consiste à réorganiser l'information.

Les priorités doivent rester identiques.

Desktop :

La carte domine.

Mobile :

La carte reste dominante.

Jamais l'inverse.

---

# 14. Accessibilité

Toujours vérifier :

✔ Contraste

✔ Focus visible

✔ Taille des textes

✔ Taille des zones cliquables

✔ Navigation clavier

Une interface premium est aussi une interface accessible.

---

# 15. Les interdits

Ne jamais :

❌ créer un nouveau rayon

❌ créer une nouvelle ombre

❌ créer un nouveau bouton

❌ multiplier les couleurs

❌ ajouter des SVG décoratifs

❌ utiliser plusieurs halos lumineux

❌ utiliser des particules permanentes

❌ faire rebondir les cartes

❌ ajouter des animations sans utilité

❌ surcharger une interface

Lorsque quelque chose semble manquer...

Ajouter de l'espace avant d'ajouter un nouvel effet.

---

# 16. Checklist de validation

Avant toute Pull Request contenant des modifications UI :

## Cohérence

- [ ] Le composant respecte le Design System.
- [ ] Aucun nouveau style n'a été créé inutilement.
- [ ] Les espacements utilisent la grille officielle.

---

## Lisibilité

- [ ] Les textes restent lisibles.
- [ ] Le contraste est suffisant.
- [ ] Les informations importantes ressortent immédiatement.

---

## Animations

- [ ] Les animations sont discrètes.
- [ ] Elles utilisent les durées officielles.
- [ ] Elles améliorent réellement l'expérience.

---

## Collection

- [ ] La carte reste l'élément principal.
- [ ] L'interface accompagne la collection.
- [ ] Aucun élément graphique ne concurrence les cartes.

---

# Règle d'or

> **Toute nouvelle interface doit donner l'impression d'avoir été conçue le même jour que le Hero.**

Si cette règle n'est pas respectée, le design doit être revu avant d'être développé.