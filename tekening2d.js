// De werkplaatstekening: geprojecteerde aanzichten op een echte schaal.
//
// WAT DIT ANDERS MAAKT DAN HET PRODUCTIEBLAD. Daar staan vier RENDERS - foto's
// van het 3D-beeld - en daarom staat er "niet op schaal" op. Hier staan
// geprojecteerde lijnen uit projectie.js, en dan mag je met een liniaal meten:
// 10 mm op het papier is bij 1:20 precies 200 mm staal. Daar hoort dan ook een
// schaal op te staan, en geen waarschuwing.
//
// DE SCHAAL IS EEN NORMSCHAAL, geen uitgerekend getal. 1:20 of 1:25, nooit
// 1:17,3. Dat is geen opmaak: een tekenaar meet met een schaalliniaal, en
// daar staan alleen de gewone verhoudingen op. Gekozen wordt de grootste
// schaal waarop alle aanzichten nog passen - groter is leesbaarder.
//
// HET ISOMETRISCHE AANZICHT KRIJGT GEEN SCHAAL. Het is wel een echte
// projectie, dus de lijnen kloppen, maar in zo'n beeld is een lengte alleen
// langs de drie hoofdrichtingen af te lezen en nergens anders. Er een schaal
// bij zetten nodigt uit tot meten waar het niet mag; daarom staat er bij dat
// aanzicht uitdrukkelijk dat je er niet op meet.

import { maakPdf, BLADMATEN, mm } from './pdf.js';
import { RAND, TITELHOOGTE, titelblok, breedteVan, kort } from './bladkader.js';
import { projecteer, vlakVan } from './projectie.js';
import { maatDefinities } from './maatvoering.js';
import { beschrijf } from './onderdelen.js';

/**
 * De aanzichten op de tekening.
 *
 * Dezelfde richtingen als de renders op het productieblad, zodat de twee
 * bladen hetzelfde laten zien en niet elk hun eigen keuze maken.
 */
export const AANZICHTEN_2D = [
    { naam: 'Vooraanzicht',  richting: [0, -1, 0],   meetbaar: true },
    { naam: 'Zijaanzicht',   richting: [1, 0, 0],    meetbaar: true },
    { naam: 'Bovenaanzicht', richting: [0, 0, 1],    meetbaar: true },
    { naam: 'Isometrisch',   richting: [1, -1, 0.8], meetbaar: false },
];

// De gewone schalen van een schaalliniaal. 1:1 tot 1:500 dekt alles van een
// voetplaat tot een balustrade van vijftig meter.
export const SCHALEN = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];

// De lijndikten. Een werkplaatstekening heeft een zichtbare omtrek die
// opvalt en verborgen lijnen die dat niet doen; staan ze even dik, dan moet de
// lezer uitzoeken wat vóór wat zit.
// ZWAARDER DAN EERST. Met 0,35 voor de omtrek en 0,18 voor de rest oogde het
// blad bleek: alles even dun, geen verschil tussen wat vóór staat en wat
// erachter. Een tekening leest op lijndikte. ISO 128 werkt met twee groepen die
// een factor twee schelen; dat is hier aangehouden.
const DIK_ZICHTBAAR = 0.5;
const DIK_VERBORGEN = 0.25;
const DIK_MAAT = 0.22;
const STREEP = [2, 1.5];          // streepje, gat - in mm op het papier
const GRIJS = 0.9;                // de band achter een kopregel

// De maatvoering, alles in mm OP HET PAPIER en niet op het model. Een maatlijn
// hoort op elke schaal even ver van de tekening te staan en even grote pijlen
// te hebben; zou dit in modelmaten staan, dan werden de pijlen op 1:50 vier
// keer zo klein als op 1:10.
const MAAT_WEG = 7;               // afstand van de maatlijn tot de tekening
const MAAT_STAP = 6;              // extra afstand voor een tweede maat ernaast
const MAAT_OVER = 1.5;            // hoever de hulplijn voorbij de maatlijn steekt
const MAAT_GAT = 1;               // gat tussen de tekening en het begin van de hulplijn
const PIJL = 2.2;                 // lengte van een pijlpunt
// 7 punt is 2,47 mm hoog. ISO 3098 houdt 2,5 mm aan als ondergrens voor tekst
// op een tekening; daar zit dit net onder, en 6 punt (2,12 mm) zat er duidelijk
// onder. Lager kan niet zonder dat het op een kopie onleesbaar wordt.
const MAAT_TEKST = 8.5;
// En dezelfde maat in MILLIMETERS. Lettergroottes staan in punten, afstanden
// op het blad in millimeters, en die twee werden hieronder bij elkaar
// opgeteld: 8,5 "mm" ruimte reserveren voor tekst die 3,0 mm hoog is. Dat
// kostte vijf millimeter per maat, en daarmee een heel extra blad.
const MAAT_TEKST_MM = MAAT_TEKST * 25.4 / 72;

