// Gedraaide balusters: de klassieke spijl met een buik, een hals en een
// vierkant voetblokje.
//
// WAAROM DIT EEN EIGEN BESTAND IS EN GEEN SIERPUNT. Een sierpunt is een KOP:
// hij staat ergens bovenop en zijn hoogte volgt uit zijn eigen verhoudingen.
// Een baluster is de spijl ZELF: zijn hoogte is wat er tussen de twee regels
// overblijft, en die krijgt hij opgelegd. Dezelfde draaibank, een andere rol.
//
// HET DRAAIWERK KOMT UIT sierpunten.js, en wordt hier niet nagebouwd. Daar
// staan `omwenteling`, `blok`, `ring` en `alles` al, nagemeten op vijftien
// ornamenten. Zie de opmerking bij het draaiwerk daar voor waarom ze daar
// staan en niet in een eigen bestand.
//
// WAT DIT NIET IS: een natuurgetrouwe kopie van een bestaande baluster. De
// silhouetten hieronder zijn eigen meetkunde op algemene vormen - een buik,
// een hals, een ring - en geen overgenomen tekeningen. De verhoudingen zijn
// KEUZES, afgelezen van wat een klassieke baluster doet, en geen gemeten maten
// uit een catalogus. Dat staat hier zodat niemand ze later voor normmaten
// aanziet.

import { omwenteling, blok, ring, alles } from './sierpunten.js';

/** Geen baluster: een gewone rechte spijl. Zelfde afspraak als bij GEEN. */
export const RECHT = '';

/**
 * De modellen.
 *
 * `bouw(oc, { b, h }, opruimen)` levert één solid met zijn voet op z = 0,
 * gecentreerd op de as. `b` is de breedte van het vierkante voetblokje - de
 * breedste maat die hij inneemt - en `h` de totale hoogte.
 *
 * ALLE MATEN ZIJN AFGELEID VAN b EN h, zodat een baluster van 80 bij 700 en
 * een van 120 bij 900 allebei kloppen. Bij heel extreme verhoudingen (een
 * baluster die breder is dan hoog) wordt het een rare vorm; daar waarschuwt
 * `pastBij` voor.
 */
