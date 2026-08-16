# Idées d'amélioration — inspirées de duffus.fr

> Notes issues d'une analyse technique de duffus.fr (2026-08-16). Pas des specs, juste des pistes à
> creuser plus tard. Aucune n'est urgente ni validée pour implémentation.

---

## 1. [FAIT] Micro-interaction au survol de la navbar

Duffus combine `color` + `background` + `transform` ensemble (`.nv__link`, ~180ms), ce qui donne
un effet plus tactile qu'un simple changement de couleur.

**Fait le 2026-08-16** ([navigation.css](../components/navigation/navigation.css:84)) :
`.dashboard-integrated-nav-link` et `.dashboard-integrated-nav-action` transitionnent désormais
`transform` (`translateY(-1px)`) en plus de la couleur/du fond déjà en place.

---

## 2. [FAIT] Hover à 3 signaux synchronisés sur les cartes

Règle CSS relevée sur les cartes de duffus (`.dj-card`, grille "Encyclopédie des Monstres") :

```css
.dj-card:hover { background: rgba(71, 85, 44, 0.14); border-color: rgba(183, 220, 105, 0.28); }
.dj-card:hover .dj-name { color: rgb(183, 220, 105); }
.dj-card:hover .dj-thumb img { transform: scale(1.08); }
```

Trois choses bougent en même temps : fond + bordure teintés couleur accent, texte recoloré, et
l'image/icône qui zoome légèrement. Même recette réutilisée sur toutes leurs cartes du site
(`nv__stuff-card`, `nv__skin-card`, `nv__hub-tuto-card`) — un système cohérent, pas un effet isolé.

**Fait le 2026-08-16** ([styles.css:2519](../styles.css:2519), `.collection-card`) : bordure teintée
or + image qui zoome (1.05×) + nom recoloré, en plus du lift/ombre déjà en place. `.collection-card`
étant partagée (Collection/Wishlist/Classeur/profil public), appliqué partout d'un coup.

---

## 3. [FAIT — approximation, pas un vrai crossfade] Fondu d'entrée à chaque changement de page

Chez duffus, le conteneur racine de chaque route démarre à `opacity: 0` et s'anime vers `1` au
montage. Résultat : le contenu de la nouvelle page ne s'affiche jamais brutalement, il apparaît en
fondu.

**Fait le 2026-08-16** ([styles.css:165](../styles.css:165), `.tab-content.active`) — avec une
contrainte non présente chez duffus, propre à notre architecture : un `@keyframes motion-enter`
(fondu + `transform`) existait déjà mais avait été explicitement écarté ici, car un `transform`
animé (même figé à `translateY(0)` une fois fini, en `fill-mode:both`) crée un containing block
pour tout descendant en `position:sticky` et le casse (`.catalogue-sheet-sticky` dans `#tab-add`).
Résolu avec un nouveau keyframe **opacity seule** (`tab-content-fade-in`), 300ms `ease-in-out`
(valeurs interceptées directement via `Element.prototype.animate()` sur duffus.fr). Les 4 heroes
hors `.tab-content` (Progression/Collection/Stats/Wishlist, chacun un `body.page-X .X-hero` séparé
dans le DOM) reçoivent la même animation synchronisée.

**Limite connue, gardée en tête pour plus tard (2026-08-16)** : chez duffus, ce n'est pas un simple
fondu d'entrée — c'est un **vrai crossfade** : ancienne et nouvelle page superposées, fondues
simultanément (`opacity [1,0]` et `[0,1]`, 300ms chacune, capturées en même temps). Chez nous,
l'ancien onglet disparaît instantanément (`display:none`) avant que le nouveau ne fonde — d'où un
léger "pop" que le fondu seul ne corrige pas, quel que soit le réglage. Reproduire le vrai crossfade
demanderait de superposer temporairement les deux onglets (position absolute) ET de rendre
asynchrone la mise à jour DOM à l'intérieur de la View Transition du morph d'indicateur de nav déjà
en place (VT2, `runNavIndicatorTransition`, tracker.js) — risque réel de régression sur cette
fonctionnalité existante, à tester soigneusement si on décide d'aller jusque-là.

---

## 4. [VALIDÉ] Page Progression en grille de cartes (inspiré de /guides)

Sur `/guides`, duffus groupe ses guides sous un libellé "eyebrow" (nom en petites capitales +
trait horizontal), avec en dessous une grille de cartes carrées (icône ronde, badge % en coin,
nom, sous-titre). Mapping direct avec Progression :

- Libellé "DOFUS"/"DIVERS" + trait → groupe **série**
- Carte Dofus (icône + % + nom + niveau) → carte **set**

