// Het sterkterapport: de uitkomst van het tabblad Sterkte als PDF, om aan een
// constructeur te geven.
//
// GEEN KEURING EN GEEN CERTIFICAAT. Het rapport zegt bovenaan en onderaan dat
// het een vereenvoudigde berekening is, met welke uitgangspunten, en waar de
// app niet rekent. Precies wat een constructeur nodig heeft om het na te
// lopen: per controle de formule, de bron van elk getal en de uitkomst.
//
//   STERKTECONTROLE - REKENHULP, GEEN KEURING          datum, nummer
//   het model
//   Uitgangspunten      plek, duwkracht + bron, factoren, profielen, maten
//   Samenvatting        x voldoen, y te zwak, ...
//   Controles           per controle: oordeel, vraag, getal tegen grens,
//                       hoe berekend, voorstel
//   Slot                wat de app niet doet

import { maakPdf, BLADMATEN, mm } from './pdf.js';

const MARGE = 16;

// Helvetica in een PDF kent alleen WinAnsi (West-Europees). Griekse letters en
// wiskundetekens worden daar "?"; dus uitgeschreven.
const UITGESCHREVEN = { 'γ': 'gamma', 'τ': 'tau', 'ψ': 'psi', 'β': 'beta', 'δ': 'delta', 'σ': 'sigma',
    '√': 'wortel', '≤': '<=', '≥': '>=', '⁴': '^4', '∮': 'som', '✓': '', '✗': '', '⚑': '' };
export const pdfTekst = (s) => String(s).replace(/[γτψβδσ√≤≥⁴∮✓✗⚑]/g, (c) => UITGESCHREVEN[c]);
// Een ruime schatting van de tekstbreedte in mm: Helvetica is gemiddeld zo'n
// halve lettergrootte breed per teken.
const tekensPerRegel = (breedteMm, grootte) => Math.floor(breedteMm / (grootte * 0.5 * 25.4 / 72));

/** Tekst afbreken op woorden, voor een vak van `breedte` mm. */
export function breekAf(tekst, breedte, grootte) {
    const max = Math.max(10, tekensPerRegel(breedte, grootte));
    const regels = [];
    for (const alinea of pdfTekst(tekst || '').split('\n')) {
        let regel = '';
        for (const woord of alinea.split(/\s+/).filter(Boolean)) {
            if (regel && (regel + ' ' + woord).length > max) { regels.push(regel); regel = woord; }
            else regel = regel ? regel + ' ' + woord : woord;
            while (regel.length > max) { regels.push(regel.slice(0, max)); regel = regel.slice(max); }
        }
        regels.push(regel);
    }
    return regels;
}

const OORDEEL = {
    'voldoet': 'GOED', 'voldoet niet': 'TE ZWAK',
    'onvoldoende gegevens': 'NOG NIET TE BEOORDELEN', 'constructeur of proef nodig': 'CONSTRUCTEUR NODIG',
};

/**
 * Het rapport als PDF-bytes.
 *
 * @param g { titel: {nummer, omschrijving, datum}, beeld, uitgangspunten: [[label, waarde]],
 *            rijen: de rijen van sterkteNu(), vraag: (naam) => tekst }
 */
