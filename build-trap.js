// Bouwt een rechte steektrap met OCCT en levert die op als STEP-bytes.
//
// De trap staat met zijn voet in de oorsprong en loopt omhoog in +X:
//
//                                        ____ bovenvloer (z = hoogte)
//                                  _____|
//                            _____|        <- treden
//                      _____|
//                _____|
//          _____|
//    _____|
//   /                                      <- trapboom, langs de lijn door
//  0                                          de tredeneuzen
//
//   x = 0                    x = aanzet
//
// Net als bij de balustrade is er EEN beschrijving van de onderdelen, waar
// zowel de geometrie als de stuklijst uit komt.
//
// De trapbomen zijn platen die op maat gesneden worden: hun omtrek wordt in het
// XZ-vlak uitgerekend en daarna op vloerpeil afgeknipt, zodat er niets onder de
// vloer uitsteekt. Zo'n plaat is geen balk meer, dus hij wordt gebouwd als
// polygoon -> vlak -> prisma in plaats van als blok.
//
// De STUKLIJST blijft wel de maat van het RUWE materiaal noemen: een plat staal
// van boomdikte x boomhoogte, zo lang als de onafgeknipte boom. Dat is namelijk
// wat je bestelt; de uiteinden zaag je er daarna af.

import { initOcct } from './brep-edges.js';
import { berekenTrap, beoordeelTrap, valideer, controleerBordes,
         ONDERDELEN } from './trap-regels.js';
import { stuklijst, maakDeel, eigenVorm, materialenVan,
         uiterlijkVan, metProfielMaten } from './build-balustrade.js';
import { valideer as valideerLeuning } from './balustrade-rules.js';
import { tredeSoortVan } from './treden.js';
import { isHout, stempelWerk } from './materialen.js';
import { padDelen, profielDoos } from './pad.js';
import { groepeerVormen } from './onderdelen.js';
import { maakBoom } from './samenstelling.js';

/** Een vector om de verticale as draaien; ruis rond nul wordt nul. */
function draaiZ(v, hoek) {
    const c = Math.cos(hoek), s = Math.sin(hoek);
    return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]
        .map(w => (Math.abs(w) < 1e-12 ? 0 : w));
}

/**
 * De onderdelen vanaf index `vanaf` om de verticale as draaien en verschuiven.
 *
 * Zo wordt een vlucht van een kwartslag- of halfslagtrap gebouwd: eerst als
 * rechte vlucht langs +X, precies zoals een rechte trap, en daarna als geheel
 * op zijn plek gezet. De onderdelen zelf veranderen niet - een trede van vlucht
 * 2 is hetzelfde stuk als een trede van vlucht 1 - alleen hun plaatsing.
 *
 * Een plaatboom is getekend als omtrek in het XZ-vlak; die krijgt de draaiing
 * er los bij in `plaatsing`, en maakPlaat en het voorbeeld passen hem toe.
 */
function verplaatsDelen(delen, vanaf, hoek, verschuiving) {
    for (let i = vanaf; i < delen.length; i++) {
        const d = delen[i];
        if (d.omtrek) { d.plaatsing = { hoek, verschuiving }; continue; }
        d.oorsprong = draaiZ(d.oorsprong, hoek).map((c, k) => c + verschuiving[k]);
        d.xAs = draaiZ(d.xAs, hoek);
        d.yAs = draaiZ(d.yAs, hoek);
        d.zAs = draaiZ(d.zAs, hoek);
    }
}

/**
 * Alle onderdelen van een trap, als kale beschrijving in wereldcoordinaten.
 *
 * Trede k loopt van x = (k-1)*aantrede tot k*aantrede, met zijn bovenkant op
 * z = k*optrede. De voorkant van trede 1 ligt dus op x = 0, gelijk met de rand
 * van de benedenvloer.
 */