/**
 * De kleinste normschaal waarop iets van `nodig` mm model nog past.
 *
 * `nodig` is hoeveel millimeter model er per millimeter papier bij moet. Komt
 * daar 13,2 uit, dan wordt het 1:20 en niet 1:13,2.
 */
export function kiesSchaal(nodig) {
    return SCHALEN.find((s) => s >= nodig) || SCHALEN[SCHALEN.length - 1];
}

/**
 * Bouwt de tekenopdrachten van de werkplaatstekening.
 *
 * @param oc        de OCCT-instantie
 * @param vorm      de TopoDS_Shape van het hele model
 * @param gegevens  {
 *     formaat,     'A3' of 'A4'
 *     titel,       { bedrijf, opdracht, nummer, omschrijving, getekend, datum }
 *     verborgen,   of de lijnen achter het model getekend worden (standaard ja)
 *     bladnummer,  tekst voor in het titelblok
 * }
 * @returns {{ tekeningen: Array, schaal: number, aanzichten: Array }}
 */
export function werkplaatsblad(oc, vorm, gegevens = {}) {
    const formaat = gegevens.formaat === 'A4' ? 'A4' : 'A3';
    const maat = BLADMATEN[formaat];
    const bladB = maat.breedte / mm(1);
    const bladH = maat.hoogte / mm(1);
    const metVerborgen = gegevens.verborgen !== false;
    const metMaten = gegevens.maten !== false;

    const t = [];

    // De maten komen uit maatvoering.js - DEZELFDE bron als de maten in het
    // 3D-beeld. Stonden ze op twee plekken, dan zou het beeld op een dag iets
    // anders zeggen dan het papier. `weg` is hier 0: hoe ver een maatlijn naast
    // de tekening komt is een keuze op het PAPIER, niet op het model, want
    // anders hangt die afstand van de schaal af.
    //
    // ALLEEN MAATLIJNEN. De maatvoering levert bij een trap ook de helling, als
    // los getal zonder begin en eind. Daar viel het hele productiepakket op om
    // - bij ELKE trap - want hier wordt van elke maat de ware lengte gemeten.
    // Een hoek heeft geen lengte; hij staat in het 3D-beeld, niet op dit blad.
    const maten = metMaten
        ? maatDefinities(gegevens.delen || [], ...omvattingVan(oc, vorm), 0)
            .filter(m => m.van && m.naar) : [];
    const gedaan = new Set();

    // Een kader om het blad, zoals op elke werkplaatstekening. Het zegt ook
    // iets: wat erbuiten valt is bij het kopiëren weggevallen.
    t.push({ soort: 'rechthoek', x: 5, y: 5, b: bladB - 10, h: bladH - 10,
             dik: 0.6 });

    // --- 1. alle aanzichten projecteren -----------------------------------
    // Eerst allemaal, want de schaal hangt af van het grootste. Pas daarna kan
    // er iets getekend worden.
    const aanzichten = AANZICHTEN_2D.map((a) => ({
        ...a, ...projecteer(oc, vorm, a.richting),
    }));

    // --- 2. de vakken ------------------------------------------------------
    //
    // NIET VIER GELIJKE VAKKEN. Een balustrade is lang en laag: het
    // vooraanzicht en het bovenaanzicht zijn even breed als het hele ding,
    // terwijl het zijaanzicht maar een paar centimeter breed is. In vier
    // gelijke vakken bepaalt het breedste aanzicht de schaal voor iedereen, en
    // dan staat er een tekening op 1:20 waar 1:10 had gepast - de helft
    // weggegooid. Gemeten op een balustrade van 2,2 m: 1:20 tegenover 1:10.
    //
    // Daarom een brede linkerkolom voor de twee brede aanzichten, en een
    // smalle rechterkolom voor het zijaanzicht en het isometrische beeld.
    const bovenkant = RAND + 8;
    const onderkant = bladH - RAND - TITELHOOGTE - 4;
    const linksB = (bladB - 2 * RAND) * 0.72;
    const rechtsB = (bladB - 2 * RAND) - linksB;
    // DE RIJEN ZIJN NIET GELIJK. Het bovenaanzicht van een balustrade is een
    // streep van vijf millimeter; het vooraanzicht is het echte werk en heeft
    // bovendien ruimte nodig voor de maatlijnen eronder. Gelijke rijen gaven
    // een half leeg vak onderaan en een krap vooraanzicht erboven.
    const rij1H = (onderkant - bovenkant) * 0.62;
    const rij2H = (onderkant - bovenkant) - rij1H;
    const kop = 5.5;                  // ruimte voor de naam boven in het vak
    const marge = 3;
    // Ruimte voor de maatvoering, links en onder de tekening. Dit gaat van de
    // tekenruimte áf vóórdat de schaal gekozen wordt - anders past de tekening
    // wel maar de maten eromheen niet, en daar kom je pas achter op papier.
    const maatRuimte = metMaten ? MAAT_WEG + MAAT_STAP + MAAT_TEKST_MM : 0;
    // En ruimte BOVEN de tekening. De buitenmaten gaan links en onder, maar
    // een maat als "h.o.h." wijst omhoog en komt dus boven het model te staan.
    // Zonder deze marge paste die er met driekwart millimeter speling in -
    // genoeg vandaag, en bij het eerstvolgende model dat iets hoger is loopt
    // hij over de rand van zijn kader.
    const maatBoven = maatRuimte * 0.6;

    const vakVan = (naam) => {
        const p = { Vooraanzicht: [0, 0], Zijaanzicht: [1, 0],
                    Bovenaanzicht: [0, 1], Isometrisch: [1, 1] }[naam] || [0, 0];
        const b = p[0] === 0 ? linksB : rechtsB;
        const h = p[1] === 0 ? rij1H : rij2H;
        return {
            x: RAND + (p[0] === 0 ? 0 : linksB),
            y: bovenkant + (p[1] === 0 ? 0 : rij1H),
            b, h,
            ruimteB: b - 2 * marge - maatRuimte,
            ruimteH: h - kop - marge - maatRuimte - maatBoven,
        };
    };

    // De schaal volgt ALLEEN uit de aanzichten waarop gemeten mag worden. Het
    // isometrische beeld krijgt zijn eigen passende vergroting: daar mag toch
    // niet op gemeten worden, dus zou het zonde zijn als het de schaal van de
    // andere drie omlaag trok.
    const meetbaar = aanzichten.filter((a) => a.meetbaar);
    const nodig = Math.max(...meetbaar.map((a) => {
        const v = vakVan(a.naam);
        return Math.max(a.breedte / v.ruimteB, a.hoogte / v.ruimteH);
    }));
    const schaal = kiesSchaal(nodig);

    // --- 3. tekenen --------------------------------------------------------
    // De plaatsing van het vooraanzicht bepaalt die van de andere twee: het
    // bovenaanzicht staat eronder met dezelfde x, het zijaanzicht ernaast met
    // dezelfde y. Zo lopen de maten van het ene aanzicht door in het andere -
    // dat is wat een stel aanzichten leesbaar maakt in plaats van drie losse
    // plaatjes.
    let voorX = null, voorY = null;

    for (const a of aanzichten) {
        const v = vakVan(a.naam);
        // Alles wat hierna bij dit aanzicht hoort krijgt een etiket met de
        // naam van het vak. Daarmee kan de zelftest per aanzicht nameten dat er
        // niets buiten zijn eigen kader valt - inclusief de maatlijnen, want
        // juist die steken naar buiten.
        const vanaf = t.length;
        const eigen = a.meetbaar ? schaal
            : Math.max(a.breedte / v.ruimteB, a.hoogte / v.ruimteH, 1e-9);

        t.push({ soort: 'rechthoek', x: v.x, y: v.y, b: v.b, h: v.h, dik: 0.25 });
        t.push({ soort: 'tekst', x: v.x + 2, y: v.y + 1.5, tekst: a.naam,
                 grootte: 8, vet: true });
        t.push({ soort: 'tekst', x: v.x + v.b - (a.meetbaar ? 22 : 46),
                 y: v.y + 2, grootte: 6.5,
                 tekst: a.meetbaar ? `schaal 1:${schaal}`
                                   : 'niet opmeten — zie de andere aanzichten' });

        const breedPapier = a.breedte / eigen;
        const hoogPapier = a.hoogte / eigen;
        // De maatruimte links en onder: de tekening schuift naar rechtsboven.
        let x0 = v.x + marge + maatRuimte + (v.ruimteB - breedPapier) / 2;
        let y0 = v.y + kop + marge + maatBoven + (v.ruimteH - hoogPapier) / 2;
        if (a.naam === 'Vooraanzicht') { voorX = x0; voorY = y0; }
        if (a.naam === 'Bovenaanzicht' && voorX !== null) x0 = voorX;
        if (a.naam === 'Zijaanzicht' && voorY !== null) y0 = voorY;

        // Van modelmaten naar bladmaten: delen door de schaal, en de y
        // omklappen - op het blad loopt y naar beneden, in het aanzicht omhoog.
        const punt2D = ([px, py]) => [
            x0 + (px - a.min[0]) / eigen,
            y0 + (a.max[1] - py) / eigen,
        ];
        const naarBlad = (lijn) => lijn.map(punt2D);

        // EERST de verborgen lijnen, dan de zichtbare. Zo tekent een zichtbare
        // lijn over een streepjeslijn heen en niet andersom - anders lijkt een
        // doorgetrokken rand onderbroken.
        if (metVerborgen) {
            for (const lijn of a.verborgen) {
                t.push({ soort: 'polylijn', punten: naarBlad(lijn),
                         dik: DIK_VERBORGEN, streep: STREEP });
            }
        }
        for (const lijn of a.zichtbaar) {
            t.push({ soort: 'polylijn', punten: naarBlad(lijn),
                     dik: DIK_ZICHTBAAR });
        }

        // --- de maten van dit aanzicht -------------------------------------
        // ELKE MAAT STAAT IN PRECIES ÉÉN AANZICHT: in het eerste waar hij op
        // ware lengte valt. Dezelfde maat twee keer op een blad is niet alleen
        // rommelig - gaat er ooit één mee met een wijziging en de ander niet,
        // dan spreekt de tekening zichzelf tegen.
        if (a.meetbaar && maten.length) {
            const vlak = vlakVan(a.richting);
            const midden = [x0 + breedPapier / 2, y0 + hoogPapier / 2];
            let stapel = 0;
            for (const m of maten) {
                if (gedaan.has(m)) continue;
                if (!opWareLengte(m, vlak)) continue;
                gedaan.add(m);
                maatOps(t, m, vlak, punt2D, midden, stapel);
                // Alleen de BUITENmaten gaan naast elkaar liggen; een maat met
                // een eigen tekst (h.o.h., doorgang) hoort bij een plek in de
                // tekening zelf en moet daar blijven staan.
                if (!m.tekst) stapel++;
            }
        }

        for (let i = vanaf; i < t.length; i++) t[i].vak = a.naam;
    }

    // --- 4. het titelblok --------------------------------------------------
    const telling = aanzichten.reduce((n, a) =>
        n + a.zichtbaar.length + (metVerborgen ? a.verborgen.length : 0), 0);
    titelblok(t, gegevens.titel || {}, bladB, bladH,
        `Geprojecteerde aanzichten, schaal 1:${schaal} — maten in mm`
        + (metVerborgen ? '' : '. Verborgen lijnen niet getekend.'),
        gegevens.bladnummer || '');

    return { tekeningen: t, schaal, aanzichten, aantalLijnen: telling, formaat };
}

