// Een PDF schrijven, zonder bibliotheek.
//
// WAAROM ZELF. Dit project heeft geen build-stap en geen npm; alles wat erin
// zit is met de hand te lezen. Een PDF-bibliotheek vendoren zou honderden
// kilobytes code toevoegen die niemand hier naleest, terwijl we maar vier
// dingen nodig hebben: tekst, lijnen, vlakken en een afbeelding.
//
// PDF IS EEN TEKSTFORMAAT met een paar binaire stukken ertussen. Een pagina is
// een stroom tekenopdrachten in postscript-achtige notatie, en aan het eind
// staat een tabel met de byte-posities van elk object. Dat laatste is het enige
// echt kritische deel: klopt een positie niet, dan weigert elke lezer het
// bestand.
//
// TWEE KEUZES DIE HET KLEIN HOUDEN:
//
// 1. De AFBEELDINGEN gaan er als JPEG in, niet als PNG. Een PDF kan een
//    JPEG-stroom letterlijk insluiten (/DCTDecode) - de bytes uit
//    canvas.toDataURL('image/jpeg') kunnen er ongewijzigd in. Voor PNG zou de
//    pixels uitgepakt en opnieuw als zlib-stroom ingepakt moeten worden, en
//    daar is dan weer een deflate-implementatie voor nodig.
//
// 2. Het LETTERTYPE is Helvetica, een van de veertien die elke PDF-lezer zelf
//    heeft. Daardoor hoeft er geen lettertype ingesloten te worden. Dat kost
//    wel iets: alleen tekens uit WinAnsi (Latin-1) komen eruit zoals bedoeld,
//    en de breedte van een regel is niet exact te berekenen zonder de
//    lettertype-tabellen. Voor een titelblok en een stuklijst is dat genoeg.
//
// MAATEENHEID: punten, 1/72 inch, met de oorsprong LINKSONDER. Een A4 liggend
// is 842 x 595 punten. De helpers hieronder rekenen in millimeters, want zo
// denkt iedereen die een tekening maakt.

/** Millimeters naar punten. */
export const mm = (w) => w * 72 / 25.4;

export const BLADMATEN = {
    A4: { breedte: mm(297), hoogte: mm(210) },     // liggend
    A3: { breedte: mm(420), hoogte: mm(297) },
    // Staand, voor een brief zoals de offerte. Een tekening ligt; een brief niet.
    A4staand: { breedte: mm(210), hoogte: mm(297) },
};

// De tekens die WinAnsiEncoding wél heeft maar Latin-1 niet, op hun plek in de
// tabel. Dit is het hele verschil tussen de twee coderingen; de rest van
// CP1252 is gelijk aan Latin-1.
const WINANSI = {
    0x20AC: 0x80,  // €
    0x201A: 0x82,  // ‚
    0x0192: 0x83,  // ƒ
    0x201E: 0x84,  // „
    0x2026: 0x85,  // …   staat achter elke naam die `kort()` afkapt
    0x2020: 0x86,  // †
    0x2021: 0x87,  // ‡
    0x02C6: 0x88,  // ˆ
    0x2030: 0x89,  // ‰
    0x0160: 0x8A,  // Š
    0x2039: 0x8B,  // ‹
    0x0152: 0x8C,  // Œ
    0x017D: 0x8E,  // Ž
    0x2018: 0x91,  // '
    0x2019: 0x92,  // '
    0x201C: 0x93,  // "
    0x201D: 0x94,  // "
    0x2022: 0x95,  // •
    0x2013: 0x96,  // –
    0x2014: 0x97,  // —   het kastlijntje in "NIET OP SCHAAL — maten in mm"
    0x02DC: 0x98,  // ˜
    0x2122: 0x99,  // ™
    0x0161: 0x9A,  // š
    0x203A: 0x9B,  // ›
    0x0153: 0x9C,  // œ
    0x017E: 0x9E,  // ž
    0x0178: 0x9F,  // Ÿ
};

/**
 * Een tekst omzetten naar de codering die de lettertypen hieronder aangeven:
 * WinAnsiEncoding, oftewel CP1252.
 *
 * DIT MOET OP ÉÉN PLEK, en dat was het niet. De PDF-structuur ging door
 * `Bytes.tekst` (Latin-1) maar de INHOUDSSTROOM - alles wat je op het blad
 * leest - werd met `TextEncoder` als UTF-8 weggeschreven. Een kastlijntje is in
 * UTF-8 drie bytes, en WinAnsi leest die als drie losse tekens: op het
 * productieblad stond letterlijk "NIET OP SCHAAL â€” maten in mm".
 *
 * Het verschil tussen CP1252 en Latin-1 is precies de tabel hieronder: een
 * handvol leestekens in de gaten 0x80-0x9F. Al het andere dat wij schrijven -
 * é, ×, °, · - zit al in Latin-1 en heeft daar hetzelfde nummer. Wat er dan nog
 * buiten valt wordt een vraagteken, want een PDF-lezer kan er zonder ingesloten
 * lettertype niets mee.
 */
