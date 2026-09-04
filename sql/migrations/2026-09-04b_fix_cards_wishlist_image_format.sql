-- Correctif urgent de 2026-09-04_cards_wishlist_image_format.sql : cette migration bloquait l'ajout
-- de toute carte SANS image TCGdex (constaté en direct : "new row for relation cards violates check
-- constraint cards_image_format" à l'ajout).
--
-- Cause : performCardAdd() (tracker.js:336) et l'ajout wishlist (modules/wishlist.js:808) insèrent
-- une chaîne VIDE ('') dans image quand card.image est vide côté TCGdex (aucun fallback disponible),
-- jamais NULL. La contrainte d'origine n'autorisait que "image is null" ou un des deux préfixes -
-- une chaîne vide n'est ni l'un ni l'autre en SQL, donc rejetée. Pas un cas rare : c'est précisément
-- le cas des cartes que TCGdex n'a pas en photo (objets/énergies communes, etc. - cf audit webdesign
-- 2026-09 sur les images manquantes en grille Progression).

alter table public.cards drop constraint if exists cards_image_format;
alter table public.wishlist drop constraint if exists wishlist_image_format;

alter table public.cards
  add constraint cards_image_format
  check (
    image is null
    or image = ''
    or image like 'https://assets.tcgdex.net/%'
    or image like 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/%'
  );

alter table public.wishlist
  add constraint wishlist_image_format
  check (
    image is null
    or image = ''
    or image like 'https://assets.tcgdex.net/%'
    or image like 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/%'
  );

-- Rollback manuel si besoin :
-- alter table public.wishlist drop constraint if exists wishlist_image_format;
-- alter table public.cards drop constraint if exists cards_image_format;
-- (puis réappliquer 2026-09-04_cards_wishlist_image_format.sql si besoin de revenir à la version stricte)