/** Hetzelfde, maar meteen als PDF-bestand. */
export function maakWerkplaatstekening(oc, vorm, gegevens = {}) {
    const blad = werkplaatsblad(oc, vorm, gegevens);
    return maakPdf([{ formaat: blad.formaat, tekeningen: blad.tekeningen }]);
}

/**
 * De onderdelenbladen: elk uniek onderdeel apart getekend, met zijn eigen maten.
 *
 * WAAROM DIT APART VAN DE SAMENSTELLING STAAT. Op de samenstellingstekening
 * zie je hoe het in elkaar zit, maar niet hoe je één stuk maakt: de spijlen
 * vallen samen, de staander zit achter de handregel, en de maat van één
 * onderdeel is er niet uit te halen. Een werkplaats maakt stuk voor stuk, en
 * dan wil je per stuk een tekening.
 *
 * ELK ONDERDEEL ZIJN EIGEN SCHAAL. Een voetplaat is 150 mm en een handregel
 * 2200; op één schaal is of de plaat een postzegel of past de regel er niet op.
 * De schaal staat daarom per onderdeel erbij, en het is weer een normschaal.
 *
 * TWEE AANZICHTEN PER ONDERDEEL: de brede kant en het kopse eind. Het eerste
 * geeft de lengte en de vorm, het tweede de doorsnede - en juist die is bij een
 * profiel het verschil tussen een koker en een buis.
 *
 * @param oc          de OCCT-instantie
 * @param onderdelen  de unieke productieonderdelen: [{ nummer, aantal, vorm, deel }]
 * @param gegevens    { formaat, titel, voorAantal, naAantal }
 *                    voorAantal/naAantal: hoeveel bladen er in het hele
 *                    document vóór en ná deze komen, voor de nummering.
 * @returns [{ tekeningen }] - één ingang per blad
 */
