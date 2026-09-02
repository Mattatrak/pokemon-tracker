import { describe, it, expect } from 'vitest';
// Import de effet de bord uniquement : computeSetCompletionBudget appelle getMarketValueForFinish en
// tant que référence globale (window.X, pas un import ES - cf commentaire "ticket V2 Vite" dans
// modules/progression.js), comme elle le ferait via <script type="module"> dans le navigateur. Sans
// cet import, window.getMarketValueForFinish n'existe jamais et l'appel échoue en ReferenceError.
import '../modules/utils.js';
import { computeSetCompletionBudget } from '../modules/progression.js';

// computeSetCompletionBudget délègue la résolution de prix à getMarketValueForFinish
// (modules/utils.js) - les cartes de test ci-dessous utilisent donc le format
// card.pricing.cardmarket.avg (repli générique), pas variants_detailed (déjà couvert par
// tests/utils.test.js pour getMarketValueForFinish elle-même).
function cardWithPrice(name, avg) {
    return { name, pricing: { cardmarket: { avg } } };
}

describe('computeSetCompletionBudget', () => {
    it('retourne un budget vide pour un set sans carte manquante', () => {
        const result = computeSetCompletionBudget([], 'normal');
        expect(result).toEqual({ totalKnown: 0, countKnown: 0, countUnknown: 0, mostExpensive: null });
    });

    it('additionne les prix connus et identifie la carte manquante la plus chère', () => {
        const missing = [
            cardWithPrice('Carapuce', 2),
            cardWithPrice('Tortank-ex', 180),
            cardWithPrice('Alakazam-ex', 150)
        ];
        const result = computeSetCompletionBudget(missing, 'normal');

        expect(result.totalKnown).toBe(332);
        expect(result.countKnown).toBe(3);
        expect(result.countUnknown).toBe(0);
        expect(result.mostExpensive.card.name).toBe('Tortank-ex');
        expect(result.mostExpensive.price).toBe(180);
    });

    // "Un prix de 0 est traité comme inconnu, jamais sommé comme gratuit" (commentaire du code,
    // cf audit) - le cas limite documenté qui justifie le plus ce test : une régression ici
    // ferait paraître un set "gratuit à compléter" au lieu de "prix inconnus".
    it('traite un prix de 0€ comme inconnu, jamais comme gratuit', () => {
        const missing = [
            cardWithPrice('Carte sans prix', 0),
            cardWithPrice('Carte à 5€', 5)
        ];
        const result = computeSetCompletionBudget(missing, 'normal');

        expect(result.totalKnown).toBe(5);
        expect(result.countKnown).toBe(1);
        expect(result.countUnknown).toBe(1);
        expect(result.mostExpensive.card.name).toBe('Carte à 5€');
    });

    it('ne casse pas si toutes les cartes manquantes ont un prix inconnu', () => {
        const missing = [cardWithPrice('A', 0), cardWithPrice('B', 0)];
        const result = computeSetCompletionBudget(missing, 'normal');

        expect(result.totalKnown).toBe(0);
        expect(result.countKnown).toBe(0);
        expect(result.countUnknown).toBe(2);
        expect(result.mostExpensive).toBeNull();
    });
});
