// De offerte: één blad voor de KLANT.
//
// Het productiepakket is voor de werkplaats: zaaglengtes, DXF's, tekeningen op
// schaal. Een klant heeft daar niets aan. Die wil zien wat hij krijgt, van wat,
// en ongeveer wat het kost. Daarom een eigen blad, staand A4 zoals een brief:
//
//   bedrijf                                   OFFERTE
//   aan / betreft                     nummer, datum, geldig tot
//   +-----------------------------------------------------+
//   |              het model, ingekleurd                  |
//   +-----------------------------------------------------+
//   Uw ontwerp          de keuzes en maten
//   Onderdelen          per soort hoeveel stuks
//   Prijsindicatie      per post een bandbreedte, en het totaal
//   voorwaarden
//
// DE PRIJS IS EEN INDICATIE en het blad zegt dat ook, inclusief hoe hij
// berekend is. Zie prijsIndicatie in kosten.js. Een bedrag dat er als prijs
// uitziet maar een schatting is, is op een offerte erger dan geen bedrag.

import { maakPdf, BLADMATEN, mm } from './pdf.js';
import { kort, breedteVan } from './bladkader.js';
import { bereikTekst } from './kosten.js';

const MARGE = 18;

/**
 * @param g {
 *   titel:     { bedrijf, opdracht, nummer, omschrijving, datum },
 *   beeld:     { jpeg, breedtePx, hoogtePx } of null,
 *   keuzes:    [[label, waarde]],
 *   onderdelen:[[naam, aantal]],
 *   prijs:     uit prijsIndicatie(),
 *   geldig:    aantal dagen dat de offerte geldt
 * }
 * @returns {Uint8Array} de PDF
 */
