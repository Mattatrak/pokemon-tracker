-- Audit sécurité 2026-09-04 (finding "Élevée") : cards.image et wishlist.image n'avaient aucune
-- contrainte de format en base, contrairement à profiles.avatar_url (cf.
-- 2026-08-09_profiles_avatar_url_format.sql, même raisonnement). Un utilisateur authentifié peut
-- contourner l'UI (appel direct à l'API Supabase avec la clé anon, déjà exposée côté client) et
-- écrire une valeur arbitraire dans ces champs. Cette valeur est réinjectée dans plusieurs
-- src="..." (public-profile.js, dashboard.js, collection-recap.js) -> XSS stocké visible par
-- d'autres utilisateurs (profil public : wishlist, opportunités d'échange). Le correctif principal
-- est l'échappement côté rendu (escapeHtml, appliqué le même jour dans le code applicatif sur les
-- 5 endroits qui en manquaient). Cette contrainte SQL est un filet de sécurité supplémentaire.
--
-- Formes exactes produites par les chemins d'écriture légitimes de ces deux colonnes
-- (modules/cards.js: recherche TCGdex -> card.image = résultat brut de l'API TCGdex, cf.
-- API_BASE = 'https://api.tcgdex.net/v2/fr' dans tracker.js, format vérifié en direct :
-- "https://assets.tcgdex.net/<lang>/<serie>/<set>/<numero>" ; modules/storage.js: upload
-- personnel d'une photo de carte -> URL du bucket Storage "card-images", même bucket que les
-- logos/icônes déjà en place, cf. TYPE_ICON_BASE_URL dans utils.js) :
--   https://assets.tcgdex.net/...
--   https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/...
-- Ce sont les deux seuls chemins d'écriture légitimes de ces champs dans tout le code applicatif.

-- Toute valeur existante qui ne correspond à aucun des deux préfixes est remise à NULL avant
-- l'ajout de la contrainte, plutôt que de faire échouer la migration (même logique que pour
-- avatar_url : un contournement de l'UI ne peut avoir produit qu'une valeur non conforme, jamais
-- un enregistrement légitime).
update public.cards
set image = null
where image is not null
  and image not like 'https://assets.tcgdex.net/%'
  and image not like 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/%';

update public.wishlist
set image = null
where image is not null
  and image not like 'https://assets.tcgdex.net/%'
  and image not like 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/%';

alter table public.cards
  add constraint cards_image_format
  check (
    image is null
    or image like 'https://assets.tcgdex.net/%'
    or image like 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/%'
  );

alter table public.wishlist
  add constraint wishlist_image_format
  check (
    image is null
    or image like 'https://assets.tcgdex.net/%'
    or image like 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/%'
  );

-- Rollback manuel si besoin :
-- alter table public.wishlist drop constraint if exists wishlist_image_format;
-- alter table public.cards drop constraint if exists cards_image_format;