export function onderdelenbladen(oc, onderdelen, gegevens = {}) {
    const formaat = gegevens.formaat === 'A4' ? 'A4' : 'A3';
    const maat = BLADMATEN[formaat];
    const bladB = maat.breedte / mm(1);
    const bladH = maat.hoogte / mm(1);

    // STROKEN OVER DE VOLLE BREEDTE, geen rooster van gelijke vakken.
    //
    // Eerst stonden hier zes vakjes van gelijke grootte. Dat gaf drie
    // problemen tegelijk: elk vak was half leeg, het zesde vak bleef helemaal
    // leeg bij vijf onderdelen, en de tekening werd klein omdat een smal vak de
    // schaal bepaalde. Een onderdeel van een leuning is lang en dun; dat hoort
    // de volle breedte te krijgen en maar een paar centimeter hoogte.
    //
    // Gemeten op dezelfde balustrade: de voetplaat ging van 1:5 naar 1:1, de
    // staander van 1:20 naar 1:5 en de handregel van 1:50 naar 1:10.
    const links = RAND, breed = bladB - 2 * RAND;
    const bovenkant = RAND + 11;
    const onderkant = bladH - RAND - TITELHOOGTE - 4;

    const bladen = [];
    let t = null, y = 0;
    const nieuwBlad = () => {
        t = [];
        t.push({ soort: 'rechthoek', x: 5, y: 5, b: bladB - 10, h: bladH - 10,
                 dik: 0.6 });
        t.push({ soort: 'tekst', x: RAND, y: RAND, grootte: 10, vet: true,
                 tekst: 'Onderdelen' });
        t.push({ soort: 'tekst', x: RAND + 30, y: RAND + 1, grootte: 7,
                 tekst: 'elk stuk apart, met zijn eigen schaal en maten' });
        y = bovenkant;
    };
    const sluitBlad = () => { bladen.push({ formaat, tekeningen: t }); };

    // EERST ALLES OPMETEN, dan pas indelen. Zo is vooraf bekend hoeveel bladen
    // er nodig zijn, en kunnen de onderdelen daar gelijkmatig over verdeeld
    // worden. Simpelweg vullen tot het vol is gaf vier stuks op blad 1 en één
    // eenzaam stuk op blad 2; dat ziet eruit alsof er iets is overgebleven in
    // plaats van alsof het zo bedoeld is.
    const stroken = onderdelen.map((u) => ({ u, s: meetStrook(oc, u, breed) }));
    let nodigBladen = 1, gebruikt = 0;
    for (const { s } of stroken) {
        if (gebruikt > 0 && gebruikt + s.hoogte > onderkant - bovenkant) {
            nodigBladen++; gebruikt = 0;
        }
        gebruikt += s.hoogte + 3;
    }
    // De onderdelen eerst over de bladen verdelen, dan pas tekenen. Daardoor is
    // per blad bekend hoeveel ruimte er overblijft, en kan die over de tussen-
    // ruimtes verdeeld worden in plaats van onderaan op te hopen. Een blad dat
    // bovenaan vol staat en onderaan leeg is ziet eruit alsof er iets mist.
    //
    // EN NAGEREKEND OF HET PAST. Gelijk verdelen op AANTAL kon drie hoge
    // stroken op één blad zetten, terwijl de telling hierboven op volgorde
    // stapelde. Dan liep het derde onderdeel door het titelblok heen en over
    // de rand van het blad. Past een blad niet, dan komt er een blad bij.
    const ruimte = onderkant - bovenkant;
    let groepen;
    for (;;) {
        const perBlad = Math.ceil(stroken.length / nodigBladen);
        groepen = [];
        for (let i = 0; i < stroken.length; i += perBlad) {
            groepen.push(stroken.slice(i, i + perBlad));
        }
        const past = groepen.every(g =>
            g.reduce((n, x) => n + x.s.hoogte, 0) + 3 * (g.length + 1) <= ruimte);
        if (past || perBlad === 1) break;
        nodigBladen++;
    }

    for (const groep of groepen) {
        nieuwBlad();
        const samen = groep.reduce((n, g) => n + g.s.hoogte, 0);
        const over = (onderkant - bovenkant) - samen;
        // Niet onbeperkt uit elkaar: bij één onderdeel op een blad zou het
        // anders in het midden gaan zweven.
        const gat = Math.max(3, Math.min(15, over / (groep.length + 1)));
        y = bovenkant + gat;
        for (const { u, s } of groep) {
            tekenStrook(t, u, s, { x: links, y, b: breed });
            y += s.hoogte + gat;
        }
        sluitBlad();
    }

    // DE TITELBLOKKEN PAS NU. Hoeveel bladen het worden hangt af van de
    // onderdelen zelf - een plaat vraagt meer hoogte dan een staaf - en dat is
    // vooraf niet te zeggen. Zou de aanroeper het moeten raden, dan stond er
    // "blad 2 van 4" op een pakket van vijf bladen.
    const voor = gegevens.voorAantal || 0;
    const totaal = voor + bladen.length + (gegevens.naAantal || 0);
    bladen.forEach((blad, i) => {
        titelblok(blad.tekeningen, gegevens.titel || {}, bladB, bladH,
            'Onderdeeltekeningen — schaal per onderdeel, maten in mm',
            totaal > 1 ? `blad ${voor + i + 1} van ${totaal}` : '');
    });
    return bladen;
}

