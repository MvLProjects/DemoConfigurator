// Het productieblad: vier aanzichten met maten, een titelblok en de stuklijst,
// plus een tweede blad met het zaagplan.
//
// WAT DIT WEL EN NIET IS. Dit zijn GERENDERDE aanzichten van het 3D-model, geen
// geprojecteerde 2D-tekening met schaal en snedes. Het verschil doet ertoe:
// hierop kun je niet opmeten. De maten die erop staan komen uit de
// onderdelenlijst (zie maatvoering.js) en zijn dus exact, maar wat je met een
// liniaal op het papier meet klopt niet met een schaal.
//
// Daarom staat op het blad ook "niet op schaal". Een tekening waar iemand op
// gaat meten terwijl dat niet mag, is gevaarlijker dan geen tekening.
//
// HET TWEEDE BLAD IS DAARIN ANDERS. Een zaagplan is geen projectie van een
// vorm maar een verdeling van lengtes over een stang, en een lengte IS op
// schaal te tekenen. Daar staat dus wél een schaal op - maar alleen voor de
// LENGTE. De dikte van de balk zegt niets over de doorsnede van het profiel.
//
// DE INDELING, op een A3 liggend (420 x 297 mm):
//
//   blad 1                              blad 2
//     +----------+----------+             +-----------------------+
//     | vooraan. | zijaan.  |             |  zaagplan: per profiel|
//     +----------+----------+             |  een rij stangen met  |
//     | bovenaan.| isometr. |             |  de stukken erin      |
//     +----------+----------+             |                       |
//     | stuklijst           |             +-----------+-----------+
//     +----------+----------+             |           | titelblok |
//     |          | titelblok|             +-----------+-----------+
//     +----------+----------+

import { maakPdf, BLADMATEN, mm } from './pdf.js';
import { RAND, TITELHOOGTE, titelblok, kort, breedteVan } from './bladkader.js';

/**
 * Bouwt het productieblad.
 *
 * @param gegevens {
 *     formaat,            'A3' of 'A4'
 *     aanzichten,         [{ naam, jpeg, breedtePx, hoogtePx }]
 *     bom,                rijen uit bomRegel()
 *     titel: { bedrijf, opdracht, nummer, omschrijving, getekend, datum },
 *     zaaglijst,          uit maakZaaglijst() - weglaten geeft één blad
 *     vooraf,             bladen die hiervóór komen, elk als rij
 *                         tekenopdrachten. De samenstellingstekening en de
 *                         onderdeelbladen komen zo binnen: die hebben OCCT
 *                         nodig en dat hoort niet in een opmaakmodule.
 * }
 * @returns {Uint8Array} de bytes van de PDF
 */