function naarWinAnsi(s) {
    const uit = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        uit[i] = c < 256 ? c : (WINANSI[c] || 63);      // 63 = '?'
    }
    return uit;
}

// --- bytes verzamelen ------------------------------------------------------

/**
 * Verzamelt stukken tekst en bytes, en houdt bij hoeveel bytes er al in zitten.
 *
 * Dat laatste is waar het om gaat: de kruisverwijzingstabel aan het eind van
 * een PDF noemt van elk object de byte-positie vanaf het begin van het bestand.
 * Eén byte ernaast en het bestand is onleesbaar.
 */
class Bytes {
    constructor() { this.stukken = []; this.lengte = 0; }

    tekst(s) { this.rauw(naarWinAnsi(s)); }

    rauw(bytes) {
        this.stukken.push(bytes);
        this.lengte += bytes.length;
    }

    klaar() {
        const uit = new Uint8Array(this.lengte);
        let op = 0;
        for (const s of this.stukken) { uit.set(s, op); op += s.length; }
        return uit;
    }
}

/**
 * Tekst voor in een PDF-string: haakjes en backslash moeten ontsnapt.
 *
 * Zonder dit maakt een omschrijving met een haakje erin het hele bestand kapot,
 * want de lezer denkt dan dat de string daar ophoudt.
 */