export function maakOfferte(g) {
    const maat = BLADMATEN.A4staand;
    const bladB = maat.breedte / mm(1), bladH = maat.hoogte / mm(1);
    const breed = bladB - 2 * MARGE;
    const t = [];
    const tekst = (x, y, s, grootte = 9, vet = false) =>
        t.push({ soort: 'tekst', x, y, tekst: s, grootte, vet });
    // Rechts uitlijnen met een RUIME schatting van de breedte. breedteVan
    // rekent een halve lettergrootte per teken; dat is goed genoeg om af te
    // kappen, maar vet en een kastlijntje zijn breder, en dan stak "Nummer: —"
    // over de kantlijn. Iets te ver naar links valt niet op, erover wel.
    const rechts = (xRechts, y, s, grootte = 9, vet = false) =>
        tekst(xRechts - breedteVan(s, grootte) * (vet ? 1.3 : 1.2), y, s, grootte, vet);
    const titel = g.titel || {};

    // --- kop ---------------------------------------------------------------
    // Zonder bedrijfsgegevens blijft de linkerkant leeg; er stond hier eerst
    // "Offerte", en dan las de kop "Offerte ... OFFERTE".
    const bedrijf = String(titel.bedrijf || '').split('\n').filter(Boolean);
    if (bedrijf[0]) tekst(MARGE, MARGE, kort(bedrijf[0], 110, 13), 13, true);
    bedrijf.slice(1, 4).forEach((r, i) => tekst(MARGE, MARGE + 7 + i * 4, kort(r, 110, 8), 8));
    rechts(bladB - MARGE, MARGE, 'OFFERTE', 16, true);
    let y = MARGE + 22;
    t.push({ soort: 'lijn', x1: MARGE, y1: y, x2: bladB - MARGE, y2: y, dik: 0.4 });

    y += 5;
    tekst(MARGE, y, 'Aan: ' + kort(titel.opdracht || '—', 100, 9), 9);
    tekst(MARGE, y + 5, 'Betreft: ' + kort(titel.omschrijving || '—', 100, 9), 9, true);
    const datum = titel.datum || new Date().toLocaleDateString('nl');
    const tot = new Date(Date.now() + (g.geldig || 30) * 864e5).toLocaleDateString('nl');
    // In een vaste kolom en niet rechts uitgelijnd: de breedte van een tekst
    // is hier een schatting, en drie geschatte rechterkanten onder elkaar
    // rafelen zichtbaar.
    const kolX = bladB - MARGE - 48;
    tekst(kolX, y, `Nummer: ${kort(titel.nummer || '—', 30, 8)}`, 8);
    tekst(kolX, y + 4.5, `Datum: ${datum}`, 8);
    tekst(kolX, y + 9, `Geldig tot: ${tot}`, 8);
    y += 16;

    // --- het beeld ---------------------------------------------------------
    if (g.beeld && g.beeld.jpeg) {
        const vakH = 82;
        t.push({ soort: 'rechthoek', x: MARGE, y, b: breed, h: vakH, dik: 0.3 });
        const s = Math.min((breed - 4) / g.beeld.breedtePx, (vakH - 4) / g.beeld.hoogtePx);
        const b = g.beeld.breedtePx * s, h = g.beeld.hoogtePx * s;
        t.push({ soort: 'afbeelding', jpeg: g.beeld.jpeg,
                 breedtePx: g.beeld.breedtePx, hoogtePx: g.beeld.hoogtePx,
                 x: MARGE + (breed - b) / 2, y: y + (vakH - h) / 2, b, h });
        y += vakH + 6;
    }

    // --- uw ontwerp: de keuzes in twee kolommen ----------------------------
    const kop = (s) => {
        tekst(MARGE, y, s, 10.5, true);
        t.push({ soort: 'lijn', x1: MARGE, y1: y + 5.2, x2: bladB - MARGE, y2: y + 5.2,
                 dik: 0.2 });
        y += 8;
    };
    kop('Uw ontwerp');
    const kolB = breed / 2, regelH = 4.6;
    const keuzes = g.keuzes || [];
    const helft = Math.ceil(keuzes.length / 2);
    keuzes.forEach(([label, waarde], i) => {
        const x = MARGE + (i < helft ? 0 : kolB);
        const yy = y + (i % helft) * regelH;
        tekst(x, yy, kort(label, 30, 8), 8);
        tekst(x + 32, yy, kort(String(waarde), kolB - 34, 8), 8, true);
    });
    y += helft * regelH + 5;

    // --- onderdelen: per soort hoeveel stuks, in drie kolommen -------------
    kop('Onderdelen');
    const ond = g.onderdelen || [];
    const per = Math.ceil(ond.length / 3);
    ond.forEach(([naam, aantal], i) => {
        const x = MARGE + Math.floor(i / per) * (breed / 3);
        tekst(x, y + (i % per) * 4.2, kort(`${aantal}×  ${naam}`, breed / 3 - 2, 8), 8);
    });
    y += Math.max(1, per) * 4.2 + 5;

    // --- prijsindicatie ----------------------------------------------------
    kop('Prijsindicatie');
    const p = g.prijs || { regels: [], laag: 0, hoog: 0, ontbreekt: [] };
    // De bedragen in een vaste kolom, om dezelfde reden als rechtsboven.
    const bedragX = bladB - MARGE - 62;
    for (const r of p.regels) {
        tekst(MARGE, y, kort(r.naam, bedragX - MARGE - 4, 8.5), 8.5);
        tekst(bedragX, y, bereikTekst(r.laag, r.hoog), 8.5);
        y += 4.8;
    }
    t.push({ soort: 'lijn', x1: bedragX, y1: y, x2: bladB - MARGE, y2: y, dik: 0.3 });
    y += 2;
    tekst(MARGE, y, 'Totaal, indicatie excl. btw', 10, true);
    tekst(bedragX, y, p.regels.length ? bereikTekst(p.laag, p.hoog) : 'op aanvraag', 10, true);
    y += 7;
    if (p.ontbreekt.length) {
        tekst(MARGE, y, kort('Nog niet in de prijs: ' + p.ontbreekt.join(', ')
            + ' - wordt apart opgegeven.', breed, 8), 8);
        y += 5;
    }

    // --- voorwaarden, onderaan ---------------------------------------------
    const voet = [
        'Deze prijs is een indicatie: het staal is gerekend met een prijs per kilo voor een '
            + 'afgewerkte constructie,',
        'plus coating en de onderdelen die op maat besteld worden. De definitieve prijs volgt '
            + 'na inmeting ter plaatse.',
        `Alle bedragen exclusief btw, montage en transport. Geldig tot ${tot}.`,
    ];
    const voetY = bladH - MARGE - voet.length * 4;
    t.push({ soort: 'lijn', x1: MARGE, y1: voetY - 3, x2: bladB - MARGE, y2: voetY - 3,
             dik: 0.2 });
    voet.forEach((r, i) => tekst(MARGE, voetY + i * 4, kort(r, breed, 7), 7));

    return maakPdf([{ formaat: 'A4staand', tekeningen: t }]);
}