const STROOK_KOP = 7;             // hoogte van de grijze kopbalk
// Zo hoog mag de tekening van één stuk worden. Hoger ziet er royaal uit maar
// kost een heel blad aan één voetplaat; lager wordt krap. Op 50 mm komt een
// plaat van 150 x 50 op 1:1 en passen vijf onderdelen op één A3.
const STROOK_MAX = 50;

/**
 * Hoe groot dit onderdeel getekend wordt, en hoe hoog zijn strook daarmee is.
 *
 * DE BREEDTE BEPAALT DE SCHAAL, niet een vast vakje: het stuk krijgt de hele
 * bladbreedte. Alleen als het daarmee hoger zou worden dan STROOK_MAX wordt er
 * een stap teruggeschakeld - anders vult één plaat het halve blad.
 */
function meetStrook(oc, u, breed) {
    const [min, max] = omvattingVan(oc, u.vorm);
    const uit = [0, 1, 2].map((i) => max[i] - min[i]);
    const as = (i) => [0, 1, 2].map((k) => (k === i ? 1 : 0));
    // De langste richting is de lengte, de kortste de dikte. Over die dikte
    // heen kijk je om de brede kant te zien - zoals je een strip op zijn plat
    // legt om hem te tekenen, en niet op zijn kant.
    const lang = uit.indexOf(Math.max(...uit));
    const dun = uit.indexOf(Math.min(...uit));
    const mid = [0, 1, 2].find((i) => i !== lang && i !== dun);

    const maatRuimte = MAAT_WEG + MAAT_TEKST_MM;
    const aanzichten = [
        { naam: '', richting: as(dun), omhoog: as(mid), deel: 0.74 },
        { naam: 'doorsnede', richting: as(lang), omhoog: as(dun), deel: 0.26 },
    ];

    for (const a of aanzichten) {
        a.beeld = projecteer(oc, u.vorm, a.richting, { omhoog: a.omhoog });
        a.ruimteB = breed * a.deel - 4 - maatRuimte;
        // ELK AANZICHT ZIJN EIGEN SCHAAL. Op één schaal is de doorsnede van een
        // koker 40 x 40 bij een handregel van 2200 mm een vierkantje van twee
        // millimeter - en juist die doorsnede is het verschil tussen een koker
        // en een buis.
        //
        // De doorsnede krijgt wel een LAGER plafond dan het hoofdaanzicht. Hij
        // bepaalde anders de hoogte van de hele strook: een staander is een
        // balkje van 8 mm op papier, maar zijn doorsnede van 40 x 40 op 1:1 is
        // 40 mm hoog, en dan is vier vijfde van de strook leeg.
        const plafond = a.naam ? STROOK_MAX * 0.5 : STROOK_MAX;
        a.schaal = kiesSchaal(Math.max(a.beeld.breedte / a.ruimteB,
                                       a.beeld.hoogte / plafond, 1e-9));
    }

    const hoogste = Math.max(...aanzichten.map((a) => a.beeld.hoogte / a.schaal));
    return {
        min, max, aanzichten, maatRuimte,
        beeldH: hoogste,
        hoogte: STROOK_KOP + 5 + hoogste + maatRuimte * 1.5,
    };
}