export function maakSterkterapport(g) {
    const maat = BLADMATEN.A4staand;
    const bladB = maat.breedte / mm(1), bladH = maat.hoogte / mm(1);
    const breed = bladB - 2 * MARGE;
    const bladen = [];
    let t = null, y = 0;
    const nieuwBlad = () => {
        t = [];
        bladen.push({ formaat: 'A4staand', tekeningen: t });
        y = MARGE;
    };
    const tekst = (x, yy, s, grootte = 9, vet = false) =>
        t.push({ soort: 'tekst', x, y: yy, tekst: pdfTekst(s), grootte, vet });
    const ruimte = (h) => { if (y + h > bladH - MARGE) nieuwBlad(); };
    const alinea = (s, grootte = 8, vet = false, inspring = 0) => {
        for (const r of breekAf(s, breed - inspring, grootte)) {
            ruimte(grootte * 0.45);
            tekst(MARGE + inspring, y, r, grootte, vet);
            y += grootte * 0.45;
        }
    };
    const kop = (s) => {
        ruimte(14);
        y += 2;
        tekst(MARGE, y, s, 11, true);
        t.push({ soort: 'lijn', x1: MARGE, y1: y + 5.4, x2: bladB - MARGE, y2: y + 5.4, dik: 0.2 });
        y += 9;
    };

    nieuwBlad();
    const titel = g.titel || {};
    tekst(MARGE, y, 'STERKTECONTROLE', 16, true);
    tekst(bladB - MARGE - 52, y, `Datum: ${titel.datum || new Date().toLocaleDateString('nl')}`, 8);
    tekst(bladB - MARGE - 52, y + 4.5, `Nummer: ${titel.nummer || '-'}`, 8);
    y += 8;
    tekst(MARGE, y, 'Rekenhulp, geen keuring en geen certificaat', 10, true);
    y += 5;
    alinea('Een vereenvoudigde berekening met de uitgangspunten hieronder. Dit rapport zegt '
        + 'niet dat de balustrade veilig of gecertificeerd is; een constructeur hoort de '
        + 'uitgangspunten, de aannames en de uitkomsten te beoordelen.', 8);
    if (titel.omschrijving) { y += 1; alinea('Betreft: ' + titel.omschrijving, 9, true); }
    y += 3;

    if (g.beeld && g.beeld.jpeg) {
        const vakH = 70;
        ruimte(vakH);
        t.push({ soort: 'rechthoek', x: MARGE, y, b: breed, h: vakH, dik: 0.3 });
        const s = Math.min((breed - 4) / g.beeld.breedtePx, (vakH - 4) / g.beeld.hoogtePx);
        const b = g.beeld.breedtePx * s, h = g.beeld.hoogtePx * s;
        t.push({ soort: 'afbeelding', jpeg: g.beeld.jpeg, breedtePx: g.beeld.breedtePx,
                 hoogtePx: g.beeld.hoogtePx, x: MARGE + (breed - b) / 2, y: y + (vakH - h) / 2, b, h });
        y += vakH + 4;
    }

    kop('Uitgangspunten');
    for (const [label, waarde] of g.uitgangspunten || []) {
        const regels = breekAf(String(waarde), breed - 52, 8);
        ruimte(regels.length * 3.8);
        tekst(MARGE, y, label, 8);
        regels.forEach((r, i) => tekst(MARGE + 52, y + i * 3.8, r, 8, true));
        y += regels.length * 3.8 + 1;
    }

    const rijen = g.rijen || [];
    const tel = (st) => rijen.filter(r => r.status === st).length;
    kop('Samenvatting');
    alinea([
        tel('voldoet') && `${tel('voldoet')} goed`,
        tel('voldoet niet') && `${tel('voldoet niet')} te zwak`,
        tel('onvoldoende gegevens') && `${tel('onvoldoende gegevens')} nog niet te beoordelen`,
        tel('constructeur of proef nodig') && `${tel('constructeur of proef nodig')} voor de constructeur`,
    ].filter(Boolean).join('  ·  '), 9, true);

    kop('Controles');
    const vraag = g.vraag || ((n) => n);
    for (const r of rijen) {
        ruimte(18);
        alinea(`${OORDEEL[r.status] || r.status}  -  ${r.naam}`, 9, true);
        if (vraag(r.naam) !== r.naam) alinea(vraag(r.naam), 8, false, 4);
        if (r.waarde !== undefined && r.grens !== undefined && r.grens !== null) {
            alinea(`Berekend ${r.waarde} ${r.eenheid}, grens ${r.grens} ${r.eenheid}.`, 8, false, 4);
        }
        if (r.toelichting) alinea(r.toelichting, 7.5, false, 4);
        if (r.voorstel) alinea('Voorstel: ' + r.voorstel, 8, false, 4);
        y += 2.5;
    }

    kop('Wat dit rapport niet is');
    alinea('Geen keuring, geen certificaat en geen vervanging van een berekening door een '
        + 'constructeur of van een slingerproef. Waar staat "constructeur nodig" rekent de app '
        + 'niet. Waar staat "nog niet te beoordelen" ontbrak invoer. Belastingen, factoren en '
        + 'grenzen zijn de uitgangspunten hierboven, met hun bron; controleer die eerst.', 8);
    return maakPdf(bladen);
}