export function trapDelen(p, balustradeMaten = null, leuning = 'geen') {
    // DE SOORT TRAP. Een wenteltrap is zo anders opgebouwd - spil, taartpunten,
    // een leuning die meedraait - dat hij een eigen functie heeft.
    const soort = p.soort || 'recht';
    if (soort === 'wentel') return wentelDelen(p, balustradeMaten, leuning);

    // Een kwartslag- of halfslagtrap draait OP het bordes, dus hij heeft er
    // altijd een. Niet ingevuld: halverwege. Het bordes is zo diep als de trap
    // breed is - het veld bordeslengte geldt alleen voor een rechte trap.
    const draaiend = soort === 'kwartslag' || soort === 'halfslag';
    if (draaiend) {
        p = { ...p, bordesLengte: p.breedte,
              bordesNa: p.bordesNa > 0 ? p.bordesNa
                  : Math.round(berekenTrap({ hoogte: p.hoogte }).optreden / 2) };
    }
    // HOUTEN TRAPBOMEN: dikke planken waar de treden in een sleuf in liggen.
    // Hun maten komen uit regels.json en niet uit de velden voor een stalen
    // plaat, en een gekozen profiel telt dan niet. Zie controleerHoutBoom.
    const houtBoom = isHout(p.boomMateriaal);
    const HB = ONDERDELEN.houtenBoom;
    if (houtBoom) p = { ...p, boomProfiel: null, boomDikte: HB.dikte, boomHoogte: HB.hoogte };
    const inlaat = houtBoom ? HB.inlaat : 0;

    const t = berekenTrap(p);
    if (draaiend && !t.bordes) {
        throw new Error(`Een ${soort}trap draait op een bordes, en daarvoor is deze `
            + 'trap te laag: er moet aan beide kanten minstens één trede overblijven.');
    }
    // Draaiing: +1 is naar +Y, -1 naar -Y. In deze app is "links" de -Y-kant,
    // net als bij de leuning (zie zijdenVan).
    const draaiKant = p.draai === 'links' ? -1 : 1;

    const halveBreedte = p.breedte / 2;

    // Is er een PROFIEL gekozen voor de trapboom, dan bepaalt dat zijn maten en
    // niet de invulvelden boomhoogte en boomdikte. Een UNP 220 is 80 breed; de
    // vrije ruimte tussen de bomen volgt daaruit, net als bij de staanders van
    // een balustrade.
    const boomDoos = profielDoos(p.boomProfiel);
    const boomDikte = boomDoos ? boomDoos[0] : p.boomDikte;
    const binnen = halveBreedte - boomDikte;     // vrije ruimte tussen de bomen
    const delen = [];

    // Wat er voor de trede gekozen is, en wat dat met zich meebrengt. Een
    // rooster, hout, glas of steen bestel je op maat; dat gaat als eigen post
    // de kostenraming in en niet de zaaglijst. Zie treden.js.
    const tredeMateriaal = p.tredeMateriaal || 'staal';
    const tredeSoort = tredeSoortVan(tredeMateriaal);
    // In een houten boom ligt de trede in een sleuf; dan geen steunhoeken.
    const opHoeken = tredeSoort.opHoeken && !houtBoom;
    const tredeBestel = tredeSoort.besteld ? {
        besteld: true,
        bestelSoort: 'trede:' + (isHout(tredeMateriaal) ? 'hout' : tredeMateriaal),
    } : {};

    // De lijn door de tredeneuzen: een aantrede vooruit per optrede omhoog.
    const schuin = Math.hypot(t.aantrede, t.optrede);
    const langs = [t.aantrede / schuin, 0, t.optrede / schuin];
    const loodrecht = [-langs[2], 0, langs[0]];  // loodrecht erop, omhoog
    const cos = t.aantrede / schuin;

    // --- de losse onderdelen: hoeken, stootborden, voet- en kopplaten -------
    //
    // Maten in regels.json onder trap.onderdelen; daar staat ook waarom.
    const O = ONDERDELEN;
    const platen = Boolean(p.platen);
    // Met voetplaten staat de boom op de plaat en niet op de vloer, dus hij
    // wordt een plaatdikte hoger afgezaagd.
    const zVoet = platen ? O.voetplaat.dikte : 0;
    const hBoom = boomDoos ? boomDoos[1] : p.boomHoogte;

    /**
     * Twee steunhoeken onder een trede of het bordes, tegen de binnenkant van
     * elke boom. De doorsnede is een L: het staande been tegen de boom, het
     * liggende onder de trede. De linker is de rechter, een halve slag om z
     * gedraaid - zo is het hetzelfde stuk staal en herkent de stuklijst dat.
     */
    //
    // `vlakken` zegt tegen welke boomvlakken: [y van het vlak, kant waar de
    // boom zit]. Standaard de twee bomen van een vlucht; onder het bordes van
    // een draaiende trap is het er soms maar één.
    const hoeken = (xVan, xTot, zOnderTrede,
                    vlakken = [[binnen, +1], [-binnen, -1]]) => {
        const { been: a, dikte: s, inspring } = O.tredehoek;
        const doorsnede = [[a - s, 0], [a, 0], [a, a], [0, a], [0, a - s], [a - s, a - s]];
        const gemeen = {
            soort: 'tredehoek', doorsnede,
            dx: xTot - xVan - 2 * inspring, dy: a, dz: a,
            lengteAs: 'x', omschrijving: `L ${a}×${a}×${s}`,
        };
        for (const [y, kant] of vlakken) {
            delen.push(kant > 0
                ? { ...gemeen, oorsprong: [xVan + inspring, y - a, zOnderTrede - a],
                    xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1] }
                : { ...gemeen, oorsprong: [xTot - inspring, y + a, zOnderTrede - a],
                    xAs: [-1, 0, 0], yAs: [0, -1, 0], zAs: [0, 0, 1] });
        }
    };

    /**
     * Een stootbord: de dichte plaat aan de voorkant van een trede, staand op
     * de trede eronder (of de vloer, of het bordes). Zonder overstek sluit hij
     * de voorkant van de trede helemaal af; met overstek stopt hij eronder.
     */
    const stootHout = isHout(tredeMateriaal);
    const stootbord = (xVoor, zVan, zTot) => {
        const dikte = stootHout ? O.stootbord.houtDikte : O.stootbord.dikte;
        delen.push({
            soort: 'stootbord',
            oorsprong: [xVoor - dikte, -binnen, zVan],
            xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
            dx: dikte, dy: 2 * binnen, dz: zTot - zVan,
            lengteAs: 'y',
            // Bij een houten trap van hetzelfde hout, en dan net als de trede
            // op maat besteld. Anders staalplaat.
            materiaal: stootHout ? tredeMateriaal : 'staal',
            ...(stootHout ? { besteld: true, bestelSoort: 'stootbord:hout' } : {}),
        });
    };

    // Het y-bereik van elke boom, buitenkant naar binnenkant.
    const boomY = (zijde) => zijde > 0
        ? [halveBreedte - boomDikte, halveBreedte] : [-halveBreedte, -halveBreedte + boomDikte];

    /**
     * Onder elke boom een voetplaat op de vloer, met twee ankergaten.
     *
     * De plaat steekt alleen naar BUITEN uit, net als de kopplaat. Naar binnen
     * stond hij onder het onderste stootbord: gemeten 18 000 mm3 bij een
     * UNP-boom, die tot voor de eerste trede op de vloer staat.
     */
    const voetplaten = (xVan, xTot) => {
        const { dikte, rand, gat } = O.voetplaat;
        for (const zijde of [+1, -1]) {
            const [y0, y1] = boomY(zijde);
            const breed = y1 - y0;
            const dx = xTot - xVan + 2 * rand, dy = breed + 2 * rand;
            // Het hart van de flap, in de maten van de plaat vanaf zijn hoek.
            const gatY = zijde > 0 ? breed + rand : rand;
            delen.push({
                soort: 'voetplaat',
                oorsprong: [xVan - rand, zijde > 0 ? y0 : y0 - 2 * rand, 0],
                xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
                dx, dy, dz: dikte, profiel: null, lengteAs: 'x',
                gaten: [{ x: dx / 4, y: gatY, diameter: gat },
                        { x: 3 * dx / 4, y: gatY, diameter: gat }],
            });
        }
    };

    /**
     * Tegen de kopse kant van de bovenvloer een kopplaat per boom. De flap met
     * de gaten zit aan de BUITENkant: naar binnen ligt de bovenste trede.
     */
    const kopplaten = (xKop, zVan, zTot) => {
        const { dikte, flap, gat } = O.kopplaat;
        for (const zijde of [+1, -1]) {
            const [y0, y1] = boomY(zijde);
            const yStart = zijde > 0 ? y0 : y0 - flap;
            const dx = y1 - y0 + flap, dy = zTot - zVan;
            const gatX = zijde > 0 ? (y1 - y0) + flap / 2 : flap / 2;
            delen.push({
                soort: 'kopplaat',
                oorsprong: [xKop, yStart, zVan],
                // Breedte langs y, hoogte langs z, dikte langs x.
                xAs: [0, 1, 0], yAs: [0, 0, 1], zAs: [1, 0, 0],
                dx, dy, dz: dikte, profiel: null, lengteAs: 'x',
                gaten: [{ x: gatX, y: dy / 3, diameter: gat },
                        { x: gatX, y: 2 * dy / 3, diameter: gat }],
            });
        }
    };

    /**
     * Eén vlucht: m treden en de twee bomen eronder, vanaf (x0, z0).
     *
     * `bijBordes` zegt aan welke kant van deze vlucht een bordes ligt:
     * 'boven', 'onder' of null. Daar eindigt de boom VERTICAAL, stomp tegen de
     * bordesboom. Haaks op de helling, zoals aan de vloer, stak de onderhoek
     * van vlucht 1 schuin door de bordesboom heen - gemeten 393 423 mm3 - en
     * bleef er onder vlucht 2 een driehoekig gat open.
     */
    const vlucht = (x0, z0, m, bijBordes = null) => {
        const onderVloer = bijBordes !== 'onder';
        const bovenVloer = bijBordes !== 'boven';
        // De treden in het zijaanzicht, als [x van, z van, x tot, z tot]: daar
        // komen bij een houten boom de sleuven.
        const sleuven = [];
        for (let k = 1; k <= m; k++) {
            const xVoor = x0 + (k - 1) * t.aantrede;      // neus zonder overstek
            const zBoven = z0 + k * t.optrede;            // bovenkant trede
            if (opHoeken) {
                hoeken(xVoor, xVoor + t.aantrede, zBoven - p.tredeDikte);
            }
            if (p.stootborden) {
                stootbord(xVoor, z0 + (k - 1) * t.optrede,
                    p.tredeOverstek > 0 ? zBoven - p.tredeDikte : zBoven);
            }
            sleuven.push([xVoor - p.tredeOverstek, zBoven - p.tredeDikte,
                          xVoor + t.aantrede, zBoven]);
            delen.push({
                soort: 'trede',
                oorsprong: [
                    x0 + (k - 1) * t.aantrede - p.tredeOverstek,
                    -binnen - inlaat,
                    z0 + k * t.optrede - p.tredeDikte,
                ],
                xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
                dx: t.aantrede + p.tredeOverstek,
                // In een houten boom aan elke kant een inlaat breder.
                dy: 2 * binnen + 2 * inlaat,
                dz: p.tredeDikte,
                // Een trede is een plank, dus hier mag hout. Zie materialen.js.
                materiaal: tredeMateriaal,
                ...tredeBestel,
            });
        }

        // De boom loopt van de voet van de vlucht tot de overloop erboven.
        const boomLengte = (m * t.aantrede) / cos;
        const bovenVoor = [x0, z0 + t.optrede];
        const bovenAchter = [bovenVoor[0] + langs[0] * boomLengte,
                             bovenVoor[1] + langs[2] * boomLengte];
        const zak = (punt2d) => [punt2d[0] - loodrecht[0] * hBoom,
                                 punt2d[1] - loodrecht[2] * hBoom];

        // Het punt op de onderlijn van de boom recht onder (of boven) x.
        const onderOp = (x) => {
            const a = zak(bovenVoor);
            return [x, a[1] + (x - a[0]) * langs[2] / langs[0]];
        };

        // DE ZIJAANZICHT-OMTREK VAN DE BOOM. Voor een plaat is dit de plaat
        // zelf; voor een profiel de buitenkant ervan, waar de voetplaat onder
        // en de kopplaat tegen moet passen.
        //
        // Met een kopplaat stopt de boom stomp tegen die plaat, een plaatdikte
        // voor de bovenvloer. Haaks op de helling, zoals zonder platen, zou de
        // onderhoek door de kopplaat heen steken.
        const xKop = bovenAchter[0] - (platen && bovenVloer ? O.kopplaat.dikte : 0);

        // EEN PROFIEL LOOPT DOOR TOT DE VLOER. Een plaat is hoog genoeg om de
        // vloer te halen en wordt daar afgeknipt; een UNP 220 begon haaks op
        // de helling bij de eerste neus en hing met zijn laagste hoek 16 mm
        // BOVEN de vloer - nergens op. Daarom loopt hij terug langs de helling
        // tot zijn bovenkant de vloer raakt, en wordt hij daar horizontaal
        // afgezaagd. Zo staat hij met zijn hele doorsnede op de vloer.
        //
        // 20 mm VERDER dan precies tot de vloer. Precies tot de vloer legt de
        // bovenste ribbe van het profiel IN het zaagvlak, en zo'n snede door
        // een ribbe liet OCCT bij een HEA 200 minutenlang rekenen. Een stukje
        // verder snijdt het vlak er schoon doorheen; wat eronder zit gaat eraf.
        const terugVoet = boomDoos && onderVloer
            ? Math.max(0, (bovenVoor[1] - zVoet) / langs[2]) + 20 : 0;
        const beginBoven = [bovenVoor[0] - langs[0] * terugVoet,
                            bovenVoor[1] - langs[2] * terugVoet];
        const beginOnder = bijBordes === 'onder' ? onderOp(bovenVoor[0]) : zak(beginBoven);
        const eindOnder = bijBordes === 'boven' || (platen && bovenVloer)
            ? onderOp(bovenAchter[0]) : zak(bovenAchter);
        let omtrek = knipHalfvlak([beginBoven, bovenAchter, eindOnder, beginOnder],
            1, onderVloer ? zVoet : 0, +1);
        if (platen && bovenVloer) omtrek = knipHalfvlak(omtrek, 0, xKop, -1);

        if (platen && onderVloer) {
            // De voet van de boom: waar hij op de voetplaat staat. Raakt hij
            // de vloer nergens, dan is er ook niets om een plaat onder te
            // zetten - en een plaat van min tot max van niets is oneindig
            // groot, waar OCCT eindeloos op blijft rekenen.
            const opVoet = omtrek.filter(([, z]) => Math.abs(z - zVoet) < 1e-6).map(([x]) => x);
            if (opVoet.length >= 2) voetplaten(Math.min(...opVoet), Math.max(...opVoet));
        }
        if (platen && bovenVloer) kopplaten(xKop, onderOp(xKop)[1], bovenAchter[1]);

        if (boomDoos) {
            // EEN PROFIEL ALS TRAPBOOM, bijvoorbeeld een UNP 220.
            //
            // Dat is een andere constructie dan een plaat. Een plaat wordt uit
            // plaatstaal gesneden en onderaan op de vloer afgeknipt; een UNP is
            // een recht stuk balk dat je op lengte zaagt en waar de treden
            // tussen gelast worden. Geen omtrek dus, maar een balk langs de
            // helling.
            //
            // De OPENING van het profiel wijst naar binnen, naar de andere
            // boom toe: daar komen de treden in. De catalogus legt de rug van
            // een U-profiel aan de +X-kant van de doorsnede en de flenzen naar
            // -X; met lengteAs 'x' wordt die profiel-X onze yAs. De rechter
            // boom kan dus zoals hij is, en de linker wordt een halve slag om
            // zijn lengteas gedraaid - yAs én zAs omgekeerd, zodat het stelsel
            // rechtsdraaiend blijft en het dus hetzelfde onderdeel is.
            const B = boomDoos[0];          // flensbreedte
            const H = boomDoos[1];          // profielhoogte
            // Aan een bordes eindigt ook een profiel verticaal, stomp tegen de
            // bordesboom; zie `bijBordes`. Aan de onderkant van vlucht 2 moet
            // hij daarvoor eerst een stuk terug langs de helling verlengd
            // worden, anders blijft er onder het bordes een gat.
            const terug = bijBordes === 'onder' ? H * t.optrede / t.aantrede : terugVoet;
            const neus = [bovenVoor[0] - langs[0] * terug, 0,
                          bovenVoor[1] - langs[2] * terug];
            const omlaag = [-loodrecht[0] * H, 0, -loodrecht[2] * H];

            for (const zijde of [+1, -1]) {
                const rechts = zijde > 0;
                const oorsprong = [
                    neus[0] + (rechts ? omlaag[0] : 0),
                    rechts ? halveBreedte - B : -halveBreedte + B,
                    neus[2] + (rechts ? omlaag[2] : 0),
                ];
                const yAs = [0, zijde, 0];
                const zAs = rechts ? loodrecht
                                   : [-loodrecht[0], -loodrecht[1], -loodrecht[2]];
                // Een snijvlak door wereldpunt P met normaal n (de kant die
                // eraf gaat), omgezet naar de logische assen van de boom:
                // vanaf zijn oorsprong langs xAs, yAs, zAs.
                const assen = [langs, yAs, zAs];
                const snede = (P, n) => {
                    const q = [P[0] - oorsprong[0], P[1] - oorsprong[1], P[2] - oorsprong[2]];
                    return {
                        punt: assen.map(a => q[0] * a[0] + q[1] * a[1] + q[2] * a[2]),
                        richting: assen.map(a => n[0] * a[0] + n[1] * a[1] + n[2] * a[2]),
                    };
                };
                const verstek = [];
                if (bijBordes === 'boven') verstek.push(snede([bovenAchter[0], 0, 0], [1, 0, 0]));
                if (bijBordes === 'onder') verstek.push(snede([bovenVoor[0], 0, 0], [-1, 0, 0]));
                // OP DE VLOER AFZAGEN. Het profiel is hierboven doorgetrokken
                // tot zijn bovenkant de vloer raakt (zie terugVoet); alles
                // daaronder gaat er horizontaal af. Alleen snijden als er echt
                // iets onder zit.
                const laagste = neus[2] - H * langs[0];
                if (onderVloer && laagste < zVoet - 1e-9) {
                    verstek.push(snede([0, 0, zVoet], [0, 0, -1]));
                }
                if (platen && bovenVloer) verstek.push(snede([xKop, 0, 0], [1, 0, 0]));
                delen.push({
                    soort: 'trapboom',
                    oorsprong,
                    xAs: langs, yAs, zAs,
                    dx: boomLengte + terug, dy: B, dz: H,
                    profiel: p.boomProfiel,
                    lengteAs: 'x',
                    verstek,
                });
            }
            return;
        }

        // Een verticaal begin steekt aan de onderkant een stuk terug langs de
        // helling: zoveel langer is het plat staal dat je bestelt.
        const ruw = boomLengte
            + (bijBordes === 'onder' ? p.boomHoogte * t.optrede / t.aantrede : 0);

        for (const y of [-halveBreedte, halveBreedte - p.boomDikte]) {
            delen.push({
                soort: 'trapboom',
                omtrek, y, dikte: p.boomDikte,
                // Voor de stuklijst: de maat van het ruwe plat staal waar hij
                // uit gezaagd wordt. Dat is wat je bestelt.
                dx: ruw, dy: p.boomDikte, dz: p.boomHoogte,
                ...houtBoomDeel(y, sleuven),
            });
        }
    };

    /**
     * Wat een plaatboom van HOUT extra heeft: zijn houtsoort, dat hij besteld
     * wordt bij de timmerman, en de sleuven waar de treden in liggen. De
     * sleuf zit aan de BINNENkant: bij de linker boom (y = -halve breedte) is
     * dat de kant van zijn grootste y, bij de rechter de kleinste.
     */
    const houtBoomDeel = (y, sleuven) => (houtBoom ? {
        materiaal: p.boomMateriaal, besteld: true, bestelSoort: 'trapboom:hout',
        sleuven, sleufDiepte: inlaat, sleufSpeling: HB.speling,
        sleufBinnen: y < 0 ? 'max' : 'min',
    } : {});

    // De ruimte tussen de twee vluchten van een halfslagtrap. Zie regels.json.
    const oog = O.halfslag.oog;

    /**
     * Het bordes van een kwartslag- of halfslagtrap, en vlucht 2 erachter.
     *
     * Bovenaanzicht bij een draai naar +Y (s = +1); bij -Y spiegelt alles in y.
     *
     *   kwartslag                       halfslag
     *              vlucht 2 ^                  <- vlucht 2
     *               +-------+           +------------------+
     *               |bordes |B          |      bordes      |B
     *   --vlucht 1--+-------+           |                  |
     *               A                   +------------------+
     *                                   --vlucht 1-->      A   C aan de overkant
     *
     * De bordesbomen lopen langs de BUITENranden (A, B en bij een halfslag C)
     * en sluiten stomp op elkaar aan. Waar een vlucht aankomt of vertrekt
     * zitten geen bordesbomen: daar zijn het de trapbomen zelf.
     */
    const draaiBordes = (L1, bZ) => {
        const s = draaiKant, hb = halveBreedte, B = p.breedte, tb = boomDikte;
        const halfslag = soort === 'halfslag';
        // De y van de verste buitenrand, aan de kant waar de trap heen draait.
        const yVer = halfslag ? 3 * hb + oog : hb;
        const yA = -s * (hb - tb);                       // binnenkant strook A
        const yC = s * (halfslag ? yVer - tb : hb);      // overkant van de plank

        delen.push({
            soort: 'bordes',
            oorsprong: [L1, Math.min(yA, yC), bZ - p.tredeDikte],
            xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
            dx: B - tb, dy: Math.abs(yC - yA), dz: p.tredeDikte,
            materiaal: tredeMateriaal,
            ...tredeBestel,
        });
        if (opHoeken) {
            hoeken(L1, L1 + B - tb, bZ - p.tredeDikte,
                halfslag ? [[yA, -s], [yC, s]] : [[yA, -s]]);
        }

        /** Een liggende bordesboom langs een buitenrand, opening naar binnen. */
        const liggend = (start, run, lengte, uit) => {
            const zAs = [run[1] * uit[2] - run[2] * uit[1],
                         run[2] * uit[0] - run[0] * uit[2],
                         run[0] * uit[1] - run[1] * uit[0]];
            delen.push({
                soort: 'bordesboom',
                // Wijst zAs omlaag, dan begint het doosje bovenaan.
                oorsprong: [start[0], start[1], zAs[2] < 0 ? bZ : bZ - hBoom],
                xAs: run, yAs: uit, zAs,
                dx: lengte, dy: tb, dz: hBoom, lengteAs: 'x',
                ...(boomDoos ? { profiel: p.boomProfiel } : {}),
            });
        };
        liggend([L1, yA], [1, 0, 0], B, [0, -s, 0]);
        liggend([L1 + B - tb, yA], [0, s, 0], Math.abs(yC - yA), [1, 0, 0]);
        if (halfslag) liggend([L1, yC], [1, 0, 0], B, [0, s, 0]);

        // Vlucht 2: als rechte vlucht gebouwd, dan op zijn plek gedraaid.
        const begin = delen.length;
        vlucht(0, bZ, t.vluchten[1].treden, 'onder');
        if (halfslag) verplaatsDelen(delen, begin, Math.PI, [L1, s * (B + oog), 0]);
        else verplaatsDelen(delen, begin, s * Math.PI / 2, [L1 + hb, s * hb, 0]);
    };

    if (!t.bordes) {
        vlucht(0, 0, t.treden);
    } else {
        // Vlucht 1, dan het bordes, dan vlucht 2. Het bordes neemt de plek in
        // van een trede, maar is langer.
        const eerste = t.vluchten[0].treden;
        vlucht(0, 0, eerste, 'boven');

        const bordesX = eerste * t.aantrede;
        const bordesZ = t.bordes.hoogte;

        // Het stootbord voor het bordes: van de bovenste trede van vlucht 1 tot
        // de bovenkant van het bordes. Het bordes steekt nergens over.
        if (p.stootborden) stootbord(bordesX, eerste * t.optrede, bordesZ);

        if (draaiend) {
            draaiBordes(bordesX, bordesZ);
        } else {
            delen.push({
                soort: 'bordes',
                oorsprong: [bordesX, -binnen - inlaat, bordesZ - p.tredeDikte],
                xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
                dx: t.bordes.lengte, dy: 2 * binnen + 2 * inlaat, dz: p.tredeDikte,
                // Het bordes is net zo goed een plank als een trede, en je
                // maakt hem van hetzelfde materiaal - anders staat er een
                // stalen vlak midden in een houten trap.
                materiaal: tredeMateriaal,
                ...tredeBestel,
            });
            if (opHoeken) {
                hoeken(bordesX, bordesX + t.bordes.lengte, bordesZ - p.tredeDikte);
            }

            // Zijplaten onder het bordes, die de twee vluchten met elkaar
            // verbinden.
            //
            // Is de boom een PROFIEL, dan is de bordesboom datzelfde profiel,
            // liggend, met de opening naar binnen en zijn bovenkant op
            // bordespeil. Een plaat tussen twee U-profielen sloot nergens op
            // aan en stak er dwars doorheen.
            if (boomDoos) {
                const [B, H] = boomDoos;
                for (const zijde of [+1, -1]) {
                    const rechts = zijde > 0;
                    delen.push({
                        soort: 'bordesboom',
                        oorsprong: [bordesX, rechts ? halveBreedte - B : -halveBreedte + B,
                                    rechts ? bordesZ - H : bordesZ],
                        xAs: [1, 0, 0], yAs: [0, zijde, 0], zAs: [0, 0, zijde],
                        dx: t.bordes.lengte, dy: B, dz: H,
                        profiel: p.boomProfiel,
                        lengteAs: 'x',
                    });
                }
            }
            for (const y of boomDoos ? [] : [-halveBreedte, halveBreedte - p.boomDikte]) {
                if (houtBoom) {
                    // Hout: een plank met een sleuf over de hele lengte, waar
                    // het bordes in ligt. Als plaat met een omtrek, zodat de
                    // sleuf er net zo in komt als bij de trapbomen.
                    const [xa, xb] = [bordesX, bordesX + t.bordes.lengte];
                    delen.push({
                        soort: 'bordesboom',
                        omtrek: [[xa, bordesZ - p.boomHoogte], [xb, bordesZ - p.boomHoogte],
                                 [xb, bordesZ], [xa, bordesZ]],
                        y, dikte: p.boomDikte,
                        dx: t.bordes.lengte, dy: p.boomDikte, dz: p.boomHoogte,
                        ...houtBoomDeel(y, [[xa, bordesZ - p.tredeDikte, xb, bordesZ]]),
                    });
                    continue;
                }
                delen.push({
                    soort: 'bordesboom',
                    oorsprong: [bordesX, y, bordesZ - p.boomHoogte],
                    xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
                    dx: t.bordes.lengte, dy: p.boomDikte, dz: p.boomHoogte,
                });
            }

            vlucht(bordesX + t.bordes.lengte, bordesZ, t.vluchten[1].treden, 'onder');
        }
    }

    // --- leuning(en) ---
    // Bij een trap weten we precies waar de buitenkant zit, dus hier hoeft
    // niemand te raden welke kant op geschoven moet worden. De staander komt
    // strak tegen de buitenkant van de trapboom.
    //
    // GEEN voetplaten op een trap. Die horen onder een staander die op een
    // vlakke vloer wordt vastgebout; hier staat de staander op een SCHUINE
    // trapboom en wordt hij eraan gelast. Een horizontale plaat zou daar half
    // door de boom heen steken.
    //
    // DE MATEN VAN DE GEKOZEN PROFIELEN, net als bouwPad dat doet. Zonder dit
    // rekende de trapleuning met de spijlbreedte uit het invulveld terwijl er
    // een ander profiel gebouwd werd, en klopte de doorgang niet meer.
    const leuningMaten = balustradeMaten
        ? metProfielMaten({ ...balustradeMaten, voetplaatDikte: 0 }) : null;

    // De VERBINDINGEN van de leuning gaan mee. Die werden hier weggegooid -
    // alleen `.delen` werd overgenomen - en daardoor kon de technische keuring
    // een trapleuning helemaal niet nakijken: zonder verbindingen weet ze niet
    // welke delen bij elkaar horen. Een trap is juist het geval waar het
    // misgaat, want daar ligt alles schuin.
    //
    // De nummers verschuiven: padDelen telt vanaf 0 binnen zijn eigen lijst, en
    // hier komt de leuning ACHTER de trap. Zonder die verschuiving zouden de
    // verbindingen naar treden en trapbomen wijzen.
    // DE ECHTE BREEDTE VAN DE STAANDER, niet het invulveld.
    //
    // Hier stond `leuningMaten.staanderBreedte / 2`, en dat is de waarde uit
    // het paneel. Kies je een PROFIEL, dan is de staander zo breed als dat
    // profiel en niet zo breed als het veld: een CHS 48,3 bij een ingevulde
    // 40 is 4,15 mm breder, en met zijn hart op halveBreedte + 20 dook hij met
    // 4,15 mm in de zijkant van de trapboom. Gemeten: 136 mm3 per staander,
    // 818 mm3 over de hele trap, en de stuklijst telde dat staal dubbel.
    //
    // pad.js:526 doet precies dit al voor een balustrade; de trap deed het
    // niet mee. Zelfde helper, zelfde regel.
    const stDoos = leuningMaten && profielDoos(leuningMaten.staanderProfiel);
    const stBreedte = stDoos ? Math.max(stDoos[0], stDoos[1])
        : (leuningMaten && leuningMaten.staanderBreedte);

    /**
     * De leuningpaden van een kwartslag- of halfslagtrap aan kant `zijde`.
     *
     * BUITEN loopt de leuning in één stuk om het bordes heen: omhoog langs
     * vlucht 1, vlak langs de buitenranden van het bordes, en weer omhoog
     * langs vlucht 2. Hij begint pas te stijgen waar de neuzenlijn van vlucht 2
     * het bordespeil snijdt, één aantrede voor de eerste trede - zie
     * leuningPad.
     *
     * BINNEN verschilt het. Bij een kwartslag komen vlucht 1 en 2 samen in de
     * binnenhoek op verschillende hoogtes; daar kan één pad niet doorlopen
     * zonder een verticale sprong. Het zijn dus twee leuningen, waarvan de
     * eindstaanders tegen elkaar in de hoek staan. Bij een halfslag maakt de
     * leuning een korte bocht om het oog, over het bordes.
     */
    const draaiPaden = (zijde) => {
        const s = draaiKant, hb = halveBreedte, off = stBreedte / 2;
        const a = t.aantrede, opt = t.optrede, tan = opt / a;
        const L1 = t.vluchten[0].treden * a, L2 = t.vluchten[1].treden * a;
        const bZ = t.bordes.hoogte, H = p.hoogte, xo = L1 + p.breedte + off;
        if (zijde !== s) {
            const yo = -s * (hb + off);
            if (soort === 'kwartslag') {
                return [[[0, yo, opt], [L1, yo, bZ], [xo, yo, bZ],
                         [xo, s * (hb - a), bZ], [xo, s * (hb + L2), H]]];
            }
            const yc = s * (3 * hb + oog + off);
            return [[[0, yo, opt], [L1, yo, bZ], [xo, yo, bZ], [xo, yc, bZ],
                     [L1 + a, yc, bZ], [L1 - L2, yc, H]]];
        }
        const yi = s * (hb + off);
        if (soort === 'kwartslag') {
            const xi = L1 - off;
            return [
                [[0, yi, opt], [xi, yi, bZ - off * tan]],
                [[xi, s * (hb + off + stBreedte), bZ + opt + (off + stBreedte) * tan],
                 [xi, s * (hb + L2), H]],
            ];
        }
        const yi2 = s * (hb + oog - off);
        return [[[0, yi, opt], [L1, yi, bZ], [L1 + a, yi, bZ], [L1 + a, yi2, bZ],
                 [L1 - L2, yi2, H]]];
    };

    const verbindingen = [];
    for (const zijde of zijdenVan(leuning)) {
        if (!leuningMaten) break;
        const paden = draaiend ? draaiPaden(zijde)
            : [leuningPad(t, p, zijde * (halveBreedte + stBreedte / 2))];
        for (const pad of paden) {
            const leuningDeel = padDelen(pad, false, leuningMaten);
            const verschuiving = delen.length;
            delen.push(...leuningDeel.delen);
            for (const v of leuningDeel.verbindingen) {
                verbindingen.push({ ...v, a: v.a + verschuiving, b: v.b + verschuiving });
            }
        }
    }

    // --- wandleuning --------------------------------------------------------
    const wandFout = wandleuningFout(p.wandleuning, leuning, soort);
    if (wandFout) throw new Error(wandFout);
    const wandZijde = { links: -1, rechts: 1 }[p.wandleuning];
    if (wandZijde) {
        // Met voet- en kopplaten steken die aan de buitenkant uit; de muur
        // staat dan zoveel verder weg, anders zat de flap in de muur.
        const speling = platen ? Math.max(2 * O.voetplaat.rand, O.kopplaat.flap) : 0;
        wandleuningDelen(delen, t, p, wandZijde * (halveBreedte + speling), wandZijde);
    }

    // Zie padDelen: de afwerking geldt voor het hele werk, dus ook voor de
    // leuning die hierboven uit padDelen kwam.
    stempelWerk(delen, p);

    return { delen, verbindingen, trap: t, opmerkingen: beoordeelTrap(t) };
}