Actuellement ([progression.js:362](../modules/progression.js:362),
[styles.css:4436](../styles.css:4436)) les sets sont rendus en **liste verticale de lignes**
(`.progression-set-row`), pas en grille. Toutes les données nécessaires existent déjà (`pct`,
`owned`, `officialCount`, `logoUrl`) — c'est un changement de layout CSS, pas de données.

Maquette de comparaison (liste actuelle vs grille proposée, tokens réels du projet) :
https://claude.ai/code/artifact/cb49b2e8-5a64-4438-885f-1c7507a41f60 — **validée par l'utilisateur
le 2026-08-16**, direction confirmée pour une prochaine implémentation.

Point d'attention à vérifier avec de vrais logos avant implémentation : les logos de sets TCGdex
sont rectangulaires avec texte intégré (contrairement aux icônes rondes de Dofus) — le badge rond
doit rester un contenant neutre (`object-fit: contain`), pas un crop circulaire.

---

## 5. [FAIT] Grain + vignette (heroes) + atmosphères (fond de page global)

Chez duffus, le fond n'est pas plat : image sombre assombrie + halo de couleur doux depuis le haut
+ une couche de grain à faible opacité. On a déjà l'équivalent du halo doux
([styles.css:78](../styles.css:78), `radial-gradient(ellipse at 50% 0%, rgba(232,169,59,.1) 0%, var(--bg) 60%)`),
il ne manquait que le grain.

**Fait le 2026-08-16, en deux temps :**

1. Heroes (Progression/Collection/Stats/Wishlist/Dashboard/Ajouter) : grain via un `::before` commun
   (opacité 0.06), vignette (radial-gradient assombrissant les bords) ajoutée comme première couche
   du `background-image` existant de chaque hero. Dashboard-hero non touché sur la vignette : avait
   déjà la sienne (asymétrique, cohérente avec son layout texte-gauche/carte-droite). Maquette :
   https://claude.ai/code/artifact/f1067853-320a-49dd-ae4b-779ada3931f9
2. Fond de page global (`.container` et tout son contenu, resté plat après l'étape 1) : grain via
   `body::before` (opacité 0.035, plus discret que sur les heroes car posé derrière du texte, pas
   une photo) + 3 "atmosphères" (grands radiaux très doux et décentrés — doré haut-gauche, violet
   froid bas-droite, base assombrie) ajoutées en première couche du `background-image` de `body`,
   devant le halo doré existant. Maquette :
   https://claude.ai/code/artifact/62b96b54-8744-4ce3-a16b-6a5144450aa7
   **Piège rencontré** : `body::before` en `position:fixed; z-index:0` se retrouvait au-dessus du
   contenu normal de `.container` (non positionné, `z-index:auto`) selon l'ordre d'empilement CSS
   standard (le contenu non positionné peint *avant* les éléments positionnés à `z-index:0`) — ajouté
   `position:relative; z-index:1` sur `.container` pour garantir qu'il reste au-dessus.

Recette retenue — bruit généré en CSS pur via un filtre SVG `feTurbulence`, aucun fichier image à
charger :

```css
body::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: 0.04; /* dosage à affiner en conditions réelles, la démo utilisait 0.14 pour la visibilité */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 120px 120px;
    background-repeat: repeat;
}
body > * { position: relative; z-index: 1; } /* le contenu doit rester au-dessus */
```

**Piège rencontré pendant la maquette** : sans `width`/`height` fixes sur le `<svg>` et sans
`background-size` explicite en petite tuile répétée, le bruit s'étire sur toute la page et devient
un gros nuage flou au lieu d'un grain fin — corrigé en fixant le SVG à 120×120 et en le répétant
via `background-size: 120px 120px; background-repeat: repeat`.

Maquette avec toggle avant/après en direct :
https://claude.ai/code/artifact/cb49b2e8-5a64-4438-885f-1c7507a41f60 — **validée par l'utilisateur
le 2026-08-16**.

---

## Non retenu

- **Carrousel choré­graphié** (section "Outils" de duffus : auto-défilement, carte centrale
  agrandie, barre de progression par point) — repéré mais pas encore validé comme piste, plus lourd
  à justifier qu'un simple carrousel de cartes récentes sur le Dashboard.
- **Transition de page via bordure lumineuse / effet "bridge" sur dropdowns** — techniques vues
  mais pas applicables tant qu'on n'a pas de menu déroulant au survol dans la navbar (le
  `.profile-menu` actuel s'ouvre au clic, pas au survol — pas de "dead zone" à corriger).