export const MODELLEN = [
    {
        id: 'klassiek',
        naam: 'Klassieke vaasbaluster',
        groep: 'Klassiek',
        omschrijving: 'Vierkant voetblok, een peervormige buik en een slanke '
            + 'hals met een ring. Dit is de vorm die je op een stenen '
            + 'bordestrap ziet.',
        bouw: (oc, { b, h }, op) => {
            const voet = h * 0.17;          // het vierkante blokje onderaan
            const kop = h * 0.07;           // het plaatje waar de regel op rust
            return alles(oc, [
                blok(oc, b, b, voet, 0, op),
                omwenteling(oc, [
                    [0, voet * 0.9],
                    [b * 0.40, voet * 0.9],
                    [b * 0.46, voet + h * 0.03],   // de bolle aanzet
                    [b * 0.50, voet + h * 0.12],   // de buik, het breedste punt
                    [b * 0.44, voet + h * 0.24],
                    [b * 0.30, voet + h * 0.36],   // de hals knijpt toe
                    [b * 0.21, voet + h * 0.46],
                    [b * 0.19, h - kop - h * 0.04],
                    [b * 0.26, h - kop],           // kraagje onder de kop
                    [0, h - kop],
                ], op),
                blok(oc, b * 0.86, b * 0.86, kop, h - kop, op),
            ], op);
        },
    },
    {
        id: 'slank',
        naam: 'Slanke baluster',
        groep: 'Klassiek',
        omschrijving: 'Dezelfde opbouw, maar met een smallere buik. Staat '
            + 'rustiger als er veel balusters naast elkaar komen.',
        bouw: (oc, { b, h }, op) => {
            const voet = h * 0.14;
            const kop = h * 0.06;
            return alles(oc, [
                blok(oc, b, b, voet, 0, op),
                omwenteling(oc, [
                    [0, voet * 0.9],
                    [b * 0.32, voet * 0.9],
                    [b * 0.38, voet + h * 0.04],
                    [b * 0.40, voet + h * 0.14],
                    [b * 0.34, voet + h * 0.28],
                    [b * 0.22, voet + h * 0.42],
                    [b * 0.16, voet + h * 0.54],
                    [b * 0.15, h - kop - h * 0.03],
                    [b * 0.21, h - kop],
                    [0, h - kop],
                ], op),
                blok(oc, b * 0.80, b * 0.80, kop, h - kop, op),
            ], op);
        },
    },
    {
        id: 'dubbel',
        naam: 'Dubbele baluster',
        groep: 'Klassiek',
        omschrijving: 'Twee buiken boven elkaar, gespiegeld om het midden. '
            + 'Wordt gebruikt waar een balustrade van twee kanten gezien wordt.',
        bouw: (oc, { b, h }, op) => {
            const voet = h * 0.12;
            const kop = h * 0.12;
            const vrij = h - voet - kop;
            // Eén buik, en dan dezelfde nog eens gespiegeld. Zo zijn ze per
            // definitie gelijk: twee rijtjes getallen zouden na één wijziging
            // uit elkaar gaan lopen.
            const buik = (van, hoog, omlaag) => {
                const p = [
                    [b * 0.20, 0], [b * 0.34, hoog * 0.14],
                    [b * 0.42, hoog * 0.34], [b * 0.38, hoog * 0.60],
                    [b * 0.26, hoog * 0.84], [b * 0.20, hoog],
                ];
                return (omlaag ? p.map(([r, z]) => [r, hoog - z]).reverse() : p)
                    .map(([r, z]) => [r, van + z]);
            };
            return alles(oc, [
                blok(oc, b, b, voet, 0, op),
                omwenteling(oc, [
                    [0, voet * 0.9], [b * 0.20, voet * 0.9],
                    ...buik(voet, vrij * 0.47, false),
                    ...buik(voet + vrij * 0.53, vrij * 0.47, true),
                    [b * 0.20, h - kop], [0, h - kop],
                ], op),
                ring(oc, b * 0.22, b * 0.05, voet + vrij * 0.5, op),
                blok(oc, b * 0.86, b * 0.86, kop, h - kop, op),
            ], op);
        },
    },
    {
        id: 'zuiltje',
        naam: 'Rond zuiltje',
        groep: 'Modern',
        omschrijving: 'Een rechte ronde stijl met een voet- en een kopblok. '
            + 'Geen buik; de eenvoudigste gedraaide vorm die er is.',
        bouw: (oc, { b, h }, op) => {
            const voet = h * 0.10;
            const kop = h * 0.08;
            return alles(oc, [
                blok(oc, b, b, voet, 0, op),
                omwenteling(oc, [
                    [0, voet * 0.9], [b * 0.34, voet * 0.9],
                    [b * 0.34, voet + h * 0.04],
                    [b * 0.30, voet + h * 0.10],
                    [b * 0.28, h - kop - h * 0.06],
                    [b * 0.34, h - kop],
                    [0, h - kop],
                ], op),
                blok(oc, b * 0.88, b * 0.88, kop, h - kop, op),
            ], op);
        },
    },
    {
        id: 'getapt',
        naam: 'Vierkant getapt',
        groep: 'Modern',
        omschrijving: 'Een vierkante stijl die naar boven toe smaller wordt. '
            + 'Niet gedraaid maar geslepen; hoort bij strakker werk.',
        bouw: (oc, { b, h }, op) => {
            // Een getapte vierkante stijl is GEEN omwentelingslichaam. Hij
            // wordt opgebouwd uit een stapeltje blokken dat naar boven toe
            // smaller wordt - vijf treden is genoeg om vloeiend te lijken
            // zonder er een kegel van te maken die hij niet is.
            const voet = h * 0.10;
            const kop = h * 0.08;
            const stam = h - voet - kop;
            const treden = 5;
            const stukken = [blok(oc, b, b, voet, 0, op)];
            for (let i = 0; i < treden; i++) {
                const van = voet + stam * (i / treden);
                const hoog = stam / treden + (i < treden - 1 ? h * 0.004 : 0);
                const maat = b * (0.72 - 0.16 * (i / (treden - 1)));
                stukken.push(blok(oc, maat, maat, hoog, van, op));
            }
            stukken.push(blok(oc, b * 0.88, b * 0.88, kop, h - kop, op));
            return alles(oc, stukken, op);
        },
    },
];