// --- wenteltrap ------------------------------------------------------------

/**
 * De meetkunde van een wenteltrap, zonder onderdelen: hoe ver elke trede
 * draait en hoeveel hoofdruimte er na een volle slag overblijft.
 *
 * De AANTREDE wordt gemeten op de looplijn, halverwege tussen spil en
 * buitenrand - daar loop je. Daar moet hij dezelfde loopregel halen als bij een
 * rechte trap, dus de draaihoek per trede volgt eruit: aantrede / straal.
 * Vlak bij de spil is een trede smaller, aan de buitenkant breder; dat is wat
 * een wenteltrap is.
 *
 * DOORLOOPHOOGTE: na een volle slag zit je onder de trede die je net
 * gepasseerd bent. Hoeveel ruimte daar is volgt uit hoeveel treden er in een
 * slag passen - een kleinere diameter is een krappere slag en dus minder
 * hoofdruimte. Zie regels.json, trap.onderdelen.wentel.
 */
export function wentelMaten(p) {
    const W = ONDERDELEN.wentel;
    const t = berekenTrap({ hoogte: p.hoogte });
    const Ro = p.diameter / 2, Rs = W.spilDiameter / 2;
    const rLoop = (Rs + Ro) / 2;
    const hoek = t.aantrede / rLoop;                       // radialen per trede
    const perSlag = 2 * Math.PI / hoek;
    const doorloop = perSlag * t.optrede - (p.tredeDikte || 0);
    return { t, Ro, Rs, rLoop, hoek, perSlag, doorloop,
             draaiing: hoek * t.treden * 180 / Math.PI };
}

