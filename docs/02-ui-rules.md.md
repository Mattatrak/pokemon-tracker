# 📐 UI Rules

> Version : 1.0
>
> Ce document définit les règles de développement de toutes les interfaces de PokéTracker.
>
> Son objectif est d'assurer une expérience cohérente, lisible et maintenable.
>
> Avant de développer une nouvelle interface, lire ce document en entier.

---

# Sommaire

1. Philosophie UI
2. Structure d'une page
3. Hiérarchie de l'information
4. Composants
5. États d'interface
6. Layout
7. Espacements
8. Responsive
9. Animations
10. Accessibilité
11. Performance
12. Règles CSS
13. Règles de composants
14. Anti-patterns
15. Checklist avant Pull Request

---

# 1. Philosophie UI

Une interface PokéTracker doit toujours répondre à trois objectifs :

- Être comprise immédiatement.
- Mettre les cartes Pokémon en valeur.
- Rester élégante.

Une interface ne cherche jamais à impressionner.

Elle cherche à disparaître derrière son contenu.

---

# 2. Structure d'une page

Toutes les pages suivent la même architecture.

```

Header

↓

Hero (optionnel)

↓

Toolbar / Actions

↓

Content

↓

Sidebar (optionnelle)

↓

Footer

```

L'utilisateur doit toujours retrouver ses repères.

Ne jamais modifier cet ordre sans raison majeure.

---

# 3. Hiérarchie de l'information

Toujours afficher les informations dans cet ordre :

1. Titre
2. Action principale
3. Informations importantes
4. Informations secondaires
5. Métadonnées

Les éléments les plus importants doivent être visibles sans effort.

---

# 4. Composants

Tous les composants doivent être réutilisables.

Créer un nouveau composant uniquement si :

- il sera utilisé plusieurs fois ;
- il possède un comportement spécifique.

Sinon :

réutiliser un composant existant.

---

## Familles de composants

```

Button

Card

Panel

Badge

Input

Select

Modal

Drawer

Tooltip

Toast

Skeleton

```

Ne jamais créer une nouvelle famille.

---

# 5. États d'interface

Chaque écran doit gérer les états suivants.

## Loading

Toujours utiliser un Skeleton.

Éviter les spinners lorsque des données sont attendues.

---

## Empty

Toujours expliquer pourquoi.

Toujours proposer une action.

Exemple :

"Aucune carte trouvée"

→ Bouton Ajouter une carte

---

## Error

Toujours :

- expliquer le problème ;
- proposer une solution.

Jamais :

"Unknown error"

---

## Success

Le succès doit être visible mais discret.

Utiliser :

- badge
- toast
- animation légère

Jamais une popup.

---

# 6. Layout

Les layouts utilisent une grille.

Toujours aligner les éléments.

Les colonnes doivent partager les mêmes marges.

Ne jamais centrer du contenu uniquement "parce que c'est joli".

Le placement doit toujours avoir une logique.

---

# 7. Espacements

Toujours utiliser la grille officielle.

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

Éviter les marges différentes entre composants similaires.

L'utilisateur doit inconsciemment reconnaître les rythmes visuels.

---

# 8. Responsive

Le responsive n'est pas un redimensionnement.

C'est une réorganisation.

Ordre de priorité :

Desktop

↓

Tablet

↓

Mobile

Toujours vérifier :

- largeur
- hauteur
- scroll
- lisibilité
- interactions tactiles

---

## Mobile

Éviter :

- plusieurs colonnes
- textes trop longs
- hover uniquement

Toujours privilégier :

- cartes verticales
- boutons larges
- gestes simples

---

# 9. Animations

Les animations doivent :

- guider
- informer
- fluidifier

Jamais distraire.

Durées officielles :

```

150 ms

250 ms

400 ms

600 ms

```

Hover :

150 ms

Transitions :

250 ms

Entrées :

400 ms

---

Toujours utiliser :

```

ease-out

ease-in-out

```

---

Jamais :

```

bounce

spring

elastic

```

---

# 10. Accessibilité

Chaque nouvelle interface doit vérifier :

✔ contraste

✔ navigation clavier

✔ focus visible

✔ aria-label si nécessaire

✔ zones tactiles suffisantes

Les animations doivent respecter :

prefers-reduced-motion

---

# 11. Performance

Éviter :

- plusieurs blur importants
- grosses ombres empilées
- animations permanentes
- reflow inutiles

Préférer :

opacity

transform

Jamais :

top

left

width

height

pour les animations.

---

# 12. Règles CSS

Toujours utiliser :

Variables CSS

Jamais :

```

color:#xxxxxx

padding:19px

margin:27px

```

Les valeurs doivent provenir :

- du Design System
- des variables globales

---

## Z-index

Utiliser une hiérarchie.

Exemple :

```

Dropdown

↓

Modal

↓

Toast

↓

Tooltip

```

Ne jamais utiliser :

```

z-index:999999

```

---

# 13. Règles de composants

Avant de créer un composant :

Se demander :

Existe-t-il déjà ?

Puis-je l'étendre ?

Puis-je le rendre configurable ?

La duplication est interdite.

---

## Props

Toujours préférer :

```

variant

size

disabled

loading

```

Plutôt que :

```

greenButton

largeCard

smallPanel

```

---

# 14. Anti-patterns

Ne jamais :

❌ créer un composant presque identique

❌ copier du CSS

❌ ajouter un nouveau gradient

❌ ajouter une nouvelle ombre

❌ créer une nouvelle animation

❌ casser la grille

❌ changer la palette

❌ ajouter un nouvel effet de hover

❌ utiliser plusieurs styles de boutons

❌ utiliser plusieurs familles d'icônes

---

# 15. Workflow recommandé

Avant toute nouvelle page :

## Étape 1

Identifier les composants existants.

---

## Étape 2

Assembler l'écran.

---

## Étape 3

Créer uniquement les composants réellement nouveaux.

---

## Étape 4

Vérifier le responsive.

---

## Étape 5

Ajouter les animations.

Toujours en dernier.

---

# Checklist avant Pull Request

## UI

- [ ] Respect du Design System
- [ ] Respect de la grille
- [ ] Espacements cohérents
- [ ] Hiérarchie lisible

---

## Responsive

- [ ] Desktop
- [ ] Tablet
- [ ] Mobile

---

## Accessibilité

- [ ] Contraste
- [ ] Focus
- [ ] Navigation clavier

---

## Performance

- [ ] Animations optimisées
- [ ] Pas de reflow inutile
- [ ] Variables CSS utilisées

---

## Composants

- [ ] Aucun doublon créé
- [ ] Props cohérentes
- [ ] CSS mutualisé

---

# Règle d'or

> Si un utilisateur remarque l'interface avant de remarquer les cartes Pokémon, alors l'interface est trop présente.

L'UI existe pour servir la collection.

Jamais l'inverse.