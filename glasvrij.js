// Glas zonder staanders: ruiten in een bodemprofiel, met een kaplijst erover.
//
// Een heel andere opbouw dan een leuning met staanders, en daarom een eigen
// bestand in plaats van nog een tak in padDelen. Er is geen staander, geen
// voetplaat, geen vulveld en geen klem; wat er overblijft is per recht stuk één
// profiel op de vloer, een rij ruiten en één kaplijst. padDelen stuurt hier
// naartoe zodra de vulling 'glasvrij' is, zodat alles wat daarna komt - het
// voorbeeld in het paneel, het bouwen, de stuklijst - langs dezelfde weg loopt.
//
// De maten staan in regels.json onder "glasvrij", met waar ze vandaan komen.
// Het zijn aannames: een vrijdragende ruit wordt door de leverancier van het
// systeem doorgerekend, en deze app rekent hem niet.

import { GLASVRIJ } from './balustrade-rules.js';
import { handregelStukken } from './pad.js';
import { stempelWerk } from './materialen.js';

const plus = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const maal = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const min = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const punt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lengte = (a) => Math.hypot(a[0], a[1], a[2]);
const eenheid = (a) => maal(a, 1 / lengte(a));
const kruis = (a, b) => [a[1] * b[2] - a[2] * b[1],
                         a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const omhoog = [0, 0, 1];

/** Het materiaal van profiel en kaplijst: aluminium, of RVS als dat gekozen is. */
const systeemMetaal = (p) => (p.metaal === 'rvs' ? 'rvs' : 'aluminium');

/**
 * De onderdelen van een glazen balustrade zonder staanders.
 *
 * Geeft hetzelfde terug als padDelen - { delen, velden, staanders,
 * verbindingen } - met één veld per RUIT. Er zijn geen staanders, dus die
 * lijst is leeg.
 */
export function glasvrijDelen(punten, gesloten, p) {
    const G = GLASVRIJ;
    const P = G.profiel;
    const K = G.kap;
    const t = G.dikte;

    // ALLEEN VLAK. Zie regels.json: op een helling zouden de ruiten scheve
    // parallellogrammen worden en moet het profiel mee hellen.
    const z0 = punten[0][2];
    if (punten.some(q => Math.abs(q[2] - z0) > 0.5)) {
        throw new Error('Glas zonder staanders kan alleen op een vlakke rand. '
            + 'Op een trap of helling hoort glas tussen staanders: kies "glas in klemmen".');
    }

    const kapBreedte = t + 2 * K.speling + 2 * K.wand;
    const glasOnder = P.bodem + G.onderlegblok;
    const glasBoven = p.hoogte - K.rug - K.speling;
    if (glasBoven - glasOnder < P.hoogte + 100) {
        throw new Error(`Bij ${p.hoogte} mm hoogte blijft er boven het bodemprofiel `
            + 'bijna geen glas over. Maak de balustrade hoger.');
    }

    // De doorsneden, in het lokale yz-vlak vanaf de hoek van het doosje: y de
    // breedte (dwars op de rand), z de hoogte. Het profiel is een U met de
    // opening naar boven, de kaplijst een U met de opening naar beneden.
    const profielVorm = [[0, 0], [P.breedte, 0], [P.breedte, P.hoogte],
        [P.breedte - P.wand, P.hoogte], [P.breedte - P.wand, P.bodem],
        [P.wand, P.bodem], [P.wand, P.hoogte], [0, P.hoogte]];
    const kapVorm = [[0, 0], [K.wand, 0], [K.wand, K.hoogte - K.rug],
        [kapBreedte - K.wand, K.hoogte - K.rug], [kapBreedte - K.wand, 0],
        [kapBreedte, 0], [kapBreedte, K.hoogte], [0, K.hoogte]];

    const delen = [];
    const velden = [];
    const verbindingen = [];
    const voegToe = (d) => delen.push(d) - 1;
    const metaal = systeemMetaal(p);

    for (const stuk of handregelStukken(punten, gesloten)) {
        const A = punten[stuk.begin];
        const B = punten[stuk.eind];
        const langs = stuk.langs;
        const dwars = eenheid(kruis(omhoog, langs));
        const L = lengte(min(B, A));

        // Hoe ver een liggend deel van breedte b voorbij de hoek doorloopt om
        // op verstek te komen; dezelfde meetkunde als de handregel in pad.js.
        const uitloop = (n, b) => (n ? (b / 2) * Math.abs(punt(dwars, n)) / punt(langs, n) : 0);
        const naarAssen = (n, teken) => [teken * punt(n, langs), teken * punt(n, dwars),
                                         teken * punt(n, omhoog)];
        /** Een liggend U-deel over dit hele stuk, op verstek in de hoeken. */
        const ligger = (soort, vorm, b, h, z, omschrijving) => {
            const uitBegin = uitloop(stuk.beginNormaal, b);
            const uitEind = uitloop(stuk.eindNormaal, b);
            const verstek = [];
            if (stuk.beginNormaal) {
                verstek.push({ punt: [uitBegin, b / 2, 0], richting: naarAssen(stuk.beginNormaal, -1) });
            }
            if (stuk.eindNormaal) {
                verstek.push({ punt: [uitBegin + L, b / 2, 0], richting: naarAssen(stuk.eindNormaal, 1) });
            }
            return voegToe({
                soort, omschrijving, doorsnede: vorm, materiaal: metaal,
                oorsprong: plus(plus(plus(A, [0, 0, z]), maal(dwars, -b / 2)), maal(langs, -uitBegin)),
                xAs: langs, yAs: dwars, zAs: omhoog,
                dx: L + uitBegin + uitEind, dy: b, dz: h,
                lengteAs: 'x', verstek,
            });
        };

        const profielNr = ligger('bodemprofiel', profielVorm, P.breedte, P.hoogte, 0,
            `U ${P.breedte} × ${P.hoogte}`);
        const kapNr = ligger('kaplijst', kapVorm, kapBreedte, K.hoogte, p.hoogte - K.hoogte,
            `U ${Math.round(kapBreedte * 10) / 10} × ${K.hoogte}`);

        // DE RUITEN. In een hoek mogen twee ruiten elkaar niet raken: elk
        // stopt zover voor de hoek dat zijn binnenste hoekpunt aan zijn eigen
        // kant van het verstekvlak blijft, plus een halve voeg. Met een
        // binnenhoek alfa is dat t/2 · cot(alfa/2); bij 90 graden een halve
        // ruitdikte. Aan een vrij eind loopt de ruit door tot het eind van het
        // profiel.
        const hoekInzet = (n) => {
            if (!n) return 0;
            const halveAlfa = Math.acos(Math.min(1, Math.abs(punt(n, langs))));
            const binnen = Math.PI / 2 - halveAlfa;     // de halve binnenhoek
            return (t / 2) / Math.tan(binnen) + G.voeg / 2;
        };
        const inBegin = hoekInzet(stuk.beginNormaal);
        const inEind = hoekInzet(stuk.eindNormaal);
        const beschikbaar = L - inBegin - inEind;
        const aantal = Math.max(1, Math.ceil((beschikbaar + G.voeg) / (G.maxRuit + G.voeg)));
        const breedte = (beschikbaar - (aantal - 1) * G.voeg) / aantal;
        const hoogte = glasBoven - glasOnder;

        for (let i = 0; i < aantal; i++) {
            const begin = inBegin + i * (breedte + G.voeg);
            const nr = voegToe({
                soort: 'ruit', materiaal: 'glas',
                // Een eigen bestelpost: gehard 17,52 kost iets anders dan de
                // 10,76 tussen staanders. Zie tarieven.json.
                bestelSoort: 'ruit:gehard',
                oorsprong: plus(plus(plus(A, [0, 0, glasOnder]), maal(dwars, -t / 2)),
                                maal(langs, begin)),
                xAs: langs, yAs: dwars, zAs: omhoog,
                dx: breedte, dy: t, dz: hoogte,
                lengteAs: 'x', zaaglengte: breedte,
            });
            const midden = plus(A, maal(langs, begin + breedte / 2));
            verbindingen.push({ a: nr, b: profielNr, soort: 'tussen', punt: midden, richting: omhoog });
            verbindingen.push({ a: nr, b: kapNr, soort: 'tussen', punt: midden, richting: omhoog });
            velden.push({
                index: velden.length,
                vulling: 'glasvrij',
                vrijeLengte: breedte,
                // Altijd vlak, en zonder vulraamwerk dus zonder strips.
                helling: 0,
                stripBreedte: null,
                spijlen: { aantal: 0, doorgang: 0, steek: 0 },
                glas: { lengte: breedte, hoogte, dikte: t,
                        // Wat er boven het profiel uitsteekt: daar kun je
                        // doorheen kijken.
                        vrijeHoogte: glasBoven - P.hoogte },
            });
        }
    }

    // De coatkleur geldt ook hier voor het hele werk: een bodemprofiel en een
    // kaplijst worden net zo goed gepoedercoat. Glas wordt het niet.
    stempelWerk(delen, p);
    return { delen, velden, staanders: [], verbindingen };
}