/** Fouten in een wenteltrap, als lijst meldingen; leeg is goed. */
/**
 * Kan deze trap houten bomen krijgen? Zie regels.json onder _houtenBoom.
 */
export function controleerHoutBoom(p) {
    if (!isHout(p.boomMateriaal)) return [];
    const fouten = [];
    if ((p.soort || 'recht') !== 'recht') {
        fouten.push('Houten trapbomen kan de app nu alleen bij een rechte trap maken, '
            + 'met of zonder bordes. Kies een stalen boom of een rechte trap.');
    }
    if (p.platen) {
        fouten.push('Voet- en kopplaten zijn er voor stalen trapbomen. Zet ze uit bij '
            + 'een houten boom.');
    }
    return fouten;
}

export function controleerWentel(p) {
    if (p.soort !== 'wentel') return [];
    const W = ONDERDELEN.wentel;
    const m = wentelMaten(p);
    // ALLEEN ALS ER EEN TREDE BOVEN EEN ANDERE KOMT. Een trap van een meter
    // draait 124 graden en loopt nergens onder zichzelf door; die werd hier
    // geweigerd om een hoofdruimte die er niet toe doet.
    const draaitRond = m.t.treden * m.hoek > 2 * Math.PI;
    if (draaitRond && m.doorloop < W.minDoorloop) {
        return [`Doorloophoogte ${Math.round(m.doorloop)} mm, minder dan ${W.minDoorloop}: `
            + 'na een volle slag stoot je je hoofd. Maak de diameter groter.'];
    }
    return [];
}