export function modelVan(id) {
    return MODELLEN.find(m => m.id === id) || null;
}

/** De modellen gegroepeerd, voor een keuzelijst. */
export function perGroep() {
    const uit = [];
    for (const m of MODELLEN) {
        let g = uit.find(x => x.groep === m.groep);
        if (!g) uit.push(g = { groep: m.groep, modellen: [] });
        g.modellen.push(m);
    }
    return uit;
}

/**
 * De slankste verhouding die nog een baluster oplevert.
 *
 * Onder deze verhouding (hoogte gedeeld door breedte) zit de buik zo dicht bij
 * het voetblok dat er geen vorm meer in te zien is; hij wordt dan een dikke
 * knobbel. Dit is een KEUZE, afgelezen aan de modellen zelf, en geen norm.
 */
export const MIN_SLANKHEID = 2.5;

/** Past deze baluster bij deze maten? Zo niet: waarom. */
export function pastBij(b, h) {
    if (!(b > 0) || !(h > 0)) return 'geen maten';
    if (h / b < MIN_SLANKHEID) {
        return `een baluster van ${Math.round(b)} mm breed heeft minstens `
            + `${Math.round(b * MIN_SLANKHEID)} mm hoogte nodig; hier is `
            + `${Math.round(h)} mm over`;
    }
    return null;
}

/**
 * De verhouding waarin een klassieke baluster zit: hoogte gedeeld door breedte.
 *
 * AFGELEZEN, NIET GEMETEN. Een stenen baluster van een bordestrap is ongeveer
 * vijf tot negen keer zo hoog als breed; dat is wat er op de voorbeelden te
 * zien is en wat de maten van de leveranciers suggereren. Het is dus een
 * richtsnoer voor het OOG en geen norm, en daarom een advies en geen weigering.
 */
export const KLASSIEKE_SLANKHEID = [5, 9];

/**
 * Advies over de verhouding, of null als het goed zit.
 *
 * WAAROM DIT GEEN FOUT IS. Een baluster van 20 mm breed bij 660 mm hoog
 * BOUWT prima - hij wordt alleen een breinaald met een bultje, en dat is niet
 * wat iemand bedoelt die "klassieke vaasbaluster" kiest. Maar een slanke
 * gedraaide spijl van smeedijzer bestaat echt, dus weigeren zou verkeerd zijn.
 * Zeggen wat er gebeurt en wat je eraan kunt doen is het juiste antwoord.
 *
 * Dit kwam uit een echt beeld: met de standaard spijlbreedte van 20 mm stond
 * er een leuning met balusters van 1 op 33, en de app zei er niets over.
 */
export function slankheidsadvies(b, h) {
    if (!(b > 0) || !(h > 0)) return null;
    const s = h / b;
    const [laag, hoog] = KLASSIEKE_SLANKHEID;
    if (s <= hoog) return null;
    const wil = Math.round(h / ((laag + hoog) / 2) / 5) * 5;
    return `Deze baluster wordt 1 op ${s.toFixed(0)} — veel slanker dan een `
        + `klassieke (1 op ${laag} à ${hoog}). Zet de spijlbreedte op ongeveer `
        + `${wil} mm voor de verhouding van een stenen balustrade.`;
}

/**
 * Eén baluster bouwen.
 *
 * Geeft een solid met zijn voet op z = 0 en gecentreerd op de as, net als een
 * sierpunt. De aanroeper zet hem op zijn plek.
 */
export function maakBaluster(oc, id, { b, h }, opruimen) {
    const model = modelVan(id);
    if (!model) throw new Error(`Onbekende baluster: ${id}`);
    const reden = pastBij(b, h);
    if (reden) throw new Error(`Deze baluster past hier niet: ${reden}.`);
    return model.bouw(oc, { b, h }, opruimen);
}
