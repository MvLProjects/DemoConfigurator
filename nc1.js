// DSTV-NC1: het machinebestand voor de zaag- en boorstraat, per onderdeel.
//
// VOORZICHTIG BEGONNEN. Een NC1-bestand stuurt een machine aan; een verkeerd
// teken in een verstekhoek zaagt een stuk in spiegelbeeld, en dat is afval.
// De officiële DSTV-beschrijving is niet vrij beschikbaar, en de conventie
// voor het teken en het vlak (lijf of flens) van een verstek kon ik niet
// betrouwbaar vaststellen. Daarom alleen wat zeker is:
//
//   - buizen (RO), kokers (M) en rond staf (RU),
//   - met RECHTE koppen (gemeten zaaghoeken allemaal 90°),
//   - zonder gaten, zadel, uitklinking, vissebek of afronding.
//
// Al het andere komt in LEESMIJ.txt met de reden, en niet half goed in een
// bestand. Met één NC1-voorbeeld uit HiCAD van een verstekte regel kunnen de
// verstekken later geijkt worden.
//
// DE KOP (ST), regel voor regel, met twee spaties ervoor - de volgorde zoals
// de open-source lezer DSTV.Net hem leest (HeaderReader.cs):
//   order, tekening, fase, stuk, staalsoort, aantal, profiel, profielcode,
//   lengte, profielhoogte, flensbreedte, flensdikte, lijfdikte, straal,
//   kg/m, m²/m, lijf begin, lijf eind, flens begin, flens eind (snedehoeken),
//   en vier tekstregels.
// Profielcodes (DSTV.Net README): RO = buis, RU = rond staf, M = koker.

import { categorieVan } from './profielen.js';

const CODE = { CHS: 'RO', RoundBars: 'RU', SHS: 'M', RHS: 'M' };

const getal = (v) => (Number.isFinite(v) ? v : 0).toFixed(2);

/**
 * Waarom dit onderdeel (nog) geen NC1 krijgt, of null als het wel kan.
 * @param u  een uniek productieonderdeel: { deel, zaaghoeken }
 */
export function waaromGeenNc1(u) {
    const d = u.deel;
    if (d.besteld) return 'wordt besteld, niet gezaagd';
    if (!d.profiel) return 'geen profiel uit de catalogus';
    const soort = categorieVan(d.profiel).sleutel;
    if (!CODE[soort]) return `profielsoort ${soort} (nog) niet als NC1`;
    if (d.bocht || d.rond || d.plaat || (d.gaten && d.gaten.length)) return 'geen gezaagd profiel';
    if ((d.verstek && d.verstek.length) || (u.zaaghoeken || []).some(h => Math.abs(h - 90) > 0.05)) {
        return 'verstek of schuine kop - de tekenconventie is nog niet geijkt';
    }
    if ((d.zadel && d.zadel.length) || (d.uitklinken && d.uitklinken.length)) return 'zadel of uitklinking in de kop';
    if (d.vissebek && d.vissebek.length) return 'vissebek';
    if (d.afronden) return 'afgeronde kop';
    if (d.doorsteken && d.doorsteken.length) return 'gaten voor doorgestoken spijlen';
    return null;
}

/**
 * Het NC1-bestand van één onderdeel, of null als het niet kan.
 *
 * @param u      { deel, aantal, zaaghoeken }
 * @param regel  de stuklijstregel: { positie, materiaal, zaaglengte }
 * @param kop    { order, tekening } - vrije tekst voor de kop
 */
export function maakNc1(u, regel, kop = {}) {
    if (waaromGeenNc1(u)) return null;
    const p = u.deel.profiel;
    const c = (p.bron && p.bron.catalogue) || p.catalogus || p.catalogue || {};
    const soort = categorieVan(p).sleutel;
    const doos = p.boxSize || (p.bron && p.bron.boxSize) || [0, 0];
    const D = Number(c.DA) || Number(c.D) || doos[0];
    const t = Number(c.S) || 0;
    const [hoogte, breedte] = soort === 'CHS' || soort === 'RoundBars' ? [D, D] : [doos[1], doos[0]];
    const straal = Number(c.RA) || 0;
    const tekst = (v) => String(v || '').replace(/[\r\n]+/g, ' ').slice(0, 30);
    const regels = [
        'ST',
        tekst(kop.order || 'BALUSTRADE'),
        tekst(kop.tekening || ''),
        '1',
        tekst(regel.positie),
        tekst(regel.materiaal),
        String(u.aantal),
        tekst(c.DSTV || p.englishLabel || p.label),
        CODE[soort],
        getal(regel.zaaglengte),
        getal(hoogte), getal(breedte), getal(t), getal(t), getal(straal),
        getal(Number(c.GEW)), getal(Number(c.MANTELFL)),
        getal(0), getal(0), getal(0), getal(0),
        '', '', '', '',
    ];
    return regels.map((r, i) => (i === 0 ? r : '  ' + r)).join('\r\n') + '\r\nEN\r\n';
}