/**
 * De onderdelen van een wenteltrap: spil, taartpunttreden en een leuning
 * langs de buitenrand.
 *
 * Trede k draait van (k-1) x hoek tot k x hoek en ligt met zijn bovenkant op
 * k x optrede, net als bij een rechte trap. De bovenste stap is de vloer.
 *
 * ALLE TREDEN ZIJN HETZELFDE STUK. De doorsnede wordt in een vaste stand
 * getekend (van 0 tot één tredehoek) en elke trede wordt daarna gedraaid
 * geplaatst. Zo herkent de stuklijst er één onderdeel in, maal het aantal.
 */
function wentelDelen(p, balustradeMaten, leuning) {
    const W = ONDERDELEN.wentel;
    const m = wentelMaten(p);
    const { t, Ro, Rs, hoek } = m;
    const s = p.draai === 'links' ? -1 : 1;          // +1 linksom (naar +Y)
    const delen = [];
    const opmerkingen = [...beoordeelTrap(t)];

    // De spil: een holle buis van vloer tot vloer.
    delen.push({
        soort: 'spil', buis: { wand: W.spilWand }, rond: true,
        oorsprong: [-Rs, -Rs, 0], xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
        dx: 2 * Rs, dy: 2 * Rs, dz: p.hoogte, lengteAs: 'z',
        omschrijving: `Ø ${W.spilDiameter}×${W.spilWand}`,
    });

    // De taartpunt in vaste stand, in het grondvlak. De binnenrand staat een
    // haar van de spil af: een koorde van een cirkel ligt BINNEN die cirkel, en
    // zonder deze marge stak elke trede een paar tiende mm in de spil.
    const N = 8;
    const rBinnen = Rs / Math.cos(hoek / 8) + 1;
    const punt = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    const vorm = [
        ...Array.from({ length: 5 }, (_, i) => punt(rBinnen, s * hoek * i / 4)),
        ...Array.from({ length: N + 1 }, (_, i) => punt(Ro, s * hoek * (N - i) / N)),
    ];
    const xMin = Math.min(...vorm.map(q => q[0])), yMin = Math.min(...vorm.map(q => q[1]));
    const doorsnede = vorm.map(([x, y]) => [x - xMin, y - yMin]);
    const breed = Math.max(...doorsnede.map(q => q[0]));
    const diep = Math.max(...doorsnede.map(q => q[1]));

    const tredeMateriaal = p.tredeMateriaal || 'staal';
    const tredeSoort = tredeSoortVan(tredeMateriaal);
    const tredeBestel = tredeSoort.besteld ? {
        besteld: true,
        bestelSoort: 'trede:' + (isHout(tredeMateriaal) ? 'hout' : tredeMateriaal),
    } : {};

    for (let k = 1; k <= t.treden; k++) {
        const a0 = s * hoek * (k - 1);
        const hoekpunt = draaiZ([xMin, yMin, 0], a0);
        delen.push({
            soort: 'trede', doorsnede,
            // Lokaal: x omhoog (de dikte), y en z liggen in het grondvlak.
            oorsprong: [hoekpunt[0], hoekpunt[1], k * t.optrede - p.tredeDikte],
            xAs: [0, 0, 1], yAs: draaiZ([1, 0, 0], a0), zAs: draaiZ([0, 1, 0], a0),
            dx: p.tredeDikte, dy: breed, dz: diep, lengteAs: 'y',
            // Een plaat die gesneden wordt: DXF van de taartpunt, geen zaaghoeken.
            plaat: true,
            omschrijving: `taartpunt R${Math.round(Ro)}, ${(hoek * 180 / Math.PI).toFixed(1)}°`,
            materiaal: tredeMateriaal,
            ...tredeBestel,
        });
    }

    // Wat een wenteltrap (nog) niet heeft, zeggen in plaats van stil weglaten.
    const nietHier = [p.stootborden && 'stootborden', p.platen && 'voet- en kopplaten',
                      tredeSoort.opHoeken && 'steunhoeken'].filter(Boolean);
    if (nietHier.length) {
        opmerkingen.push(`Bij een wenteltrap zijn ${nietHier.join(', ')} nog niet `
            + 'beschikbaar; de treden zitten aan de spil.');
    }

    // --- de leuning langs de buitenrand -------------------------------------
    //
    // Spijlen op elke trede, zoveel dat de vrije ruimte ertussen onder de
    // maximale doorgang blijft, en een ronde handregel die in korte rechte
    // stukken met verstek meedraait. Aan welke kant je "links" of "rechts"
    // kiest maakt hier niet uit: de binnenkant is de spil.
    if (leuning !== 'geen' && balustradeMaten) {
        const L = metProfielMaten({ ...balustradeMaten, voetplaatDikte: 0 });
        const spijl = L.spijlBreedte, regelD = L.handregelHoogte;
        const Rr = Ro - spijl / 2 - W.leuningInspring;
        const boog = hoek * Rr;
        const perTrede = Math.max(1, Math.ceil(boog / (L.maxDoorgang + spijl)));
        // Hoe schuin de regel ligt, op de straal van de leuning.
        const cosRegel = boog / Math.hypot(boog, t.optrede);
        // Het hart van de regel boven tredevoortgang u (0 = eerste neus).
        const hart = (u) => t.optrede * (1 + u) + L.hoogte - regelD / 2;

        const punten = [];
        for (let i = 0; i <= 2 * t.treden; i++) {
            const u = i / 2;
            const [x, y] = punt(Rr, s * hoek * u);
            punten.push([x, y, hart(u)]);
        }
        rondeRegel(delen, punten, regelD, 'handregel');

        for (let k = 1; k <= t.treden; k++) {
            for (let j = 0; j < perTrede; j++) {
                const u = k - 1 + (j + 0.5) / perTrede;
                const [x, y] = punt(Rr, s * hoek * u);
                // Tot de onderkant van de regel, aan de lage kant van de spijl:
                // de regel loopt erboven schuin op.
                // Een halve millimeter speling: de regel bestaat uit rechte
                // stukken, en een koorde ligt net iets anders dan de boog.
                const du = (spijl / 2) / boog;
                const top = hart(u - du) - (regelD / 2) / cosRegel - 0.5;
                const voet = k * t.optrede;
                delen.push({
                    soort: 'spijl', rond: true,
                    oorsprong: [x - spijl / 2, y - spijl / 2, voet],
                    xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
                    dx: spijl, dy: spijl, dz: top - voet, lengteAs: 'z',
                    omschrijving: `Ø ${spijl}`,
                });
            }
        }
    }

    stempelWerk(delen, p);
    return {
        delen, verbindingen: [], opmerkingen,
        trap: { ...t, aanzet: 2 * Ro, wentel: m },
    };
}