/** Eén onderdeel als strook: kopbalk, twee aanzichten, maten. */
function tekenStrook(t, u, s, v) {
    const b = beschrijf(u.deel);
    const pos = String(u.nummer).padStart(3, '0');
    const vanaf = t.length;

    // De kopbalk. Een grijze band met het nummer, de naam en het aantal maakt
    // in één oogopslag duidelijk waar een onderdeel begint - met alleen een
    // regel tekst lopen vijf stukken op een blad in elkaar over.
    t.push({ soort: 'rechthoek', x: v.x, y: v.y, b: v.b, h: STROOK_KOP,
             grijs: GRIJS });
    t.push({ soort: 'tekst', x: v.x + 2, y: v.y + 1.2, grootte: 9, vet: true,
             tekst: `${pos}   ${b.soort}` });
    t.push({ soort: 'tekst', x: v.x + 62, y: v.y + 1.6, grootte: 8, vet: true,
             tekst: `${u.aantal}×` });
    const rechts = `${b.profiel} · ${b.materiaal} · ${Math.round(b.lengte)} mm`
        + `${b.afwerking ? ' · ' + b.afwerking : ''}`;
    t.push({ soort: 'tekst', grootte: 7.5, tekst: kort(rechts, v.b - 90, 7.5),
             x: v.x + v.b - 2 - breedteVan(kort(rechts, v.b - 90, 7.5), 7.5),
             y: v.y + 1.8 });

    const maten = maatDefinities([], s.min, s.max, 0);
    const gedaan = new Set();
    const basis = v.y + STROOK_KOP + 5 + s.maatRuimte * 0.5;

    let op = v.x;
    for (const a of s.aanzichten) {
        const vakb = v.b * a.deel;
        const breedP = a.beeld.breedte / a.schaal;
        const hoogP = a.beeld.hoogte / a.schaal;
        // Links uitlijnen in plaats van centreren: dan beginnen alle stukken op
        // dezelfde x en is in één oogopslag te zien welke langer is dan welke.
        const x0 = op + 2 + s.maatRuimte;
        const y0 = basis + (s.beeldH - hoogP) / 2;
        const punt2D = ([px, py]) => [x0 + (px - a.beeld.min[0]) / a.schaal,
                                      y0 + (a.beeld.max[1] - py) / a.schaal];

        // Het schaallabel staat LINKS boven zijn eigen aanzicht, niet rechts:
        // rechts op de kopbalk staat al het profiel, en die twee liepen over
        // elkaar heen zodra een profielnaam wat langer werd.
        const label = (a.naam ? a.naam + ' ' : 'schaal ') + `1:${a.schaal}`;
        t.push({ soort: 'tekst', grootte: 7, tekst: label,
                 x: op + 2 + s.maatRuimte, y: v.y + STROOK_KOP + 0.5 });

        for (const lijn of a.beeld.verborgen) {
            t.push({ soort: 'polylijn', punten: lijn.map(punt2D),
                     dik: DIK_VERBORGEN, streep: STREEP });
        }
        for (const lijn of a.beeld.zichtbaar) {
            t.push({ soort: 'polylijn', punten: lijn.map(punt2D),
                     dik: DIK_ZICHTBAAR });
        }

        const vlak = vlakVan(a.richting, a.omhoog);
        const midden = [x0 + breedP / 2, y0 + hoogP / 2];
        // LIGGENDE EN STAANDE MATEN APART STAPELEN. Ze liggen aan verschillende
        // kanten van de tekening en zitten elkaar dus niet in de weg. Met één
        // teller kwam de lengtemaat een plek verder naar buiten zodra er eerst
        // een staande maat was getekend - en dan viel hij onder de strook uit,
        // in het vak van het volgende onderdeel.
        let liggend = 0, staand = 0;
        for (const m of maten) {
            if (gedaan.has(m) || !opWareLengte(m, vlak)) continue;
            gedaan.add(m);
            const pa = vlak.naar2D(m.van), pb = vlak.naar2D(m.naar);
            const isLiggend = Math.abs(pb[0] - pa[0]) >= Math.abs(pb[1] - pa[1]);
            maatOps(t, m, vlak, punt2D, midden, isLiggend ? liggend++ : staand++);
        }
        op += vakb;
    }

    // Het vak waarbinnen alles van dit onderdeel moet blijven: de hele strook.
    t.splice(vanaf, 0, { soort: 'rechthoek', x: v.x, y: v.y, b: v.b,
                         h: s.hoogte, dik: 0.25 });
    for (let i = vanaf; i < t.length; i++) t[i].vak = 'onderdeel ' + pos;
}

