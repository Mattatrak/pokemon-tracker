-- Audit webdesign 2026-09-04, quick win "Désaturation légère des 8 couleurs de liste Wishlist" :
-- la palette WISHLIST_COLOR_PRESET (modules/wishlist.js) a été désaturée ~20-35% (même teinte/
-- luminosité, juste ramenée dans le registre de saturation du reste de l'app, s=79-100% -> s=57-80%).
-- Ce changement côté JS ne concerne que le sélecteur de couleur affiché à la création/l'édition d'une
-- liste - les listes déjà créées gardent la valeur hex enregistrée telle quelle en base tant qu'elle
-- n'est pas réécrite ici. Mapping 1:1 ancien hex -> nouveau hex, uniquement sur les 8 valeurs exactes
-- du preset (une couleur personnalisée hors preset, si jamais une existait, n'est jamais touchée par
-- construction du WHERE ci-dessous).

update public.wishlists set color = '#D2A351' where color = '#E8A93B'; -- gold
update public.wishlists set color = '#519591' where color = '#3FA7A1'; -- teal
update public.wishlists set color = '#C58AF2' where color = '#C77DFF'; -- purple
update public.wishlists set color = '#D26751' where color = '#E8593B'; -- red
update public.wishlists set color = '#5F91E3' where color = '#4C8DF6'; -- blue
update public.wishlists set color = '#E07BA9' where color = '#F06BA8'; -- pink
update public.wishlists set color = '#70AE78' where color = '#5FBF6B'; -- green
-- slate (#8A93A6) inchangée : déjà dans le registre de saturation cible, aucune mise à jour nécessaire.

-- Rollback manuel si besoin (mapping inverse) :
-- update public.wishlists set color = '#E8A93B' where color = '#D2A351';
-- update public.wishlists set color = '#3FA7A1' where color = '#519591';
-- update public.wishlists set color = '#C77DFF' where color = '#C58AF2';
-- update public.wishlists set color = '#E8593B' where color = '#D26751';
-- update public.wishlists set color = '#4C8DF6' where color = '#5F91E3';
-- update public.wishlists set color = '#F06BA8' where color = '#E07BA9';
-- update public.wishlists set color = '#5FBF6B' where color = '#70AE78';