const min3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const een3 = (v) => { const l = Math.hypot(...v); return v.map(c => c / l); };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const kruis3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                          a[0] * b[1] - a[1] * b[0]];

/**
 * Een ronde regel langs een reeks punten (het hart van de regel), in rechte
 * stukken met een verstek op de deellijn in elke knik.
 *
 * Elk stuk loopt in een knik een diameter door; het verstek haalt dat weer
 * weg. Zonder verstek zaten twee cilinders in elke knik in elkaar - staal op
 * twee plekken. De richting mag alle kanten op: een wandleuning ligt in een
 * verticaal vlak, de handregel van een wenteltrap draait mee.
 *
 * @returns de richting van elk stuk, voor wie er iets onder wil hangen
 */
function rondeRegel(delen, punten, diameter, soort) {
    const R = diameter / 2;
    const richtingen = punten.slice(1).map((q, i) => een3(min3(q, punten[i])));

    for (let i = 0; i < richtingen.length; i++) {
        const d = richtingen[i];
        const vorige = richtingen[i - 1], volgende = richtingen[i + 1];
        const voor = vorige ? diameter : 0;
        const na = volgende ? diameter : 0;
        const lengte = Math.hypot(...min3(punten[i + 1], punten[i]));
        const begin = punten[i].map((c, k) => c - d[k] * voor);

        // Rechtsdraaiend stelsel met de lengte langs zAs: xAs horizontaal
        // haaks op de regel, yAs = zAs x xAs ligt dan in het verticale vlak.
        const xAs = een3([-d[1], d[0], 0]);
        const yAs = kruis3(d, xAs);
        const oorsprong = begin.map((c, k) => c - xAs[k] * R - yAs[k] * R);
        const assen = [xAs, yAs, d];
        const snede = (P, n) => {
            const q = min3(P, oorsprong);
            return { punt: assen.map(a => dot3(q, a)), richting: assen.map(a => dot3(n, a)) };
        };
        const verstek = [];
        if (vorige) verstek.push(snede(punten[i], een3(vorige.map((c, k) => -(c + d[k])))));
        if (volgende) verstek.push(snede(punten[i + 1], een3(d.map((c, k) => c + volgende[k]))));

        delen.push({
            soort, oorsprong, xAs, yAs, zAs: d,
            dx: diameter, dy: diameter, dz: lengte + voor + na,
            lengteAs: 'z', rond: true, verstek,
            // Wat er gezaagd wordt is het stuk tussen de knikken, niet de
            // verlenging die het verstek eraf haalt.
            zaaglengte: lengte,
            omschrijving: `Ø ${diameter}`,
        });
    }
    return richtingen;
}

/**
 * Kan de wandleuning aan die kant? Geeft een melding of null.
 *
 * Aan de kant van een leuning staat geen muur - dan hing er een regel op
 * muurhouders in de lucht naast de balustrade. Apart zodat het paneel het al
 * kan zeggen terwijl je kiest, en niet pas bij het bouwen.
 */
export function wandleuningFout(wand, leuning, soort = 'recht') {
    const zijde = { links: -1, rechts: 1 }[wand];
    if (!zijde) return null;
    if (soort !== 'recht') {
        return 'Een wandleuning kan nu alleen bij een rechte trap. Zet hem op '
            + '"geen", of kies een leuning.';
    }
    if (zijdenVan(leuning).includes(zijde)) {
        return `Aan de ${wand}kant staat al een leuning. Een wandleuning hoort `
            + 'aan de kant van de muur; kies de andere kant of haal de leuning daar weg.';
    }
    return null;
}

/**
 * Een ronde regel op muurhouders langs de muur aan kant `zijde`.
 *
 * De regel volgt de lijn door de tredeneuzen, net als de leuning, op
 * `hoogte` erboven. Bij een bordes knikt hij twee keer; daar krijgen de stukken
 * een verstek op de deellijn, anders zat er in elke knik staal op twee plekken.
 *
 * Elke muurhouder is een rozet tegen de muur en een arm eronder. De arm stopt
 * op de onderkant van de regel aan de lage kant, zodat hij er nergens in steekt.
 *
 * @param muurY  y van het muurvlak
 * @param zijde  -1 als de muur links staat, +1 rechts; de regel ligt ervan af
 */