export function maakProductieblad(gegevens) {
    const formaat = gegevens.formaat === 'A4' ? 'A4' : 'A3';
    const maat = BLADMATEN[formaat];
    const bladB = maat.breedte / mm(1);        // terug naar mm
    const bladH = maat.hoogte / mm(1);
    const t = [];

    // --- het beeld ----------------------------------------------------------
    //
    // HIER STONDEN VIER RENDERS: voor, zij, boven en isometrisch. Die zijn weg,
    // want sinds er een getekende samenstelling op blad 1 staat lieten ze
    // precies hetzelfde zien - twee bladen met dezelfde vier aanzichten, waarvan
    // het ene bovendien niet op schaal was.
    //
    // ÉÉN render blijft over, en die is geen herhaling: hij is INGEKLEURD. Een
    // lijntekening kan niet laten zien dat de leuning RAL 9005 wordt of dat de
    // trede van hout is. Daar is een getekende omtrek niet geschikt voor en een
    // plaatje wel.
    const aanzichten = (gegevens.aanzichten || []).filter(a => a && a.jpeg);
    const beeld = aanzichten.find(a => /isometr/i.test(a.naam)) || aanzichten[0];
    let vakkenHoogte = 0;
    if (beeld) {
        const vakB = (bladB - 2 * RAND) * 0.42;
        vakkenHoogte = (bladH - 2 * RAND) * 0.34;
        t.push({ soort: 'rechthoek', x: RAND, y: RAND, b: vakB, h: vakkenHoogte,
                 dik: 0.3 });
        t.push({ soort: 'tekst', x: RAND + 2, y: RAND + 2, grootte: 8, vet: true,
                 tekst: 'Zo ziet het eruit' });
        t.push({ soort: 'tekst', x: RAND + vakB - 54, y: RAND + 2.5, grootte: 6.5,
                 tekst: 'kleur en materiaal — niet opmeten' });

        const marge = 2;
        const ruimteB = vakB - 2 * marge, ruimteH = vakkenHoogte - 9 - marge;
        const s = Math.min(ruimteB / beeld.breedtePx, ruimteH / beeld.hoogtePx);
        const b = beeld.breedtePx * s, h = beeld.hoogtePx * s;
        t.push({ soort: 'afbeelding', jpeg: beeld.jpeg,
                 breedtePx: beeld.breedtePx, hoogtePx: beeld.hoogtePx,
                 x: RAND + (vakB - b) / 2, y: RAND + 9 + (ruimteH - h) / 2, b, h });
        vakkenHoogte += 4;
    }

    // --- de stuklijst ------------------------------------------------------
    const lijstTop = RAND + vakkenHoogte;
    const lijstHoogte = bladH - RAND - TITELHOOGTE - lijstTop - 4;
    t.push({ soort: 'tekst', x: RAND, y: lijstTop, tekst: 'Stuklijst',
             grootte: 9, vet: true });

    const kolommen = [
        { kop: 'pos', x: 0, b: 12 },
        { kop: 'aantal', x: 12, b: 14 },
        { kop: 'onderdeel', x: 26, b: 34 },
        { kop: 'profiel', x: 60, b: 44 },
        { kop: 'norm', x: 104, b: 48 },
        { kop: 'materiaal', x: 152, b: 34 },
        { kop: 'lengte', x: 186, b: 22 },
        { kop: 'zaaghoeken', x: 208, b: 26 },
        { kop: 'bestand', x: 234, b: 40 },
    ];
    const kopY = lijstTop + 6;
    const regelH = 4.2;
    for (const k of kolommen) {
        t.push({ soort: 'tekst', x: RAND + k.x, y: kopY, tekst: k.kop,
                 grootte: 6.5, vet: true });
    }
    t.push({ soort: 'lijn', x1: RAND, y1: kopY + 4.4,
             x2: RAND + 274, y2: kopY + 4.4, dik: 0.3 });

    // Hoeveel regels er passen. Meer dan dat past niet, en een halve regel over
    // de rand van het titelblok heen is erger dan een eerlijke mededeling.
    const maxRegels = Math.max(0, Math.floor((lijstHoogte - 10) / regelH));
    const bom = gegevens.bom || [];
    bom.slice(0, maxRegels).forEach((r, i) => {
        const y = kopY + 6 + i * regelH;
        const waarden = [r.positie, `${r.aantal}×`, r.soort, r.profiel, r.norm,
            r.materiaal, `${Number(r.zaaglengte).toFixed(1)} mm`,
            r.zaaghoeken, r.bestand];
        kolommen.forEach((k, kol) => {
            t.push({ soort: 'tekst', x: RAND + k.x, y,
                     tekst: kort(String(waarden[kol] ?? ''), k.b), grootte: 6.5 });
        });
    });
    if (bom.length > maxRegels) {
        t.push({ soort: 'tekst', x: RAND, y: kopY + 6 + maxRegels * regelH,
                 tekst: `… en nog ${bom.length - maxRegels} regels — `
                      + 'zie bom.csv in dit pakket', grootte: 6.5 });
    }

    // De bladen op volgorde van wat de werkplaats het eerst openslaat: de
    // getekende aanzichten op schaal, dan de renders met de stuklijst, dan het
    // zaagplan. De werkplaatstekening komt kant-en-klaar binnen omdat daar
    // OCCT voor nodig is, en dat hoort niet in een opmaakmodule.
    const bladen = (gegevens.vooraf || []).map((tek) =>
        ({ formaat, tekeningen: tek }));
    const aantal = bladen.length + 1 + (gegevens.zaaglijst ? 1 : 0);
    const nummer = (n) => (aantal > 1 ? `blad ${n} van ${aantal}` : '');

    titelblok(t, gegevens.titel || {}, bladB, bladH,
        'Stuklijst — maten in mm. Het beeld is niet op schaal; '
        + 'zie de getekende aanzichten.',
        nummer(bladen.length + 1));
    bladen.push({ formaat, tekeningen: t });

    if (gegevens.zaaglijst) {
        bladen.push({ formaat,
            tekeningen: zaagblad(gegevens.zaaglijst, gegevens.titel || {},
                                 bladB, bladH, nummer(aantal)) });
    }
    return maakPdf(bladen);
}

