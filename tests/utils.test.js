import { describe, it, expect } from 'vitest';
import { formatPrice, escapeHtml, getMarketValueForFinish } from '../modules/utils.js';

describe('formatPrice', () => {
    it('formate un nombre en euros avec virgule française', () => {
        expect(formatPrice(10)).toBe('10,00€');
        expect(formatPrice(10.5)).toBe('10,50€');
        expect(formatPrice(1789.91)).toBe('1789,91€');
    });

    it('traite undefined/null/NaN comme 0 (jamais NaN€)', () => {
        expect(formatPrice(undefined)).toBe('0,00€');
        expect(formatPrice(null)).toBe('0,00€');
        expect(formatPrice(NaN)).toBe('0,00€');
        expect(formatPrice('pas un nombre')).toBe('0,00€');
    });

    it('gère 0 explicitement', () => {
        expect(formatPrice(0)).toBe('0,00€');
    });
});

describe('escapeHtml', () => {
    it('échappe les caractères HTML dangereux', () => {
        expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(escapeHtml(`"Ash" & 'Pikachu'`)).toBe('&quot;Ash&quot; &amp; &#39;Pikachu&#39;');
    });

    it('traite null/undefined comme chaîne vide plutôt que de planter', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('convertit les valeurs non-string (nombre) sans échapper à tort', () => {
        expect(escapeHtml(200)).toBe('200');
    });
});

describe('getMarketValueForFinish', () => {
    it('retourne 0 pour une carte sans aucune donnée de prix', () => {
        expect(getMarketValueForFinish({}, 'normal')).toBe(0);
        expect(getMarketValueForFinish(null, 'normal')).toBe(0);
    });

    it('utilise le prix cardmarket générique si aucun variants_detailed', () => {
        const card = { pricing: { cardmarket: { avg: 12.5 } } };
        expect(getMarketValueForFinish(card, 'normal')).toBe(12.5);
    });

    it('utilise avg-holo en repli si avg est absent (fond générique)', () => {
        const card = { pricing: { cardmarket: { 'avg-holo': 8 } } };
        expect(getMarketValueForFinish(card, 'normal')).toBe(8);
    });

    it('trouve le variant exact correspondant au foil demandé', () => {
        const card = {
            variants_detailed: [
                { foil: 'reverse', pricing: { cardmarket: { avg: 3 } } },
                { foil: 'holo', pricing: { cardmarket: { avg: 15 } } }
            ]
        };
        expect(getMarketValueForFinish(card, 'holo')).toBe(15);
        expect(getMarketValueForFinish(card, 'reverse')).toBe(3);
    });

    it('retombe sur le prix Reverse sans foil si aucun variant ne correspond exactement', () => {
        const card = {
            variants_detailed: [
                { type: 'Reverse', pricing: { cardmarket: { avg: 4.2 } } }
            ]
        };
        expect(getMarketValueForFinish(card, 'holo_inexistant')).toBe(4.2);
    });

    it('retombe en dernier recours sur le prix Normal', () => {
        const card = {
            variants_detailed: [
                { type: 'Normal', pricing: { cardmarket: { avg: 1.1 } } }
            ]
        };
        expect(getMarketValueForFinish(card, 'finish_inconnu')).toBe(1.1);
    });

    it('type Normal/Holo correspond à finishValue "normal"', () => {
        const card = {
            variants_detailed: [
                { type: 'Normal', pricing: { cardmarket: { avg: 2 } } }
            ]
        };
        expect(getMarketValueForFinish(card, 'normal')).toBe(2);
    });
});