function wandleuningDelen(delen, t, p, muurY, zijde) {
    const W = ONDERDELEN.wandleuning;
    const R = W.diameter / 2;
    const regelY = muurY - zijde * (W.afstand + R);
    // Het hart van de regel, op het pad van de leuning. `hoogte` loopt tot de
    // bovenkant, dus het hart ligt een straal lager.
    const punten = leuningPad(t, p, regelY).map(([x, y, z]) => [x, y, z + W.hoogte - R]);

    const richtingen = rondeRegel(delen, punten, W.diameter, 'wandleuning');

    // De hoogte van het hart van de regel boven x, en hoe schuin hij daar ligt.
    const regelOp = (x) => {
        for (let i = 0; i < richtingen.length; i++) {
            const a = punten[i], b = punten[i + 1];
            if (x <= b[0] + 1e-9 || i === richtingen.length - 1) {
                const f = (x - a[0]) / (b[0] - a[0]);
                return { z: a[2] + f * (b[2] - a[2]), cos: richtingen[i][0] };
            }
        }
        return null;
    };
    const onderkant = (x) => { const r = regelOp(x); return r.z - R / r.cos; };

    // De houders: gelijk verdeeld, een stuk van de einden af.
    const xBegin = punten[0][0] + 150;
    const xEind = punten[punten.length - 1][0] - 150;
    const aantal = Math.max(2, Math.ceil((xEind - xBegin) / W.houderAfstand) + 1);
    const rozetY = muurY - zijde * W.rozetDikte;
    for (let j = 0; j < aantal; j++) {
        const x = xBegin + (xEind - xBegin) * j / (aantal - 1);
        const armBoven = Math.min(onderkant(x - W.arm / 2), onderkant(x + W.arm / 2));
        const zArm = armBoven - W.arm / 2;
        delen.push({
            soort: 'muurhouder',
            oorsprong: [x - W.arm / 2, Math.min(rozetY, regelY), armBoven - W.arm],
            xAs: [1, 0, 0], yAs: [0, 1, 0], zAs: [0, 0, 1],
            dx: W.arm, dy: Math.abs(regelY - rozetY), dz: W.arm,
            lengteAs: 'y',
        });
        // De rozet: een schijf tegen de muur, met zijn as van de muur af.
        const r = W.rozet / 2;
        delen.push({
            soort: 'rozet',
            oorsprong: [x - r, muurY, zArm - zijde * r],
            xAs: [1, 0, 0], yAs: [0, 0, zijde], zAs: [0, -zijde, 0],
            dx: W.rozet, dy: W.rozet, dz: W.rozetDikte,
            lengteAs: 'z', rond: true,
        });
    }
}

/**
 * Het pad waarover de leuning loopt: de lijn door de tredeneuzen.
 *
 * Zonder bordes is dat één rechte schuine lijn, van de eerste neus tot de
 * bovenvloer.
 *
 * Mét bordes zijn het drie stukken: omhoog, vlak over het bordes, en weer
 * omhoog. Het vlakke stuk eindigt één AANTREDE vóór het einde van het bordes:
 *
 *                                      ____/
 *                          ___________/
 *                    _____/            ^
 *                   /                  hier begint de tweede vlucht al te
 *                  /                   stijgen, nog boven het bordes
 *
 * Dat is geen slordigheid maar meetkunde: de neuzenlijn van de tweede vlucht
 * snijdt het bordespeil precies één aantrede voor de eerste trede. Zou je de
 * leuning pas aan het eind van het bordes laten stijgen, dan werd dat stuk
 * steiler dan de trap eronder - bij een trap van 3 meter zo'n 4 graden.
 */
function leuningPad(t, p, y) {
    if (!t.bordes) {
        return [[0, y, t.optrede], [t.aanzet, y, p.hoogte]];
    }

    const bordesX = t.vluchten[0].treden * t.aantrede;
    const bordesZ = t.bordes.hoogte;

    return [
        [0, y, t.optrede],
        [bordesX, y, bordesZ],
        [bordesX + t.bordes.lengte - t.aantrede, y, bordesZ],
        [t.aanzet, y, p.hoogte],
    ];
}

/** Welke kanten een leuning krijgen. -1 is links (-Y), +1 is rechts (+Y). */
function zijdenVan(leuning) {
    if (leuning === 'links') return [-1];
    if (leuning === 'rechts') return [1];
    if (leuning === 'beide') return [-1, 1];
    return [];
}

/**
 * Knipt een omtrek in het XZ-vlak af tegen een halfvlak: alles aan de
 * verkeerde kant van `grens` valt weg. `as` is 0 voor x en 1 voor z; `kant`
 * is +1 om te houden wat erboven ligt, -1 om te houden wat eronder ligt.
 *
 * Eerst stond hier alleen het afknippen op vloerpeil (z >= 0). Met voet- en
 * kopplaten moet er ook op plaatdikte en tegen de bovenvloer geknipt worden,
 * en dat is dezelfde bewerking met een ander vlak.
 *
 * Dit is het klassieke afknippen van een polygoon tegen een halfvlak. Per zijde:
 * ligt het beginpunt aan de goede kant, dan blijft het staan; kruist de zijde de
 * grens, dan komt er een nieuw punt op het snijpunt bij.
 *
 * Ligt alles al aan de goede kant, dan komt de omtrek er ongewijzigd uit.
 */
function knipHalfvlak(omtrek, as, grens, kant) {
    const goed = (q) => kant * (q[as] - grens) >= -1e-9;
    const uit = [];
    for (let i = 0; i < omtrek.length; i++) {
        const a = omtrek[i];
        const b = omtrek[(i + 1) % omtrek.length];
        if (goed(a)) uit.push(a);
        if (goed(a) !== goed(b)) {
            const deel = (a[as] - grens) / (a[as] - b[as]);
            const q = [a[0] + deel * (b[0] - a[0]), a[1] + deel * (b[1] - a[1])];
            q[as] = grens;
            uit.push(q);
        }
    }
    return uit;
}

/**
 * Een plaat op maat: de omtrek in het XZ-vlak, dik gemaakt in de Y-richting.
 *
 * Eerst een gesloten lijn door de hoekpunten, daar een vlak van, en dat vlak
 * vervolgens over de dikte uitrekken. Zo krijg je een echte solid met net zoveel
 * zijvlakken als de omtrek hoeken heeft.
 */
function maakPlaat(oc, d, opruimen) {
    // De omtrek stond hier in WERELDcoordinaten: een trede onderaan de trap en
    // een even grote trede hoger op kregen daardoor twee verschillende vormen,
    // terwijl het hetzelfde onderdeel is.
    //
    // Nu wordt de plaat eerst om zijn eigen hoek gebouwd en daarna verschoven.
    // Twee platen met dezelfde omtrek leveren dan ook echt dezelfde vorm op, en
    // de herkenning ziet dat ze gelijk zijn.
    const x0 = Math.min(...d.omtrek.map(([x]) => x));
    const z0 = Math.min(...d.omtrek.map(([, z]) => z));

    const lijn = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const [x, z] of d.omtrek) {
        const punt = new oc.gp_Pnt_3(x - x0, 0, z - z0);
        lijn.Add_1(punt);
        opruimen.push(punt);
    }
    lijn.Close();

    const vlak = new oc.BRepBuilderAPI_MakeFace_15(lijn.Wire(), true);
    const richting = new oc.gp_Vec_4(0, d.dikte, 0);
    const prisma = new oc.BRepPrimAPI_MakePrism_1(vlak.Shape(), richting, false, true);

    // DE SLEUVEN van een houten boom: per trede een blok uit de binnenkant,
    // een speling ruimer dan de trede en een millimeter voorbij het vlak, zodat
    // er geen vlak precies op een vlak van de plaat valt.
    let vorm = prisma.Shape();
    for (const [xa, za, xb, zb] of d.sleuven || []) {
        const sp = d.sleufSpeling || 0;
        const y0 = d.sleufBinnen === 'max' ? d.dikte - d.sleufDiepte : -1;
        const hoek = new oc.gp_Pnt_3(xa - x0 - sp, y0, za - z0 - sp);
        const blok = new oc.BRepPrimAPI_MakeBox_3(hoek, xb - xa + 2 * sp,
            d.sleufDiepte + 1, zb - za + 2 * sp);
        const snede = new oc.BRepAlgoAPI_Cut_3(vorm, blok.Shape(),
            new oc.Message_ProgressRange_1());
        snede.Build(new oc.Message_ProgressRange_1());
        vorm = snede.Shape();
        opruimen.push(hoek, blok, snede);
    }
    const lokaal = eigenVorm(oc, vorm);

    // Een plaat ligt al in het goede vlak en wordt alleen verschoven - tenzij
    // hij bij een vlucht hoort die gedraaid op zijn plek staat, zie
    // verplaatsDelen. Dan komt die draaiing om de verticale as er nog overheen.
    const { hoek = 0, verschuiving = [0, 0, 0] } = d.plaatsing || {};
    const [ex, ey] = [draaiZ([1, 0, 0], hoek), draaiZ([0, 1, 0], hoek)];
    const t0 = draaiZ([x0, d.y, z0], hoek).map((c, k) => c + verschuiving[k]);
    const tr = new oc.gp_Trsf_1();
    tr.SetValues(ex[0], ey[0], 0, t0[0],
                 ex[1], ey[1], 0, t0[1],
                 0,     0,     1, t0[2]);
    const verplaatser = new oc.BRepBuilderAPI_Transform_2(vorm, tr, true);

    opruimen.push(lijn, vlak, richting, prisma, tr, verplaatser);
    return { geplaatst: verplaatser.Shape(), lokaal };
}