/** De omhullende doos van een vorm, als [min, max] in modelcoördinaten. */
function omvattingVan(oc, vorm) {
    const doos = new oc.Bnd_Box_1();
    try {
        oc.BRepBndLib.Add(vorm, doos, false);
        const a = doos.CornerMin(), b = doos.CornerMax();
        return [[a.X(), a.Y(), a.Z()], [b.X(), b.Y(), b.Z()]];
    } finally {
        doos.delete();
    }
}

// --- maatvoering -----------------------------------------------------------

/**
 * Is deze maat in dit aanzicht op ware lengte te zien?
 *
 * DIT IS DE REGEL DIE ERTOE DOET. Een maat die schuin op het blad valt wordt
 * korter getekend dan hij is. Zet je er dan toch het echte getal bij, dan staat
 * er een maat op de tekening die je met een liniaal niet terugvindt - en dan
 * klopt de schaal die eronder staat niet meer voor dat ene getal. Zo'n maat
 * hoort in een ánder aanzicht, waar hij wél op ware lengte staat.
 *
 * Een duizendste speling, want de projectie rekent met drijvende komma.
 */
function opWareLengte(m, vlak) {
    const l3 = Math.hypot(m.naar[0] - m.van[0], m.naar[1] - m.van[1],
                          m.naar[2] - m.van[2]);
    if (!(l3 > 0)) return false;
    const a = vlak.naar2D(m.van), b = vlak.naar2D(m.naar);
    return Math.hypot(b[0] - a[0], b[1] - a[1]) >= l3 * 0.999;
}

/**
 * Tekent één maatlijn: twee hulplijnen, een maatlijn met pijlpunten, en het
 * getal.
 *
 * `naarBlad` rekent een punt uit het aanzicht om naar het blad; die functie
 * klapt de y om, dus een richting uit het aanzicht moet hier ook omgeklapt
 * worden. Dat is precies het soort ding dat één keer goed moet.
 */
