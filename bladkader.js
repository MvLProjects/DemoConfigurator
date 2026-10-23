// Wat elk blad gemeen heeft: het titelblok en het afkorten van tekst.
//
// Dit stond in productie.js, en daar kon het blijven zolang er één soort blad
// was. Nu er een tweede bij komt - de werkplaatstekening - zou het of
// gekopieerd of over en weer geïmporteerd moeten worden, en dat laatste maakt
// een kringetje tussen de twee modules. Daarom hierheen: allebei de bladen
// lezen hieruit, en niemand leest uit de ander.
//
// Er is NIETS aan veranderd bij het verplaatsen. Hetzelfde titelblok, dezelfde
// maten, dezelfde schatting voor de tekstbreedte.

import { mm } from './pdf.js';

export const RAND = 10;              // marge rondom, in mm
export const TITELHOOGTE = 28;       // het titelblok rechtsonder

/**
 * Het titelblok rechtsonder, plus de bedrijfsgegevens ernaast.
 *
 * Op elk blad hetzelfde, op één regel na: de opmerking onderin. Op het
 * aanzichtenblad staat daar "niet op schaal", op het zaagblad en de
 * werkplaatstekening de schaal waarop getekend is. Dat is precies het soort
 * regel dat je niet op twee plekken wilt onderhouden.
 */
export function titelblok(t, tb, bladB, bladH, opmerking, bladnummer) {
    const tbB = 130, tbX = bladB - RAND - tbB, tbY = bladH - RAND - TITELHOOGTE;
    t.push({ soort: 'rechthoek', x: tbX, y: tbY, b: tbB, h: TITELHOOGTE, dik: 0.5 });
    t.push({ soort: 'lijn', x1: tbX, y1: tbY + 10, x2: tbX + tbB, y2: tbY + 10,
             dik: 0.3 });
    t.push({ soort: 'lijn', x1: tbX + 70, y1: tbY, x2: tbX + 70, y2: tbY + 10,
             dik: 0.3 });

    t.push({ soort: 'tekst', x: tbX + 2, y: tbY + 2.5,
             tekst: kort(tb.omschrijving || 'Balustrade', 66), grootte: 10, vet: true });
    t.push({ soort: 'tekst', x: tbX + 72, y: tbY + 3,
             tekst: 'tek.nr ' + kort(tb.nummer || '—', 24), grootte: 8 });
    t.push({ soort: 'tekst', x: tbX + 2, y: tbY + 12,
             tekst: 'opdracht: ' + kort(tb.opdracht || '—', 60), grootte: 7 });
    t.push({ soort: 'tekst', x: tbX + 2, y: tbY + 17,
             tekst: 'getekend: ' + kort(tb.getekend || '—', 30)
                  + '    datum: ' + (tb.datum || ''), grootte: 7 });
    t.push({ soort: 'tekst', x: tbX + 2, y: tbY + 22, tekst: opmerking,
             grootte: 6.5 });
    if (bladnummer) {
        t.push({ soort: 'tekst', x: tbX + 108, y: tbY + 22, tekst: bladnummer,
                 grootte: 6.5 });
    }

    // Bedrijfsgegevens linksonder, naast het titelblok.
    const regels = String(tb.bedrijf || '').split('\n').filter(Boolean).slice(0, 4);
    regels.forEach((r, i) => {
        t.push({ soort: 'tekst', x: RAND, y: tbY + 2 + i * 4,
                 tekst: kort(r, 80), grootte: 7, vet: i === 0 });
    });
}

/**
 * Kort een tekst af op een breedte in MILLIMETERS.
 *
 * Bij Helvetica is een teken gemiddeld ongeveer 0,5 x de lettergrootte breed.
 * Dat is een schatting en geen meting: de echte breedte per teken staat in de
 * lettertype-tabellen, en die hebben we niet omdat het lettertype niet wordt
 * ingesloten. Daarom aan de voorzichtige kant - liever een afgekorte naam dan
 * een naam die over de volgende kolom heen loopt.
 */
export function kort(tekst, breedteMm, grootte = 6.5) {
    const past = Math.max(1, Math.floor(breedteMm / perTeken(grootte)) - 1);
    return tekst.length <= past ? tekst : tekst.slice(0, Math.max(1, past - 1)) + '…';
}

/** De geschatte breedte van een stukje tekst in mm. Zelfde schatting als `kort`. */
export function breedteVan(tekst, grootte = 6.5) {
    return String(tekst).length * perTeken(grootte);
}

const perTeken = (grootte) => grootte * 0.5 / mm(1);
