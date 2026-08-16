// Suivi d'erreurs minimal (Sentry) — erreurs JS et rejets de promesse non gérés uniquement.
// Volontairement désactivé tant que SENTRY_DSN est vide : créer un compte gratuit sur sentry.io,
// récupérer le DSN du projet (Settings > Client Keys (DSN)) et le coller ci-dessous pour l'activer.
// Aucun tracking comportemental, aucun session replay, aucune donnée personnelle envoyée par défaut.
const SENTRY_DSN = 'https://0815061b52f6e52e1f931d0f84066725@o4511905699004416.ingest.de.sentry.io/4511905730658385';

if (SENTRY_DSN && typeof Sentry !== 'undefined') {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'development' : 'production',
        release: (typeof APP_VERSION !== 'undefined') ? `poketracker@${APP_VERSION}` : undefined,

        // Erreurs uniquement : pas de tracing de performance, pas de session replay.
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,

        // Pas de collecte automatique de PII (IP, cookies, etc.).
        sendDefaultPii: false,

        // Filet de sécurité supplémentaire : si un contexte custom finit par inclure un email/pseudo,
        // on le retire avant l'envoi plutôt que de compter uniquement sur la configuration ci-dessus.
        beforeSend(event) {
            if (event.user) {
                delete event.user.email;
                delete event.user.username;
            }
            return event;
        }
    });
}

// ===== Exports window (ticket V2 Vite, type="module") =====
// Les déclarations top-level d'un module ES ne s'attachent plus automatiquement à window
// (contrairement à un <script> classique) : réexport explicite pour que les autres scripts
// (chargés en modules indépendants, sans import/export entre eux, scope global inchangé)
// puissent continuer à référencer ces noms tels quels — y compris depuis des onclick="..."
// inline dans du HTML généré. Liste exhaustive des déclarations top-level de ce fichier
// (hors variables déjà passées en window.x = ... directement à leur déclaration, cf audit
// du 2026-08-14 sur l'état mutable partagé entre fichiers).
window.SENTRY_DSN = SENTRY_DSN;