function maatOps(t, m, vlak, naarBlad, midden, stapel) {
    const pa = naarBlad(vlak.naar2D(m.van));
    const pb = naarBlad(vlak.naar2D(m.naar));
    const lengte = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (!(lengte > 0.5)) return;                  // te kort om te tekenen

    const d = [(pb[0] - pa[0]) / lengte, (pb[1] - pa[1]) / lengte];
    let haaks = [-d[1], d[0]];

    // Welke kant de maatlijn op moet. De richting uit de maatdefinitie wijst
    // dat aan - MAAR bij een buitenmaat wijst die vaak langs de kijkrichting,
    // en dan projecteert hij op niets. Dan wordt gekozen: weg van het midden
    // van de tekening, zodat de maat naast het model komt en er niet overheen.
    const r2 = vlak.naar2D(m.richting || [0, 0, 0]);
    const rBlad = [r2[0], -r2[1]];                 // de y van het blad loopt omlaag
    const rLang = Math.hypot(rBlad[0], rBlad[1]);
    const weg = [((pa[0] + pb[0]) / 2) - midden[0], ((pa[1] + pb[1]) / 2) - midden[1]];
    const kiesOp = rLang > 1e-6 ? rBlad : (Math.hypot(...weg) > 1e-6 ? weg : haaks);
    if (haaks[0] * kiesOp[0] + haaks[1] * kiesOp[1] < 0) haaks = [-haaks[0], -haaks[1]];

    const af = MAAT_WEG + stapel * MAAT_STAP;
    const op = (p, n) => [p[0] + haaks[0] * n, p[1] + haaks[1] * n];
    const ma = op(pa, af), mb = op(pb, af);

    // De hulplijnen beginnen NIET op het model zelf: een gat van een millimeter
    // maakt zichtbaar waar de tekening ophoudt en de maatvoering begint.
    t.push({ soort: 'lijn', x1: op(pa, MAAT_GAT)[0], y1: op(pa, MAAT_GAT)[1],
             x2: op(pa, af + MAAT_OVER)[0], y2: op(pa, af + MAAT_OVER)[1],
             dik: DIK_MAAT });
    t.push({ soort: 'lijn', x1: op(pb, MAAT_GAT)[0], y1: op(pb, MAAT_GAT)[1],
             x2: op(pb, af + MAAT_OVER)[0], y2: op(pb, af + MAAT_OVER)[1],
             dik: DIK_MAAT });
    // KRAPPE MAAT: twee pijlpunten van 2,2 mm passen niet in een maatlijn van
    // 4 mm - dan staan ze over elkaar heen en is er niets meer te lezen. De
    // tekenregel daarvoor is: pijlen aan de BUITENkant, naar binnen wijzend, en
    // het getal ernaast in plaats van erboven. De 40 mm van een staander op
    // 1:10 is precies zo'n geval.
    const krap = lengte < 3 * PIJL + 1;
    const uitloop = krap ? PIJL * 2 : 0;
    t.push({ soort: 'lijn', dik: DIK_MAAT,
             x1: ma[0] - d[0] * uitloop, y1: ma[1] - d[1] * uitloop,
             x2: mb[0] + d[0] * uitloop, y2: mb[1] + d[1] * uitloop });

    pijlpunt(t, ma, krap ? [-d[0], -d[1]] : d);
    pijlpunt(t, mb, krap ? d : [-d[0], -d[1]]);

    // Het getal boven de maatlijn, meedraaiend met de maat. Een maat die van
    // rechts naar links loopt zou op zijn kop komen te staan; die wordt
    // omgedraaid, zodat elk getal van linksonder af leesbaar is.
    const tekst = m.tekst || getalTekst(m.waarde);
    let hoek = Math.atan2(-d[1], d[0]) * 180 / Math.PI;
    if (hoek > 90 || hoek <= -90) hoek += 180;
    const rad = hoek * Math.PI / 180;
    const langs = [Math.cos(rad), -Math.sin(rad)];
    const omhoog = [-langs[1], langs[0]];
    const kant = omhoog[0] * haaks[0] + omhoog[1] * haaks[1] > 0 ? -1 : 1;
    const breed = breedteVan(tekst, MAAT_TEKST);
    // Bij een krappe maat naast de maatlijn, voorbij het einde; anders
    // gecentreerd erboven. Welk eind "voorbij" is hangt ervan af welke kant de
    // tekst op staat, anders komt hij bij een omgedraaid getal aan de
    // verkeerde kant uit.
    const eind = langs[0] * d[0] + langs[1] * d[1] >= 0 ? mb : ma;
    const mid = krap
        ? [eind[0] + langs[0] * (uitloop + 1.2), eind[1] + langs[1] * (uitloop + 1.2)]
        : [(ma[0] + mb[0]) / 2 - langs[0] * breed / 2,
           (ma[1] + mb[1]) / 2 - langs[1] * breed / 2];
    const zijkant = krap ? 0.4 : 1.2;
    t.push({ soort: 'tekst', grootte: MAAT_TEKST, tekst, hoek,
             x: mid[0] + omhoog[0] * kant * zijkant,
             y: mid[1] + omhoog[1] * kant * zijkant });
}

/** Een massieve pijlpunt op `p`, wijzend tegen `d` in. */
function pijlpunt(t, p, d) {
    const h = [-d[1] * PIJL * 0.17, d[0] * PIJL * 0.17];
    t.push({ soort: 'polylijn', vul: true, punten: [
        p,
        [p[0] + d[0] * PIJL + h[0], p[1] + d[1] * PIJL + h[1]],
        [p[0] + d[0] * PIJL - h[0], p[1] + d[1] * PIJL - h[1]],
    ] });
}

/**
 * Een maat zoals hij op een tekening hoort: hele millimeters, geen eenheid.
 *
 * GEEN DUIZENDTALSCHEIDING. In het Nederlands is dat een punt, en "2.200" op
 * een werkplaatstekening kan gelezen worden als twee komma twee. Op een
 * tekening staat 2200. De eenheid staat één keer in het titelblok.
 */
function getalTekst(waarde) {
    return String(Math.round(waarde));
}
