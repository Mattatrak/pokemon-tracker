-- Suite du renommage des identifiants TCGdex des 4 sets "Galerie de Dresseurs" (swsh9.5tg,
-- swsh10.5tg, swsh11.5tg, swsh12.5tg -> swsh9tg, swsh10tg, swsh11tg, swsh12tg côté TCGdex).
-- Les 38 fichiers du bucket Storage (card-images/tcgdex/) ont déjà été copiés vers leur nouveau nom
-- (fait en session, hors migration SQL - copie de fichiers, pas une opération DB). Cette migration
-- fait pointer les lignes cards/wishlist dont le tcgdex_id est DÉJÀ au nouveau format vers l'URL du
-- fichier renommé, au lieu de l'ancien chemin (ou d'un lien TCGdex brut désormais mort, puisque
-- TCGdex ne reconnaît plus l'ancien id).
--
-- Portée volontairement étroite : ne touche QUE les lignes dont tcgdex_id est déjà au nouveau format
-- (swsh9tg-/swsh10tg-/swsh11tg-/swsh12tg-, jamais ".5tg"). Les cartes dont le tcgdex_id est encore
-- à l'ANCIEN format ne sont pas concernées ici - leur image continue de résoudre correctement vers
-- l'ancien fichier (conservé, pas supprimé) tant que leur tcgdex_id n'a pas été corrigé à son tour.
--
-- Concaténation directe du chemin (pas de fonction de sanitisation SQL) : ces identifiants
-- n'utilisent que lettres/chiffres/tiret, donc identiques une fois passés par sanitizeForPath()
-- côté JS (modules/utils.js) - vérifié sur les noms de fichiers réels du bucket.

begin;

update public.cards
set image = 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/tcgdex/' || tcgdex_id || '.jpg'
where tcgdex_id ~ '^swsh(9|10|11|12)tg-';

update public.wishlist
set image = 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/card-images/tcgdex/' || tcgdex_id || '.jpg'
where tcgdex_id ~ '^swsh(9|10|11|12)tg-';

commit;

-- Rollback : pas de valeur "avant" à restaurer de façon fiable (variait par ligne : ancien chemin
-- storage, lien TCGdex brut, ou déjà correct) - repasser par la fiche carte au cas par cas si besoin.
