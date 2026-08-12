-- P0 fix (audit V1 readiness) : profiles.avatar_url n'avait aucune contrainte de format en base.
-- L'UI ne permet de choisir que des URLs publiques du bucket Storage "avatar" (fetchAvatarOptions +
-- saveProfile, cf. modules/profile.js), mais un utilisateur authentifié peut contourner l'UI (appel
-- direct à l'API Supabase avec la clé anon, déjà exposée côté client) et écrire une valeur arbitraire
-- dans ce champ. Cette valeur est ensuite réinjectée dans plusieurs src="..." (profile.js,
-- public-profile.js, collectors.js via profileAvatarHtml) -> XSS stocké visible par d'autres
-- utilisateurs (profil public, recherche de collectionneurs).
--
-- Le correctif principal est l'échappement côté rendu (escapeHtml, déjà appliqué dans le code
-- applicatif). Cette contrainte SQL est un filet de sécurité supplémentaire : elle ne remplace pas
-- l'échappement, elle empêche seulement d'enregistrer une valeur qui ne correspond pas au format
-- réellement produit par getPublicUrl() pour ce bucket.
--
-- Forme exacte inspectée dans le code (modules/profile.js: AVATAR_BUCKET = 'avatar',
-- tracker.js: SUPABASE_URL = 'https://mmdcpkwygqsdaqnkimwb.supabase.co') :
--   https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/avatar/<nom_de_fichier>
-- C'est l'unique chemin d'écriture légitime de ce champ dans tout le code applicatif.

-- Toute valeur existante qui ne correspond pas à ce préfixe est remise à NULL avant l'ajout de la
-- contrainte, plutôt que de faire échouer la migration. Comme le seul chemin légitime de création de
-- ce champ ne produit jamais autre chose que ce préfixe, une valeur non conforme ne peut provenir que
-- d'un contournement de l'UI (donc potentiellement déjà un payload malveillant) -- pas d'un profil
-- légitime. Aucun profil valide n'est donc affecté ; NULL reste une valeur supportée (avatar_url est
-- nullable, cf. modules/profile.js:33, fallback emoji affiché dans ce cas).
update public.profiles
set avatar_url = null
where avatar_url is not null
  and avatar_url not like 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/avatar/%';

alter table public.profiles
  add constraint profiles_avatar_url_format
  check (
    avatar_url is null
    or avatar_url like 'https://mmdcpkwygqsdaqnkimwb.supabase.co/storage/v1/object/public/avatar/%'
  );
