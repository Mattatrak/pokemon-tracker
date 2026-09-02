const { defineConfig } = require('vitest/config');

// Infra de tests (2026-09-02) : les modules (modules/*.js) sont des scripts <script type="module">
// chargés directement par index.html/login.html, pas assemblés via des imports JS entre eux (état
// partagé via window.X, cf commentaires "ticket V2 Vite" dans chaque fichier) - ce n'est PAS un projet
// avec un point d'entrée unique que Vitest pourrait suivre tout seul. Chaque fichier testé exporte en
// plus (export { ... } en fin de fichier, à côté de window.X = X existant) les fonctions pures qu'on
// veut tester ici, sans rien changer au comportement navigateur (une instruction export supplémentaire
// dans un module déjà chargé en type="module" n'a aucun effet sur ce qui s'exécute).
//
// environment: 'jsdom' plutôt que le défaut 'node' : plusieurs fichiers posent des window.X = X en bas
// de fichier (effet de bord au chargement du module, pas seulement à l'appel d'une fonction) - jsdom
// fournit un window minimal pour que l'import ne plante pas, même si les tests eux-mêmes ne touchent
// jamais au DOM.
module.exports = defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.js']
    }
});