/**
 * Een buis: een cilinder met een gat erin, zoals de spil van een wenteltrap.
 *
 * Opgebouwd vanuit de hoek van zijn doosje, net als rondDeel, zodat hij met
 * dezelfde assen op zijn plek gaat. Massief zou het gewicht in de raming
 * vertienvoudigen.
 */
function maakBuis(oc, d, opruimen) {
    const R = d.dx / 2;
    const voet = new oc.gp_Pnt_3(R, R, 0);
    const voet2 = new oc.gp_Pnt_3(R, R, -1);
    const omhoog = new oc.gp_Dir_4(0, 0, 1);
    const as = new oc.gp_Ax2_3(voet, omhoog);
    const as2 = new oc.gp_Ax2_3(voet2, omhoog);
    const buiten = new oc.BRepPrimAPI_MakeCylinder_3(as, R, d.dz);
    const binnen = new oc.BRepPrimAPI_MakeCylinder_3(as2, R - d.buis.wand, d.dz + 2);
    const snede = new oc.BRepAlgoAPI_Cut_3(buiten.Shape(), binnen.Shape(),
        new oc.Message_ProgressRange_1());
    snede.Build(new oc.Message_ProgressRange_1());
    const vorm = snede.Shape();
    const lokaal = eigenVorm(oc, vorm);

    const tr = new oc.gp_Trsf_1();
    tr.SetValues(
        d.xAs[0], d.yAs[0], d.zAs[0], d.oorsprong[0],
        d.xAs[1], d.yAs[1], d.zAs[1], d.oorsprong[1],
        d.xAs[2], d.yAs[2], d.zAs[2], d.oorsprong[2]);
    const verplaatser = new oc.BRepBuilderAPI_Transform_2(vorm, tr, true);
    opruimen.push(voet, voet2, omhoog, as, as2, buiten, binnen, tr, verplaatser);
    return { geplaatst: verplaatser.Shape(), lokaal };
}

/**
 * Een eigen doorsnede op lengte getrokken, zoals de L-hoek onder een trede.
 *
 * De doorsnede staat in het lokale yz-vlak, gemeten vanaf de hoek van het
 * doosje; hij wordt dx lang gemaakt langs de lokale x. Daarna gaat hij op zijn
 * plek met dezelfde assen-als-kolommen als elk ander onderdeel.
 */
function maakPrisma(oc, d, opruimen) {
    const lijn = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const [v, w] of d.doorsnede) {
        const punt = new oc.gp_Pnt_3(0, v, w);
        lijn.Add_1(punt);
        opruimen.push(punt);
    }
    lijn.Close();
    const vlak = new oc.BRepBuilderAPI_MakeFace_15(lijn.Wire(), true);
    const richting = new oc.gp_Vec_4(d.dx, 0, 0);
    const prisma = new oc.BRepPrimAPI_MakePrism_1(vlak.Shape(), richting, false, true);
    const lokaal = eigenVorm(oc, prisma.Shape());

    const tr = new oc.gp_Trsf_1();
    tr.SetValues(
        d.xAs[0], d.yAs[0], d.zAs[0], d.oorsprong[0],
        d.xAs[1], d.yAs[1], d.zAs[1], d.oorsprong[1],
        d.xAs[2], d.yAs[2], d.zAs[2], d.oorsprong[2]);
    const verplaatser = new oc.BRepBuilderAPI_Transform_2(prisma.Shape(), tr, true);

    opruimen.push(lijn, vlak, richting, prisma, tr, verplaatser);
    return { geplaatst: verplaatser.Shape(), lokaal };
}

/**
 * Bouwt de trap en levert de OCCT-vorm op.
 *
 * Zie bouwPad in build-balustrade.js: hier stonden STEP-bytes, en het opnieuw
 * ontleden daarvan was het duurste onderdeel van het hele genereren.
 */
export async function bouwTrap(p, balustradeMaten = null, leuning = 'geen',
                               bestaandeShape = null) {
    const fouten = [...valideer(p), ...controleerBordes(p), ...controleerWentel(p),
                    ...controleerHoutBoom(p)];
    if (fouten.length) throw new Error('Ongeldige maten:\n- ' + fouten.join('\n- '));

    // DE LEUNING WORDT NET ZO STRENG GEKEURD ALS EEN LOSSE BALUSTRADE. Dat
    // gebeurde niet: een doorgang van 400 mm werd bij de balustrade
    // geweigerd en op de trap gewoon gebouwd - precies de veiligheidsregel,
    // en precies op de plek waar een kind valt. Gekeurd wordt wat er
    // INGEVULD is, vóór de profielmaten erin komen; zie bouwPad.
    if (balustradeMaten && leuning !== 'geen') {
        const leuningFouten = valideerLeuning(balustradeMaten);
        if (leuningFouten.length) {
            throw new Error('Ongeldige leuningmaten (zie Balustrade):\n- '
                + leuningFouten.join('\n- '));
        }
    }

    const { delen, verbindingen, trap, opmerkingen } =
        trapDelen(p, balustradeMaten, leuning);
    const oc = await initOcct();

    const builder = new oc.BRep_Builder();
    const bundel = new oc.TopoDS_Compound();
    builder.MakeCompound(bundel);

    const opruimen = [];
    const lokaal = [];
    try {
        for (const d of delen) {
            // Een plaat is eigen aan de trap; alle andere onderdelen - ook de
            // leuning, die uit dezelfde padDelen komt als bij de balustrade -
            // gaan door de bouwer van de balustrade heen. Zo krijgt een
            // leuningprofiel op de trap dezelfde echte doorsnede.
            const gemaakt = d.omtrek ? maakPlaat(oc, d, opruimen)
                : d.doorsnede ? maakPrisma(oc, d, opruimen)
                : d.buis ? maakBuis(oc, d, opruimen)
                : await maakDeel(oc, d, opruimen);
            builder.Add(bundel, gemaakt.geplaatst);
            lokaal.push({ deel: d, vorm: gemaakt.lokaal });
        }

        let uitvoer = bundel;
        if (bestaandeShape && !bestaandeShape.IsNull()) {
            const totaal = new oc.TopoDS_Compound();
            builder.MakeCompound(totaal);
            builder.Add(totaal, bestaandeShape);
            builder.Add(totaal, bundel);
            uitvoer = totaal;
        }

        const onderdelen = groepeerVormen(oc, lokaal);

        return {
            shape: uitvoer,
            trap,
            opmerkingen,
            aantalDelen: delen.length,
            stuklijst: stuklijst(delen),
            onderdelen,
            // De trap zelf heeft geen deelsamenstellingen: treden en bomen zijn
            // losse stukken. De LEUNING erop wel - die komt uit dezelfde
            // padDelen als bij de balustrade en draagt dus dezelfde etiketten.
            // Met een leuning aan twee kanten zijn dat twee stel groepen, en
            // die blijven uit elkaar omdat samenstelling.js op het groepsobject
            // sleutelt en niet op het nummer.
            boom: maakBoom(delen, onderdelen, 'Trap'),
            materialen: materialenVan(oc, delen, bestaandeShape),
            uiterlijk: uiterlijkVan(oc, delen, bestaandeShape),
            delen,
            // De aansluitingen van de LEUNING, zodat de technische keuring ook
            // op een trap kan draaien. De trap zelf - treden, bomen - staat er
            // niet in: daar is nog geen verbindingenmodel voor.
            verbindingen,
        };
    } finally {
        for (const o of opruimen) { try { o.delete(); } catch { /* al weg */ } }
    }
}