function pdfTekst(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// --- de tekenopdrachten van één blad ---------------------------------------

/**
 * Bouwt de inhoudsstroom van een pagina uit de tekenopdrachten.
 *
 * Alle maten komen in MILLIMETERS binnen en met de oorsprong LINKSBOVEN - zoals
 * je een blad leest. Hier wordt dat omgerekend naar punten met de oorsprong
 * linksonder, want zo wil PDF het. Dat op één plek doen scheelt een hoop
 * omgekeerde y-waarden in de rest van de code, en precies dáár gaat het mis.
 */
function stroomVan(blad, hoogtePt) {
    const uit = [];
    const y = (v) => (hoogtePt - mm(v)).toFixed(2);
    const x = (v) => mm(v).toFixed(2);

    // De lijnstijl wordt BIJGEHOUDEN en alleen geschreven als hij verandert.
    // Een tekening met geprojecteerde lijnen heeft er al gauw driehonderd, en
    // bij elke lijn opnieuw de dikte en het streepjespatroon zetten maakt de
    // stroom twee keer zo groot zonder dat er iets anders uit komt.
    //
    // Dit mag over een q/Q-blok heen: `q` bewaart de stand en `Q` zet hem
    // terug, en in zo'n blok wordt alleen een afbeelding geschaald - aan dikte
    // en streep komt niets.
    let dikNu = null, streepNu = null;
    const stijl = (dik, streep) => {
        // `|| 0.2` en niet een controle op undefined: 0 betekent in PDF "de
        // dunste lijn die dit apparaat kan", en dat hangt dus van de printer af.
        // Dat willen we niet per ongeluk krijgen.
        const d = (dik || 0.2).toFixed(2);
        if (d !== dikNu) { uit.push(`${d} w`); dikNu = d; }
        // [] 0 d is een doorgetrokken lijn. Zonder dat terugzetten loopt een
        // streepjespatroon door over alles wat erna komt.
        const s = streep && streep.length
            ? `[${streep.map(v => mm(v).toFixed(2)).join(' ')}] 0 d` : '[] 0 d';
        if (s !== streepNu) { uit.push(s); streepNu = s; }
    };

    for (const t of blad.tekeningen) {
        if (t.soort === 'polylijn') {
            // Een rij punten als één pad. Minder dan twee punten is geen lijn:
            // een `m` zonder `l` laat de PDF-lezer met een open pad zitten.
            const p = t.punten || [];
            if (p.length < 2) continue;
            stijl(t.dik, t.streep);
            const stukken = [`${x(p[0][0])} ${y(p[0][1])} m`];
            for (let i = 1; i < p.length; i++) {
                stukken.push(`${x(p[i][0])} ${y(p[i][1])} l`);
            }
            // `vul` maakt er een dicht vlak van. Dat is er voor de pijlpunten
            // van een maatlijn: die horen massief te zijn, anders lijkt een
            // pijl op twee losse streepjes.
            uit.push(stukken.join(' ')
                + (t.vul ? ' h f' : t.gesloten ? ' h S' : ' S'));
        } else if (t.soort === 'tekst') {
            const grootte = t.grootte || 9;
            const font = t.vet ? '/F2' : '/F1';
            // `hoek` draait de tekst, tegen de klok in, om zijn eigen
            // ankerpunt. Nodig voor een verticale maatlijn: die hoort van
            // onder naar boven gelezen te worden, niet liggend naast de maat.
            //
            // Het ankerpunt blijft LINKSBOVEN van de tekst, net als zonder
            // draaiing - de verschuiving naar de basislijn draait mee. Bij
            // hoek 0 komt er precies hetzelfde uit als voorheen.
            const r = (t.hoek || 0) * Math.PI / 180;
            const cos = Math.cos(r), sin = Math.sin(r);
            const zak = grootte * 0.78;
            uit.push('BT', `${font} ${grootte} Tf`,
                `${cos.toFixed(5)} ${sin.toFixed(5)} ${(-sin).toFixed(5)} `
                + `${cos.toFixed(5)} ${(mm(t.x) + sin * zak).toFixed(2)} `
                + `${(hoogtePt - mm(t.y) - cos * zak).toFixed(2)} Tm`,
                `(${pdfTekst(t.tekst)}) Tj`, 'ET');
        } else if (t.soort === 'lijn') {
            stijl(t.dik, t.streep);
            uit.push(`${x(t.x1)} ${y(t.y1)} m ${x(t.x2)} ${y(t.y2)} l S`);
        } else if (t.soort === 'rechthoek') {
            stijl(t.dik, t.streep);
            // `grijs` is een grijswaarde van 0 (zwart) tot 1 (wit) voor de
            // VULLING. Daarmee kan een kopregel een band achter zich krijgen,
            // en dat is wat een blad eruit laat zien als een tekening in plaats
            // van als losse lijnen. Daarna terug naar zwart, anders wordt alles
            // wat erna komt ook grijs.
            if (t.grijs !== undefined) uit.push(`${t.grijs} g`);
            uit.push(`${x(t.x)} ${(hoogtePt - mm(t.y) - mm(t.h)).toFixed(2)} `
                + `${mm(t.b).toFixed(2)} ${mm(t.h).toFixed(2)} re `
                + `${t.vul || t.grijs !== undefined ? 'f' : 'S'}`);
            if (t.grijs !== undefined) uit.push('0 g');
        } else if (t.soort === 'afbeelding') {
            // Een afbeelding wordt getekend in een vierkant van 1x1, dus de
            // schaal IS de maat. q/Q houden die schaal lokaal.
            uit.push('q',
                `${mm(t.b).toFixed(2)} 0 0 ${mm(t.h).toFixed(2)} `
                + `${x(t.x)} ${(hoogtePt - mm(t.y) - mm(t.h)).toFixed(2)} cm`,
                `/${t.naam} Do`, 'Q');
        }
    }
    return uit.join('\n');
}

// --- het bestand -----------------------------------------------------------

/**
 * Maakt een PDF van een of meer bladen.
 *
 * @param bladen  [{ formaat: 'A4'|'A3', tekeningen: [...] }]
 *                tekeningen: { soort: 'tekst' | 'lijn' | 'polylijn' |
 *                              'rechthoek' | 'afbeelding' }
 *                met maten in mm vanaf LINKSBOVEN.
 *                Een afbeelding heeft { jpeg: Uint8Array, breedtePx, hoogtePx }.
 *                Een polylijn heeft { punten: [[x,y],…] } en mag `gesloten`.
 *                Lijn, polylijn en rechthoek mogen `dik` (mm) en `streep`
 *                ([streep, gat, …] in mm) - dat laatste is de streepjeslijn
 *                voor wat achter iets anders zit.
 * @returns {Uint8Array} de bytes van het bestand
 */
export function maakPdf(bladen) {
    const objecten = [];                 // index 0 is object 1
    const voegToe = (inhoud) => objecten.push(inhoud) ;

    // 1 catalogus, 2 paginaboom, dan per blad een pagina + een stroom, en aan
    // het eind de lettertypen en de afbeeldingen. De nummers staan hier vast
    // zodat de verwijzingen hieronder kloppen.
    const eersteBlad = 3;
    const perBlad = 2;                   // pagina + inhoudsstroom
    const fontGewoon = eersteBlad + bladen.length * perBlad;
    const fontVet = fontGewoon + 1;
    let volgend = fontVet + 1;

    // De afbeeldingen krijgen hun nummer vooraf, want de pagina moet ernaar
    // kunnen verwijzen voordat ze geschreven zijn.
    const plaatjes = [];
    for (const blad of bladen) {
        for (const t of blad.tekeningen) {
            if (t.soort !== 'afbeelding') continue;
            t.naam = 'Im' + volgend;
            plaatjes.push({ nummer: volgend, t });
            volgend++;
        }
    }

    voegToe(`<< /Type /Catalog /Pages 2 0 R >>`);
    const kids = bladen.map((_, i) => `${eersteBlad + i * perBlad} 0 R`).join(' ');
    voegToe(`<< /Type /Pages /Kids [${kids}] /Count ${bladen.length} >>`);

    const stromen = [];
    bladen.forEach((blad, i) => {
        const maat = BLADMATEN[blad.formaat] || BLADMATEN.A4;
        const stroomNr = eersteBlad + i * perBlad + 1;
        const eigenPlaatjes = blad.tekeningen.filter(t => t.soort === 'afbeelding');
        const xobj = eigenPlaatjes.length
            ? ' /XObject << ' + eigenPlaatjes
                .map(t => `/${t.naam} ${plaatjes.find(p => p.t === t).nummer} 0 R`)
                .join(' ') + ' >>'
            : '';
        voegToe(`<< /Type /Page /Parent 2 0 R `
            + `/MediaBox [0 0 ${maat.breedte.toFixed(2)} ${maat.hoogte.toFixed(2)}] `
            + `/Resources << /Font << /F1 ${fontGewoon} 0 R /F2 ${fontVet} 0 R >>`
            + `${xobj} >> /Contents ${stroomNr} 0 R >>`);
        const stroom = stroomVan(blad, maat.hoogte);
        stromen.push(stroom);
        voegToe({ stroom });
    });

    voegToe('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica '
        + '/Encoding /WinAnsiEncoding >>');
    voegToe('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold '
        + '/Encoding /WinAnsiEncoding >>');

    for (const p of plaatjes) {
        voegToe({ plaatje: p.t });
    }

    // --- schrijven ---------------------------------------------------------
    const b = new Bytes();
    b.tekst('%PDF-1.4\n');
    // Een regel met hoge bytes: daarmee weet elk programma dat dit geen
    // tekstbestand is en mag er niets aan de regeleindes gebeuren.
    b.rauw(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    const posities = [];
    objecten.forEach((obj, i) => {
        posities.push(b.lengte);
        const nr = i + 1;
        if (typeof obj === 'string') {
            b.tekst(`${nr} 0 obj\n${obj}\nendobj\n`);
        } else if (obj.stroom !== undefined) {
            // NIET met TextEncoder: die maakt UTF-8, en het lettertype leest
            // WinAnsi. Zie naarWinAnsi hierboven. De /Length hieronder telt de
            // bytes ná het omzetten, dus die blijft vanzelf kloppen.
            const data = naarWinAnsi(obj.stroom);
            b.tekst(`${nr} 0 obj\n<< /Length ${data.length} >>\nstream\n`);
            b.rauw(data);
            b.tekst('\nendstream\nendobj\n');
        } else {
            const t = obj.plaatje;
            b.tekst(`${nr} 0 obj\n<< /Type /XObject /Subtype /Image `
                + `/Width ${t.breedtePx} /Height ${t.hoogtePx} `
                + `/ColorSpace /DeviceRGB /BitsPerComponent 8 `
                + `/Filter /DCTDecode /Length ${t.jpeg.length} >>\nstream\n`);
            b.rauw(t.jpeg);
            b.tekst('\nendstream\nendobj\n');
        }
    });

    const xref = b.lengte;
    b.tekst(`xref\n0 ${objecten.length + 1}\n`);
    b.tekst('0000000000 65535 f \n');
    for (const p of posities) {
        b.tekst(String(p).padStart(10, '0') + ' 00000 n \n');
    }
    b.tekst(`trailer\n<< /Size ${objecten.length + 1} /Root 1 0 R >>\n`
        + `startxref\n${xref}\n%%EOF\n`);

    return b.klaar();
}

/**
 * De JPEG-bytes en de pixelmaten uit een canvas.
 *
 * `toDataURL` geeft base64 terug; die wordt hier naar bytes omgezet, want een
 * PDF wil de ruwe stroom. Kwaliteit 0,92: een aanzicht van een leuning bestaat
 * vooral uit vlakken en lijnen, en daar is JPEG niet sterk in - te laag en de
 * randen worden wazig.
 */
export function jpegVanCanvas(canvas, kwaliteit = 0.92) {
    const url = canvas.toDataURL('image/jpeg', kwaliteit);
    const base64 = url.slice(url.indexOf(',') + 1);
    const binair = atob(base64);
    const bytes = new Uint8Array(binair.length);
    for (let i = 0; i < binair.length; i++) bytes[i] = binair.charCodeAt(i);
    return { jpeg: bytes, breedtePx: canvas.width, hoogtePx: canvas.height };
}