/**
 * Blad 2: het zaagplan.
 *
 * Per profiel een rij stangen, en in elke stang de stukken op hun ware
 * lengteverhouding. Daarmee is dit het enige blad waar meten WEL mag - in de
 * lengte althans, en daarom staat de schaal erop en niet "niet op schaal".
 *
 * Elk stuk draagt zijn POSITIENUMMER. Dat is hetzelfde nummer als in de
 * stuklijst, in de bestandsnamen van de STEP's en in bom.csv, zodat de zager
 * en degene die last naar hetzelfde stuk staal wijzen.
 */
function zaagblad(z, tb, bladB, bladH, bladnummer) {
    const t = [];
    const tbY = bladH - RAND - TITELHOOGTE;

    // De tekenbreedte van een hele stang. Links ruimte voor het stangnummer,
    // rechts voor de rest die overblijft.
    const nrB = 9, restB = 26;
    const tekenX = RAND + nrB;
    const tekenB = bladB - RAND - restB - tekenX;
    const schaal = tekenB / z.stanglengte;          // mm papier per mm staal
    const perMm = (v) => v * schaal;

    t.push({ soort: 'tekst', x: RAND, y: RAND, tekst: 'Zaagplan',
             grootte: 12, vet: true });

    const kg = z.gewicht === null ? ''
        : ` · ${z.gewicht.toFixed(1)} kg staal in de stukken, `
          + `${z.gewichtBesteld.toFixed(1)} kg ingekocht`
          + (z.gewichtVolledig ? '' : ' (alleen de catalogusprofielen)');
    t.push({ soort: 'tekst', x: RAND, y: RAND + 7,
             tekst: `${z.aantalStangen} stangen van ${z.stanglengte} mm · `
                  + `${z.aantalStukken} stukken · `
                  + `${(z.afvalDeel * 100).toFixed(1)}% afval${kg}`,
             grootte: 8 });
    t.push({ soort: 'tekst', x: RAND, y: RAND + 12.5,
             tekst: `Lengte op schaal 1:${Math.round(1 / schaal)}. De dikte van `
                  + `de balk zegt niets over de doorsnede. Gerekend met een `
                  + `zaagsnede van ${z.snede} mm, één per tussenruimte.`,
             grootte: 6.5 });

    let y = RAND + 20;
    const balkH = 7, balkGap = 2.2, kopH = 6.5, groepGap = 4;
    const ruimte = () => tbY - 6 - y;
    let overgeslagen = 0;

    // Past niet in een stang: bovenaan, in een kader, want dit is het enige wat
    // op dit blad een beslissing vraagt in plaats van een handeling.
    if (z.teLang && z.teLang.length) {
        const h = 6 + z.teLang.length * 4;
        t.push({ soort: 'rechthoek', x: RAND, y, b: bladB - 2 * RAND, h, dik: 0.5 });
        t.push({ soort: 'tekst', x: RAND + 2, y: y + 1.5, grootte: 7.5, vet: true,
                 tekst: 'PAST NIET IN EEN STANG — hier moet een las in, of er '
                      + 'zijn langere stangen nodig:' });
        z.teLang.forEach((l, i) => {
            t.push({ soort: 'tekst', x: RAND + 4, y: y + 6 + i * 4, grootte: 7,
                     tekst: `pos ${l.positie} · ${l.profiel} · `
                          + `${l.lengte.toFixed(1)} mm` });
        });
        y += h + groepGap;
    }

    for (const g of z.groepen) {
        // Een kop plus minstens één stang moet passen, anders begint de groep
        // onderaan het blad en loopt hij eraf.
        if (ruimte() < kopH + balkH + 2) {
            overgeslagen += g.aantalStangen;
            continue;
        }

        t.push({ soort: 'tekst', x: RAND, y, grootte: 8, vet: true,
                 tekst: kort(g.profiel, 80, 8) + (g.norm ? `   ${g.norm}` : '') });
        t.push({ soort: 'tekst', x: RAND + 150, y: y + 0.5, grootte: 6.5,
                 tekst: `${g.aantalStangen} stang(en) · ${g.aantalStukken} stuk(ken) · `
                      + `${(g.afvalDeel * 100).toFixed(1)}% afval`
                      + (g.gewicht === null ? '' : ` · ${g.gewicht.toFixed(1)} kg`) });
        y += kopH;

        for (const s of g.stangen) {
            if (ruimte() < balkH + 2) { overgeslagen++; continue; }

            t.push({ soort: 'tekst', x: RAND, y: y + 1.6,
                     tekst: String(g.stangen.indexOf(s) + 1), grootte: 7 });
            // De hele stang als kader; wat er niet in ligt is de rest.
            t.push({ soort: 'rechthoek', x: tekenX, y, b: tekenB, h: balkH,
                     dik: 0.3 });

            let op = tekenX;
            s.stukken.forEach((stuk, k) => {
                if (k > 0) {
                    // De zaagsnede: een dichte streep. Op 1:18 is 3 mm staal
                    // nog geen tiende millimeter papier, dus je ziet hem
                    // nauwelijks - maar hij hoort in de tekening en niet alleen
                    // in de som, anders lijkt het alsof de stukken elkaar raken.
                    t.push({ soort: 'rechthoek', x: op, y, b: perMm(z.snede),
                             h: balkH, vul: true });
                    op += perMm(z.snede);
                }
                const b = perMm(stuk.lengte);
                t.push({ soort: 'rechthoek', x: op, y, b, h: balkH, dik: 0.4 });
                // Het etiket alleen als het er echt in past. Een nummer dat
                // over de rand van zijn eigen stuk loopt wijst de zager naar
                // het verkeerde stuk staal.
                const etiket = `${stuk.positie} · ${Math.round(stuk.lengte)}`;
                if (b > breedteVan(etiket, 5.5) + 1.5) {
                    t.push({ soort: 'tekst', x: op + 1, y: y + 1.9,
                             tekst: etiket, grootte: 5.5 });
                } else if (b > breedteVan(stuk.positie, 5.5) + 1.5) {
                    t.push({ soort: 'tekst', x: op + 0.8, y: y + 1.9,
                             tekst: stuk.positie, grootte: 5.5 });
                }
                op += b;
            });

            t.push({ soort: 'tekst', x: tekenX + tekenB + 2, y: y + 1.9,
                     tekst: `rest ${Math.round(s.rest)}`, grootte: 6.5 });
            y += balkH + balkGap;
        }
        y += groepGap - balkGap;
    }

    if (overgeslagen > 0) {
        t.push({ soort: 'tekst', x: RAND, y, grootte: 7, vet: true,
                 tekst: `… en nog ${overgeslagen} stang(en) die niet op dit blad `
                      + 'passen — die staan volledig in zaaglijst.csv' });
    }

    titelblok(t, tb, bladB, bladH,
        `Zaagplan — lengte op schaal 1:${Math.round(1 / schaal)}, `
        + 'doorsnede niet op schaal', bladnummer);
    return t;
}