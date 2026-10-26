// Van losse randen naar één doorlopend pad, en van dat pad naar onderdelen.
//
// Dit bestand bevat alleen rekenwerk - geen OCCT, geen three.js. Daardoor is
// het los te testen, en dat is nodig ook: hier zit de meetkunde van de hoeken
// en van de hellende stukken.
//
// Het model:
//
//        V1 ______________ V2
//         |               |
//         |               |
//    veld |               | veld
//         |               |
//        V0               V3
//
//   - op ELK punt (V0..V3) staat een staander, verticaal
//   - tussen twee staanders zit een veld met spijlen
//   - elk veld krijgt zijn eigen aantal spijlen uit de veiligheidsregel
//   - de handregel loopt OVER de staanders heen: één stuk per recht deel van
//     het pad, niet één per veld
//
// DE HANDREGEL LIGT OP DE STAANDERS, en dat is in de tweede opdracht
// omgedraaid. Hier stond eerst het omgekeerde: staanders over de volle hoogte
// met de handregels ertussen. De reden daarvoor was dat twee doorlopende
// handregels in een hoek elkaar zouden overlappen - dat ziet er niet uit, en je
// stuklijst telt het staal dan dubbel.
//
// Dat probleem is nu opgelost met VERSTEK: beide regels worden afgezaagd op het
// vlak dat de hoek deelt, dus ze raken elkaar precies en overlappen nergens.
// Zie handregelStukken voor de meetkunde daarvan. Nagemeten over tien gevallen
// (vlak, 1:2, 3:4, knik heen en terug, hoek, gesloten ronde): nul mm3 gedeeld
// materiaal, zowel tussen twee handregels als tussen staander en handregel.
//
// Zo zit het ook in de HiCAD-voorbeeldbalustrade: één regel van 1900 mm over
// alle drie de staanders, met 100 mm overstek aan weerszijden.
//
// De staanderkop sluit aan op het ONDERVLAK van de regel, en op een helling
// wordt hij dus op de hellingshoek afgezaagd - niet vlak. Zie staanderKop.
//
// ---------------------------------------------------------------------------
// HELLENDE VELDEN (trapleuning)
//
// Spijlen staan VERTICAAL, ook op een helling. Twee verticale spijlen naast
// elkaar zijn evenwijdig, dus de kortste afstand ertussen is de HORIZONTALE
// afstand - hoe schuin de leuning er ook boven loopt.
//
//        ___----
//   ___---   |  |  |      de opening tussen twee spijlen is horizontaal,
//    |  |  | |  |  |      niet langs de leuning gemeten
//    |  |  | |  |  |
//    +--+--+-+--+--+
//    <-->  de doorgang
//
// Daarom rekenen we de spijlverdeling volledig in de HORIZONTALE projectie,
// en zetten we de spijlen daarna op hun plek langs de schuine rand. Zou je de
// schuine lengte in de formule stoppen en de spijlen op die steek neerzetten,
// dan klopt de horizontale afstand niet meer.
//
// De handregel loopt wel schuin mee. Zijn bovenkant ligt overal `hoogte` boven
// de rand, verticaal gemeten - zoals een leuninghoogte hoort te worden bepaald.
//
// VEREENVOUDIGING: de spijlen zijn recht afgezaagd, niet in verstek op de
// hellingshoek. Bij 20 mm spijlen en een trap van 30 graden scheelt dat een
// paar millimeter aan de bovenkant. Voor de maat die ertoe doet - de doorgang -
// maakt het niets uit.

import { berekenSpijlen, spijlPosities, VOETPLAAT, VULRAAMWERK, PAALKAP,
         uitklinkDiepte, stripBreedte, profielDoos,
         VULLING, vullingSoort, GLAS, SIERPUNT,
         DEKBAND } from './balustrade-rules.js';
// De modellenbibliotheek. pad.js bepaalt alleen WAAR het ornament komt en hoe
// groot; de vorm zelf wordt pas bij het bouwen gemaakt, in build-balustrade.js.
import { modelVan, hoogteVoor, GEEN as SIERPUNT_GEEN } from './sierpunten.js';
// Alleen om te weten of een profiel ROND is: een kap op een buis hoort rond te
// zijn en op een koker vierkant. profielen.js importeert zelf niets, dus hier
// ontstaat geen kringetje.
import { isRond } from './profielen.js';
import { stempelWerk } from './materialen.js';

// Hier vandaan doorgegeven: build-balustrade.js haalt hem bij pad.js, en dat
// hoeft niet te veranderen nu hij bij de regels staat.
export { profielDoos };

// --- kleine vectorhulpjes --------------------------------------------------
const min = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const plus = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const maal = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lengte = (a) => Math.hypot(a[0], a[1], a[2]);
const punt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const eenheid = (a) => maal(a, 1 / lengte(a));
const vlak = (a) => [a[0], a[1], 0];          // horizontale projectie
const vlakLengte = (a) => Math.hypot(a[0], a[1]);

function kruis(a, b) {
    return [a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]];
}

/**
 * Rijgt losse randen aan elkaar tot één pad.
 *
 * De gebruiker klikt randen aan in willekeurige volgorde. Twee randen horen bij
 * elkaar als ze een uiteinde delen. Daarmee is het een grafenprobleem: elk
 * uiteinde is een knoop, elke rand een verbinding.
 *
 *   - alle knopen graad 2                  -> gesloten lus (rondom een plaat)
 *   - precies twee knopen graad 1          -> open pad
 *   - iets anders (een T-splitsing, losse
 *     stukken, een knoop met drie randen)  -> geen pad
 *
 * @returns {{punten, gesloten}} of {{fout}}
 */
export function maakPad(randen, tolerantie = 0.05) {
    if (!randen || randen.length === 0) return { fout: 'Geen randen gekozen.' };

    for (const r of randen) {
        if (r.points.length !== 6) {
            return { fout: `Rand ${r.edgeId} is niet recht. Alleen rechte randen kunnen nu.` };
        }
        const a = [r.points[0], r.points[1], r.points[2]];
        const b = [r.points[3], r.points[4], r.points[5]];
        const d = min(b, a);
        if (lengte(d) < tolerantie) {
            return { fout: `Rand ${r.edgeId} heeft geen lengte.` };
        }
        // Een rand die (vrijwel) rechtop staat heeft geen horizontale richting,
        // dus er valt geen balustrade langs te leggen.
        if (vlakLengte(d) < tolerantie) {
            return { fout: `Rand ${r.edgeId} staat rechtop. Kies een rand die ook horizontaal loopt.` };
        }
    }

    // Uiteinden die dicht bij elkaar liggen als hetzelfde punt behandelen.
    // Modellen komen uit een tekstbestand, dus twee randen die elkaar raken
    // hebben zelden exact dezelfde coordinaten.
    const knopen = [];
    const zoekKnoop = (p) => {
        for (let i = 0; i < knopen.length; i++) {
            if (lengte(min(knopen[i], p)) <= tolerantie) return i;
        }
        knopen.push(p);
        return knopen.length - 1;
    };

    const verbindingen = randen.map(r => ({
        rand: r,
        van: zoekKnoop([r.points[0], r.points[1], r.points[2]]),
        naar: zoekKnoop([r.points[3], r.points[4], r.points[5]]),
    }));

    for (const v of verbindingen) {
        if (v.van === v.naar) {
            return { fout: `Rand ${v.rand.edgeId} begint en eindigt op hetzelfde punt.` };
        }
    }

    const buren = knopen.map(() => []);
    for (let i = 0; i < verbindingen.length; i++) {
        buren[verbindingen[i].van].push(i);
        buren[verbindingen[i].naar].push(i);
    }

    const uiteinden = [];
    for (let i = 0; i < knopen.length; i++) {
        if (buren[i].length === 1) uiteinden.push(i);
        else if (buren[i].length !== 2) {
            return {
                fout: `Op één punt komen ${buren[i].length} randen samen. `
                    + 'Kies randen die één doorlopende lijn vormen.',
            };
        }
    }

    const gesloten = uiteinden.length === 0;
    if (!gesloten && uiteinden.length !== 2) {
        return { fout: 'Deze randen vormen geen doorlopende lijn.' };
    }

    const start = gesloten ? 0 : uiteinden[0];
    const volgorde = [start];
    const gebruikt = new Set();
    let huidig = start;

    while (gebruikt.size < verbindingen.length) {
        const volgende = buren[huidig].find(i => !gebruikt.has(i));
        if (volgende === undefined) break;
        gebruikt.add(volgende);
        const v = verbindingen[volgende];
        huidig = v.van === huidig ? v.naar : v.van;
        volgorde.push(huidig);
    }

    if (gebruikt.size !== verbindingen.length) {
        return { fout: 'Deze randen hangen niet allemaal aan elkaar.' };
    }

    // Bij een lus komt het eindpunt gelijk aan het beginpunt; dat dubbele punt
    // halen we eraf en onthouden we in de vlag.
    if (gesloten) volgorde.pop();

    return { punten: volgorde.map(i => knopen[i]), gesloten };
}

/**
 * Per staander: hoe hij gedraaid staat, en hoe ver een veld van het hart blijft.
 *
 * Een staander staat VERTICAAL en is vierkant in bovenaanzicht, dus dit is
 * allemaal plattegrondwerk: we rekenen met de horizontale projecties van de
 * aanliggende randen.
 *
 * In een hoek staat de staander in de DEELHOEK, zodat beide velden er
 * symmetrisch op aansluiten. De afstand van het hart tot het punt waar je de
 * staander verlaat, gemeten langs een rand, is dan niet zomaar w/2:
 *
 *        rand
 *    ------->              de rand gaat schuin door het vierkant,
 *    +-----+               dus je legt meer dan w/2 af
 *    |  .--|-->
 *    |     |               bij 90 graden is het w/2 * sqrt(2), dus 28,3 mm
 *    +-----+               bij een staander van 40 mm
 *
 * Reken je met w/2, dan wordt de opening naast de hoekstaander te groot en
 * klopt je veiligheidsmarge niet meer. Vandaar exact:
 *
 *     inzet = (w/2) / max(|richting . deelhoek|, |richting . dwars|)
 */
export function staanderGegevens(punten, gesloten, breedte) {
    const omhoog = [0, 0, 1];
    const aantal = punten.length;

    // Horizontale richting van punt i naar punt j.
    const richtingNaar = (i, j) => {
        const d = vlak(min(punten[j], punten[i]));
        return maal(d, 1 / vlakLengte(d));
    };

    return punten.map((V, i) => {
        const vorige = i > 0 ? i - 1 : (gesloten ? aantal - 1 : null);
        const volgende = i < aantal - 1 ? i + 1 : (gesloten ? 0 : null);

        const naarVolgende = volgende !== null ? richtingNaar(i, volgende) : null;
        const naarVorige = vorige !== null ? richtingNaar(i, vorige) : null;

        // De deelhoek. Aan een uiteinde is er maar één rand, dan volgt de
        // staander die rand. Liggen twee randen in elkaars verlengde, dan
        // heffen ze elkaar op en nemen we ook gewoon de rand.
        let deelhoek;
        if (naarVolgende && naarVorige) {
            const som = plus(naarVolgende, naarVorige);
            deelhoek = lengte(som) > 1e-6 ? eenheid(som) : naarVolgende;
        } else {
            deelhoek = naarVolgende || naarVorige;
        }

        const dwars = eenheid(kruis(omhoog, deelhoek));

        const inzetLangs = (richting) => richting === null ? 0
            : (breedte / 2) / Math.max(Math.abs(punt(richting, deelhoek)),
                                       Math.abs(punt(richting, dwars)));

        return {
            positie: V,
            deelhoek,
            dwars,
            // De horizontale richtingen waarin de aanliggende velden weglopen,
            // of null als er aan die kant geen veld is. Dat zijn precies de
            // kanten waar een handregel tegen de staander komt, dus daar wordt
            // hij uitgeklonken. Aan een vrij uiteinde is er maar één.
            naarVolgende,
            naarVorige,
            inzetNaarVolgende: inzetLangs(naarVolgende),
            inzetNaarVorige: inzetLangs(naarVorige),
        };
    });
}

/** Meetkunde van één veld tussen twee punten. Alle inzetten zijn horizontaal. */
export function veldGegevens(A, B, beginInzet, eindInzet) {
    const d = min(B, A);
    const schuineLengte = lengte(d);
    const horizontaleLengte = vlakLengte(d);

    const langs = maal(d, 1 / schuineLengte);              // 3D, langs de rand
    const langsVlak = maal(vlak(d), 1 / horizontaleLengte); // alleen horizontaal
    const dwars = eenheid(kruis([0, 0, 1], langsVlak));

    // cos van de hellingshoek: hoeveel horizontaal je aflegt per meter rand.
    const cos = horizontaleLengte / schuineLengte;

    // Loodrecht op de rand, in het verticale vlak, naar boven wijzend.
    const loodrecht = kruis(langs, dwars);
    const omhoogLoodrecht = loodrecht[2] < 0 ? maal(loodrecht, -1) : loodrecht;

    return {
        langs, langsVlak, dwars, loodrecht: omhoogLoodrecht, cos,
        schuineLengte, horizontaleLengte,
        // De vrije ruimte tussen de staanders, HORIZONTAAL gemeten. Dit getal
        // gaat de veiligheidsregel in.
        vrijeLengte: horizontaleLengte - beginInzet - eindInzet,
        // Waar het veld begint, in 3D. Horizontaal opschuiven betekent langs de
        // rand opschuiven met h/cos.
        begin: plus(A, maal(langs, beginInzet / cos)),
        beginInzet, eindInzet,
    };
}

/**
 * Zet er tussenstaanders bij, zodat geen veld langer wordt dan `maxAfstand`.
 *
 * Waarom dit nodig is: een balustrade van 5 meter met alleen aan de uiteinden
 * een staander bestaat niet. De staander is het enige onderdeel dat een duw
 * tegen de leuning naar de vloer brengt; hoe verder ze uit elkaar staan, hoe
 * zwaarder alles moet worden. In de HiCAD-voorbeeldbalustrade staan ze op 850 mm.
 *
 * De afstand wordt LANGS de leuning gemeten en niet horizontaal. Bij de spijlen
 * is dat andersom - daar gaat het om de opening waar een kind doorheen kan, en
 * die is horizontaal - maar hier gaat het om de overspanning van de handregel,
 * en die loopt schuin mee.
 *
 * Verdeelt in gelijke stukken in plaats van er vaste stappen van 850 af te
 * halen met een restje. Een veld van 900 mm wordt dus 2 x 450 en niet 850 + 50.
 */
export function verdichtPad(punten, gesloten, maxAfstand) {
    if (!(maxAfstand > 0) || punten.length < 2) return punten;

    const uit = [];
    const aantal = punten.length;
    const laatsteRand = gesloten ? aantal : aantal - 1;

    for (let i = 0; i < laatsteRand; i++) {
        const a = punten[i];
        const b = punten[(i + 1) % aantal];
        uit.push(a);

        const stukken = Math.ceil(lengte(min(b, a)) / maxAfstand);
        for (let k = 1; k < stukken; k++) {
            const t = k / stukken;
            uit.push([a[0] + (b[0] - a[0]) * t,
                      a[1] + (b[1] - a[1]) * t,
                      a[2] + (b[2] - a[2]) * t]);
        }
    }
    if (!gesloten) uit.push(punten[aantal - 1]);
    return uit;
}

/**
 * Knipt een pad in DOORLOPENDE STUKKEN: reeksen velden met dezelfde richting.
 *
 * Nodig omdat een handregel niet per veld hoort maar per recht stuk. Een
 * balustrade van 2000 mm krijgt van verdichtPad drie velden en vier staanders;
 * de handregel is dan EEN stuk van 2200 mm dat over de twee middelste staanders
 * heen loopt, en niet drie losse stukjes van 626 en 746 mm.
 *
 * Een nieuw stuk begint bij een vrij uiteinde, bij een hoek in de plattegrond
 * en bij een knik in de helling - overal waar de richting verandert. Een
 * tussenstaander die verdichtPad erbij heeft gezet verandert de richting niet
 * en knipt dus niets.
 *
 * --- HET VERSTEKVLAK -------------------------------------------------------
 *
 * Waar twee stukken samenkomen moeten ze in VERSTEK worden afgezaagd, anders
 * overlappen ze elkaar en telt de stuklijst het staal dubbel. Dat was de reden
 * dat de handregel hier eerst per veld tussen de staanders lag (zie de kop van
 * dit bestand); met verstek kan hij er wel overheen.
 *
 * Het vlak dat de hoek deelt heeft als normaal
 *
 *     n  ~  d_in + d_uit
 *
 * met d_in de richting waarmee de regel aankomt en d_uit die waarmee hij
 * verdergaat, allebei 3D en op lengte 1. Twee keer langs een andere weg
 * nagerekend, want hier is in dit project al eerder een stap van millimeters
 * ontstaan:
 *
 *   - via de ZIJVLAKKEN (hoek in de plattegrond): bij 90 graden snijden de
 *     zijvlakken elkaar op de buitenhoek en op de binnenhoek; het vlak door
 *     die twee staat op 45 graden, en dat is precies n ~ d_in + d_uit.
 *   - via de BOVEN- en ONDERVLAKKEN (knik in de helling): die snijden elkaar
 *     in twee horizontale lijnen, en het vlak daardoor heeft als normaal
 *     loodrecht_uit - loodrecht_in. Met som-naar-product valt dat samen met
 *     d_in + d_uit.
 *
 * Bij een vlakke hoek staan boven- en ondervlak van beide stukken in hetzelfde
 * vlak, dus daar zegt de tweede afleiding niets; bij een knik zonder hoek
 * zeggen de zijvlakken niets. Samen dekken ze alles, en ze geven hetzelfde
 * antwoord.
 *
 * DOOR WELK PUNT, en dat is de valkuil: NIET door het staanderhart, maar door
 *
 *     padpunt + [0, 0, hoogte]
 *
 * het punt waar de twee BOVENVLAKKEN elkaar raken. De bovenkant van de
 * handregel ligt overal `hoogte` boven het pad, verticaal gemeten, dus dat
 * punt hebben beide stukken gemeenschappelijk - hun hartlijnen niet, want die
 * liggen een halve regelhoogte LOODRECHT onder de bovenkant en die richting
 * verschilt per helling.
 *
 * Nagemeten op een knik van 1:2 met een handregel van 40 mm: het vlak door het
 * staanderhart ligt 230 mm van het vlak door dat bovenpunt. Dat is geen
 * afrondverschil maar een verzaagde regel. Bij een vlakke hoek is de normaal
 * horizontaal en maakt het niets uit; één regel dekt dus beide gevallen.
 *
 * `tolerantie` is het verschil tussen twee eenheidsrichtingen waaronder ze als
 * dezelfde richting gelden. 1e-4 is ruim boven de ruis van verdichtPad (1e-13)
 * en van coordinaten uit een STEP-bestand, en ver onder de kleinste knik die
 * iemand bedoeld kan hebben: een graad geeft al 0,017.
 *
 * @returns Array van stukken, in de volgorde waarin ze langs het pad liggen:
 *   `{ velden, begin, eind, langs, beginVrij, eindVrij, beginNormaal, eindNormaal }`
 *   - `velden`  de veldnummers die in dit stuk zitten
 *   - `begin`/`eind`  de padpunten waar het stuk begint en eindigt
 *   - `langs`   de richting van het stuk, op lengte 1
 *   - `…Vrij`   true als daar niets tegenaan komt (daar mag overstek)
 *   - `…Normaal` de normaal van het verstekvlak, of null aan een vrij eind
 */
export function handregelStukken(punten, gesloten, tolerantie = 1e-4) {
    const aantal = punten.length;
    const aantalVelden = gesloten ? aantal : aantal - 1;
    if (aantalVelden < 1) return [];

    const richtingen = [];
    for (let i = 0; i < aantalVelden; i++) {
        richtingen.push(eenheid(min(punten[(i + 1) % aantal], punten[i])));
    }

    const zelfdeRichting = (a, b) => lengte(min(a, b)) < tolerantie;

    /** Het verstekvlak tussen twee richtingen. */
    const verstek = (binnen, buiten) => {
        const som = plus(binnen, buiten);
        // Een pad dat op zichzelf terugkomt kan maakPad niet opleveren, maar
        // deel nooit door nul: dan maar een rechte kop.
        return lengte(som) < 1e-9 ? binnen : eenheid(som);
    };

    // Waar het eerste stuk begint. Bij een open pad is dat veld 0; bij een lus
    // is er geen begin, dus zoeken we de naad: een veld waarvan de voorganger
    // een andere richting heeft.
    let start = 0;
    if (gesloten) {
        start = -1;
        for (let i = 0; i < aantalVelden; i++) {
            const vorige = (i - 1 + aantalVelden) % aantalVelden;
            if (!zelfdeRichting(richtingen[i], richtingen[vorige])) { start = i; break; }
        }
        if (start === -1) {
            // Een gesloten pad waarvan alle velden dezelfde richting hebben
            // bestaat niet. Toch niet vastlopen in de lus hieronder.
            return [{
                velden: richtingen.map((_, i) => i),
                begin: 0, eind: 0, langs: richtingen[0],
                beginVrij: false, eindVrij: false,
                beginNormaal: null, eindNormaal: null,
            }];
        }
    }

    const stukken = [];
    let k = 0;
    while (k < aantalVelden) {
        const eerste = (start + k) % aantalVelden;
        const langs = richtingen[eerste];
        const velden = [eerste];
        k++;
        while (k < aantalVelden
               && zelfdeRichting(richtingen[(start + k) % aantalVelden], langs)) {
            velden.push((start + k) % aantalVelden);
            k++;
        }

        const laatste = velden[velden.length - 1];
        const beginVrij = !gesloten && eerste === 0;
        const eindVrij = !gesloten && laatste === aantalVelden - 1;
        const voor = richtingen[(eerste - 1 + aantalVelden) % aantalVelden];
        const na = richtingen[(laatste + 1) % aantalVelden];

        stukken.push({
            velden,
            begin: eerste,
            eind: (laatste + 1) % aantal,
            langs,
            beginVrij,
            eindVrij,
            beginNormaal: beginVrij ? null : verstek(voor, langs),
            eindNormaal: eindVrij ? null : verstek(langs, na),
        });
    }

    return stukken;
}

/**
 * Alle onderdelen van een balustrade langs een pad, in wereldcoordinaten.
 *
 * Elk onderdeel is een balk, beschreven met een eigen assenstelsel:
 *   oorsprong = de hoek waar de balk begint
 *   xAs/yAs/zAs = de richtingen, dx/dy/dz = de maten daarlangs
 *
 * Dit is de ENIGE plek waar staat waar welk stuk staal komt. Zowel de
 * geometrie als de stuklijst komt hieruit.
 */
export function padDelen(punten, gesloten, p) {
    const omhoog = [0, 0, 1];

    // Tussenstaanders erbij voordat er ook maar iets gebouwd wordt. Daarna
    // "weet" de rest van deze functie niet meer welke staanders er van het pad
    // kwamen en welke erbij gezet zijn - en dat hoeft ook niet. Velden,
    // spijlverdeling en stuklijst volgen vanzelf.
    const pad = verdichtPad(punten, gesloten, p.maxStaanderAfstand);

    // --- de maten van de drie onderdelen ----------------------------------
    //
    // Is er voor een onderdeel een profiel gekozen, dan bepaalt DAT zijn maten
    // en niet het invulveld. De buitenmaten komen uit het manifest, dus er gaat
    // geen STEP-bestand voor open.
    //
    // Dit gebeurt HIER, bovenaan, en niet in bouwPad. Het voorbeeld in het
    // paneel loopt namelijk rechtstreeks langs padDelen; zou de afleiding
    // alleen in bouwPad staan, dan voorspelt het paneel iets anders dan er
    // gebouwd wordt. Dat verschil is in dit project al een keer misgegaan.
    //
    // Over de richting: de catalogus legt de BREEDTE van een doorsnede langs X
    // en de HOOGTE langs Y. (Hier stond eerst "de lange zijde langs Y". Dat is
    // in de tweede opdracht rechtgezet. Voor een buis of koker maakte het niets
    // uit, want die zijn symmetrisch; voor hoekstaal wel.)
    //
    // Wij zetten de X van het profiel in de looprichting van de leuning. Voor
    // platstaal 20 x 5 staat de dikte van 5 mm dus naar voren en de 20 mm de
    // diepte in - precies zoals het in de voorbeeldbalustrade zit.
    const stDoos = profielDoos(p.staanderProfiel);
    const staanderBreedte = stDoos ? Math.max(stDoos[0], stDoos[1]) : p.staanderBreedte;

    // De BREEDTE van de spijl gaat de veiligheidsregel in: die bepaalt hoeveel
    // ruimte er tussen twee spijlen overblijft.
    // EEN GEDRAAIDE BALUSTER NEGEERT HET PROFIEL, en dat is geen slordigheid.
    // Hij wordt niet uit een stang gezaagd maar gedraaid of gegoten; zijn
    // doorsnede is vierkant en even breed als diep, en die maat geef je op in
    // het spijlbreedteveld. Een gekozen stalen profiel zou daar alleen maar
    // een andere maat tegenover zetten die nergens op slaat.
    const balusterModel = vullingSoort(p.vulling) === 'spijlen'
        && p.spijlModel ? p.spijlModel : null;
    const spDoos = balusterModel ? null : profielDoos(p.spijlProfiel);
    const spijlBreedte = spDoos ? spDoos[0] : p.spijlBreedte;
    const spijlDiepte = spDoos ? spDoos[1] : p.spijlBreedte;

    // EEN DEKBAND NEGEERT HET PROFIEL, net als een gedraaide baluster. Hij
    // wordt niet gewalst maar gegoten of gehouwen; zijn doorsnede tekenen we
    // zelf. Zie dekbanden.js.
    //
    // EN HIJ IS BREDER DAN DE PAAL. Dat is geen opsmuk maar wat een dekband
    // doet: de plaat steekt over de balusters heen zodat het regenwater vrij
    // valt in plaats van langs de balusters te lopen. De factor staat in
    // regels.json en is een KEUZE, afgelezen van wat zo'n band doet.
    const dekbandModel = p.handregelModel || null;
    const hrDoos = dekbandModel ? null : profielDoos(p.handregelProfiel);
    const dikte = hrDoos ? hrDoos[0]
        : Math.max(spijlBreedte, staanderBreedte)
          * (dekbandModel ? DEKBAND.breedteFactor : 1);
    const handregelHoogte = hrDoos ? hrDoos[1] : p.handregelHoogte;

    const staanders = staanderGegevens(pad, gesloten, staanderBreedte);
    const delen = [];
    const velden = [];

    // --- de VERBINDINGEN, expliciet in plaats van impliciet ----------------
    //
    // Deze functie weet precies welk deel tegen welk komt en hoe - dat zit in
    // elke berekening hieronder. Maar hij gaf alleen een platte lijst doosjes
    // terug, en daarmee is die kennis weg. Alles wat daarna wil controleren of
    // de onderdelen op elkaar PASSEN moet het dan uit de meetkunde raden.
    //
    // Dat is precies waar het vijf keer op rij is misgegaan: de app zei "niets
    // aan de hand" terwijl er staal door staal stak, want niemand had
    // opgeschreven dat die twee bij elkaar horen.
    //
    // Elke verbinding noemt de twee delen (als index in `delen`), het SOORT
    // aansluiting, het punt waar hij zit en de richting waarlangs hij gemaakt
    // wordt. Meer niet: de maten staan al in de delen zelf.
    //
    //   ligt-op   het ene deel ligt OP het andere; de kop eronder is op maat
    //             gezaagd of uitgezadeld      (handregel op staander)
    //   verstek   twee delen in elkaars verlengde, schuin afgezaagd
    //             (handregel op handregel in een hoek of knik)
    //   stomp     het ene deel komt STOMP tegen het andere aan
    //             (vulregel tegen staander, zonder uitklinken)
    //   in-bed    idem, maar het zakt in een uitsparing
    //             (vulregel tegen een uitgeklonken staander)
    //   tussen    het ene deel staat TUSSEN twee andere ingeklemd
    //             (spijl tussen de twee vulregels, of vloer en handregel)
    //   doorheen  het ene deel steekt DOOR een gat in het andere
    //             (een doorgestoken spijl door de bovenregel en de handregel)
    //   op-plaat  een staander op zijn voetplaat
    const verbindingen = [];
    /** Voegt een deel toe en geeft zijn index terug. */
    const voegToe = (deel) => delen.push(deel) - 1;
    const verbind = (a, b, soort, punt, richting) => {
        if (a === undefined || b === undefined) return;
        verbindingen.push({ a, b, soort, punt, richting });
    };
    // Waar elk onderdeel in `delen` terechtkwam, zodat de verbindingen
    // hieronder naar een index kunnen wijzen in plaats van naar een kopie.
    const staanderNr = [];       // per padpunt
    const voetplaatNr = [];      // per padpunt
    const vulregelNr = [];       // per veld: [onderregel, bovenregel]
    const spijlNr = [];          // per veld: alle spijlen

    // Vanaf hier heet het pad gewoon weer `punten`, zodat de rest ongewijzigd is.
    punten = pad;

    // --- voetplaten --------------------------------------------------------
    //
    // Hiervoor zweefden de staanders: er was geen enkele bevestiging aan de
    // vloer. In de HiCAD-voorbeeldbalustrade ligt onder elke staander een plaat
    // van 150 x 50 x 10, en de staander staat EROP - de vloer eindigt daar op
    // z = 457, de staanders beginnen op z = 467. Nagemeten, zie regels.json.
    //
    // Daarom gaat de plaatdikte van de STAANDERLENGTE af en komt hij niet bij
    // de hoogte op. 1000 mm boven de vloer blijft zo 1000 mm boven de vloer -
    // precies zoals in dat voorbeeld, waar de handregel op z = 1457 eindigt.
    const vp = { ...VOETPLAAT, ...(p.voetplaat || {}) };
    const plaatDikte = Math.max(0, Number(p.voetplaatDikte) || 0);

    // --- de handregel loopt over ELKE staander heen ------------------------
    //
    // Hiervoor lag de handregel TUSSEN de staanders, en liep alleen bij
    // overstek over de twee buitenste heen. De reden stond in de kop van dit
    // bestand: twee doorlopende regels overlappen elkaar in een hoek, en dan
    // telt de stuklijst het staal dubbel.
    //
    // Dat is nu opgelost met VERSTEK (zie handregelStukken hierboven), dus de
    // regel kan doorlopen - zoals het ook in de HiCAD-voorbeeldbalustrade zit:
    // een regel van 1900 mm over alle drie de staanders, 100 mm overstek aan
    // weerszijden.
    //
    // Het overstek wordt vanaf het HART van de buitenste staander gemeten, net
    // als in dat voorbeeld (handregel 282,72..2182,72 bij staanderharten 382,75
    // en 2082,75), en het is een HORIZONTALE maat - langs een schuine rail is
    // dat overstek/cos.
    const overstek = Number(p.handregelOverstek) || 0;

    /**
     * De kop van een staander: hoe hoog hij komt en met welk vlak hij wordt
     * afgezaagd.
     *
     * De staander stopt op het ONDERVLAK van de handregel; die ligt eroverheen.
     * Zonder dat liep hij door tot de bovenkant van de regel en zaten twee
     * stukken staal op dezelfde plek: nagemeten 64 000 mm3 per eindstaander,
     * precies 40 x 40 x 40, de hele kop.
     *
     * OP EEN HELLING IS EEN VLAKKE KOP FOUT, en dat is nagemeten. Eerst stopte
     * de staander vlak af op de hoogte waar het ondervlak van de regel de
     * hartlijn kruist, hoogte - handregelhoogte/cos. Maar dat ondervlak loopt
     * schuin mee: aan de afwaartse kant van de paal ligt het een halve
     * staanderbreedte x tan(helling) LAGER - bij een buis van 48,3 op een
     * helling van 1:2 is dat 12,1 mm. De vlakke kop stak daar dus door de regel
     * heen: gemeten 865 mm3 bij 1:2, 1507 mm3 bij 3:4 en 753 tot 1130 mm3 bij
     * een knik.
     *
     * Daarom wordt de kop AFGEZAAGD OP HET ONDERVLAK van de regel, dus op de
     * hellingshoek - precies zoals je hem in de werkplaats ook zaagt. Dat vlak
     * gaat door
     *
     *     padpunt + [0, 0, hoogte] - handregelhoogte * loodrecht
     *
     * en heeft `loodrecht` als normaal. Op een VLAK stuk is dat vlak horizontaal
     * en valt het samen met de bovenkant van de staander; dan wordt er geen
     * snede toegevoegd, zodat een vlakke leuning letterlijk dezelfde vorm
     * oplevert als voorheen - geen extra booleaanse bewerking en dus ook geen
     * andere vingerafdruk voor de onderdeelherkenning.
     *
     * Bij een KNIK komen twee regels met een verschillende helling samen. Dan
     * krijgt de kop TWEE sneden en zaagt hij zich dus naar de laagste van de
     * twee - exact, in plaats van met een geschat minimum.
     *
     * `dz` is het HOOGSTE punt dat na het zagen overblijft, dus de echte
     * zaaglengte. Dat is de kant van de paal die tegen de helling op wijst.
     */
    const staanderKop = (s, i) => {
        const halve = staanderBreedte / 2;
        // Een ronde paal steekt in elke richting een halve diameter uit; een
        // vierkante steekt over zijn diagonaal verder. Dat verschil bepaalt
        // hoe hoog het hoogste punt van de schuine kop ligt, en dus de
        // zaaglengte die in de stuklijst komt.
        const hoekpunten = isRond(p.staanderProfiel)
            ? null
            : [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) =>
                plus(maal(s.deelhoek, a * halve), maal(s.dwars, b * halve)));

        /**
         * Op welke hoogte het snijvlak ligt, `off` horizontaal uit het hart.
         *
         * `kopOnder` is de afstand LOODRECHT onder de bovenkant van de regel:
         * de hele regelhoogte bij een vlakke onderkant, de kruin van het zadel
         * bij een ronde regel. Zie kopOnder hierboven.
         */
        const zOpVlak = (lood, off) =>
            p.hoogte - (kopOnder + punt(off, lood)) / lood[2];

        const vlakken = [];
        let top = -Infinity;

        for (const stap of [-1, 1]) {
            const ander = i + stap;
            if (!gesloten && (ander < 0 || ander >= pad.length)) continue;
            const d = min(pad[(ander + pad.length) % pad.length], pad[i]);
            const l = lengte(d);
            if (l < 1e-9) continue;

            const langs = maal(d, 1 / l);
            const dwarsVeld = eenheid(kruis(omhoog, langs));
            const lood = kruis(langs, dwarsVeld);
            if (lood[2] < 0) { lood[0] = -lood[0]; lood[1] = -lood[1]; lood[2] = -lood[2]; }

            // Het hoogste punt van dit vlak boven de voet van de staander.
            const randen = hoekpunten
                || (vlakLengte(lood) > 1e-12
                    ? [maal(eenheid(vlak(lood)), -halve)]
                    : [[0, 0, 0]]);
            for (const off of randen) top = Math.max(top, zOpVlak(lood, off));

            // Twee aanliggende velden met dezelfde helling geven hetzelfde
            // vlak, dus niet twee keer snijden.
            if (!vlakken.some(v => lengte(min(v, lood)) < 1e-9)) vlakken.push(lood);
        }

        if (top === -Infinity) top = p.hoogte - kopOnder;

        // Is er maar EEN vlak en is dat horizontaal, dan is het al de bovenkant
        // van de staander en hoeft er niets gesneden te worden. Zo levert een
        // vlakke leuning letterlijk dezelfde vorm op als voorheen: geen extra
        // booleaanse bewerking, dus ook geen andere vingerafdruk.
        //
        // Bij een KNIK moet het horizontale vlak er wél bij, en dat is
        // nagemeten. Daar maakt het SCHUINE vlak de staander hoger dan het
        // vlakke toelaat: bij een trap die op een bordes uitkomt stak de kop
        // 6 mm door de vlakke regel heen, 138,8 mm3. Sla je het horizontale
        // vlak over omdat het "al de bovenkant is", dan mis je precies dat.
        const alleenVlak = vlakken.length === 1 && vlakLengte(vlakken[0]) < 1e-9;
        return { top, vlakken: alleenVlak ? [] : vlakken };
    };

    /**
     * Loopt de handregel over de kop van staander `i`?
     *
     * Sinds de regel doorloopt: altijd. Dit blijft een functie en geen vaste
     * waarde omdat er één plek moet zijn waar dit staat - een leuning zonder
     * handregel kan de app nu niet maken, maar als dat er ooit komt hoort de
     * paalkap weer terug te komen en hoort de staander weer tot de volle
     * hoogte te lopen.
     */
    const regelOverDeKop = () => true;

    /**
     * De hoogste plek van de BOVENKANT van de handregel onder een voet van
     * `halve` x 2 breed, recht boven staander `i`.
     *
     * Een sierpunt staat op de regel. Op een vlak stuk is de bovenkant overal
     * p.hoogte en komt hier precies p.hoogte uit. Op een helling loopt hij
     * schuin op: aan de bergkant van de voet ligt hij een halve voet x
     * tan(helling) hoger. Stond het ornament op p.hoogte, dan zakte die kant
     * in de regel - gemeten op een trap met kap-vlak: 15 326 mm3 over zeven
     * staanders. Zelfde meetkunde als staanderKop, maar dan het bovenvlak.
     */
    const regelTopOnder = (s, i, halve, rond) => {
        let top = p.hoogte;
        for (const stap of [-1, 1]) {
            const ander = i + stap;
            if (!gesloten && (ander < 0 || ander >= pad.length)) continue;
            const d = min(pad[(ander + pad.length) % pad.length], pad[i]);
            const l = lengte(d);
            if (l < 1e-9) continue;
            const langs = maal(d, 1 / l);
            const lood = kruis(langs, eenheid(kruis(omhoog, langs)));
            if (lood[2] < 0) { lood[0] = -lood[0]; lood[1] = -lood[1]; lood[2] = -lood[2]; }
            if (vlakLengte(lood) < 1e-12) continue;          // vlak: niets hoger
            const randen = rond
                ? [maal(eenheid(vlak(lood)), -halve)]
                : [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) =>
                    plus(maal(s.deelhoek, a * halve), maal(s.dwars, b * halve)));
            for (const off of randen) top = Math.max(top, p.hoogte - punt(off, lood) / lood[2]);
        }
        return top;
    };

    // --- de afdekkap -------------------------------------------------------
    //
    // Een plaatje bovenop de staander, een paar millimeter oversteek rondom.
    // Zonder kap eindigt een koker in een afgezaagde kop en kijk je de buis
    // in; op elke foto van een echte leuning zit daar een kap op. Zie
    // regels.json voor waarom dit ook het "stompje" boven een ronde handregel
    // verklaart.
    //
    // Hij komt BOVENOP de staander en telt niet mee in de leuninghoogte.
    const kapDikte = Math.max(0, Number(p.paalkapDikte) || 0);
    const kapOverstek = PAALKAP.overstek;
    // Een kap op een buis hoort rond te zijn, op een koker vierkant. Zonder
    // profiel is de staander een massief blok, dus dan vierkant.
    const kapIsRond = isRond(p.staanderProfiel);

    // --- sierpunten en paalkoppen ------------------------------------------
    //
    // Het model, de hoogte, en op welke staanders ze komen. Zie sierpunten.js
    // voor de modellen zelf en regels.json voor waar de verhoudingen vandaan
    // komen.
    //
    // `sierpuntOp` is een keuze per staander: 'alle', 'eind' (alleen de twee
    // buitenste) of 'geen'. Eind is de gewone keuze op een hek - daar staan de
    // punten op de hoekpalen en niet op elke tussenpaal.
    const sierpuntModel = p.sierpunt && p.sierpunt !== SIERPUNT_GEEN
        ? p.sierpunt : null;
    const sierpuntHoogte = Number(p.sierpuntHoogte) > 0
        ? Number(p.sierpuntHoogte)
        : (sierpuntModel
            ? hoogteVoor(modelVan(sierpuntModel), staanderBreedte) : 0);
    const sierpuntWaar = p.sierpuntWaar || 'alle';
    const sierpuntOp = (i) => sierpuntWaar === 'alle'
        || (sierpuntWaar === 'eind'
            && !gesloten && (i === 0 || i === punten.length - 1));
    const sierpuntNr = [];

    // --- sierpunten op de SPIJLEN ------------------------------------------
    //
    // Hier ging het drie keer mis voordat het duidelijk werd. Op de hekken die
    // de opdrachtgever aanwees staat op ELKE SPIJL een punt, niet alleen op de
    // palen: de staaf loopt door de bovenste regel heen, steekt er een stuk
    // bovenuit en eindigt in een bolletje of een speerpunt. Een ornament op de
    // paal blijft laag hoeveel hals je er ook onder zet, want het ding stond
    // simpelweg op het verkeerde onderdeel.
    //
    // `spijlOverstek` is de KALE staaf boven de handregel; het ornament komt
    // daar nog bovenop. 0 zet alles uit en dan verandert er niets aan wat er
    // altijd al gebouwd werd.
    //
    // Alleen zinvol bij een spijlenvulling: bij glas of liggende regels staan
    // er geen staven om iets op te zetten.
    const spijlOverstek = vullingSoort(p.vulling) === 'spijlen'
        ? Math.max(0, Number(p.spijlOverstek) || 0) : 0;
    const spijlSierpunt = p.spijlSierpunt && p.spijlSierpunt !== SIERPUNT_GEEN
        ? p.spijlSierpunt : null;
    // Doorsteken heeft alleen zin als de staaf er ook echt doorheen moet. Zet
    // iemand alleen een model zonder overstek, dan zou de punt IN de handregel
    // staan; dan is er niets te doen.
    const spijlDoorsteek = spijlOverstek > 0;

    /**
     * Een gat voor een doorgestoken spijl in een liggend onderdeel.
     *
     * `deel` is het onderdeel waar het gat in komt (handregel of bovenregel),
     * `hart` een punt op de hartlijn van de spijl, in wereldcoördinaten. Alles
     * wordt hier naar de LOGISCHE assen van dat onderdeel omgerekend - u langs
     * xAs vanaf de oorsprong, v langs yAs, w langs zAs - want daar snijdt
     * build-balustrade.js in, op de lokale vorm, nog voor het onderdeel op zijn
     * plek gaat. Zo zit het gat in de productievorm en niet alleen in het
     * plaatje, en zijn twee regels met hetzelfde gatenpatroon hetzelfde
     * onderdeel.
     *
     * Raakt de spijl dit onderdeel niet, dan gebeurt er niets. Dat is geen
     * voorzichtigheid maar nodig: een handregel is één doorlopend stuk over
     * meerdere velden, en elk veld biedt al zijn spijlen aan.
     */
    const inAssenVan = (deel, q) => {
        const d = min(q, deel.oorsprong);
        return [punt(d, deel.xAs), punt(d, deel.yAs), punt(d, deel.zAs)];
    };
    const richtingVan = (deel, r) =>
        [punt(r, deel.xAs), punt(r, deel.yAs), punt(r, deel.zAs)];
    const boorDoor = (deel, hart, maten) => {
        const n = richtingVan(deel, maten.langs);
        // EERST DOORSCHUIVEN TOT HALVERWEGE HET ONDERDEEL, en dat is niet
        // kosmetisch. `hart` ligt op de VOET van de spijl, een meter onder de
        // regel. Op een helling staan de assen van die regel schuin, dus een
        // punt dat een meter lager ligt heeft langs de regel een heel andere
        // u-waarde - bij 1:2 schuift hij 447 mm op. De ligging-test hieronder
        // wees dan driekwart van de spijlen af, en precies die spijlen staken
        // daarna ongeboord door het staal heen: gemeten 53 666 mm3
        // handregel ∩ spijl op een helling van 1:2.
        //
        // Dus: volg de hartlijn tot het midden van het onderdeel, en kijk DAAR
        // of hij er doorheen gaat. Loodrecht op zijn eigen vlak is een
        // onderdeel nooit evenwijdig aan een spijl, dus n[2] is nooit nul.
        const q0 = inAssenVan(deel, hart);
        if (Math.abs(n[2]) < 1e-9) return false;
        const t = (deel.dz / 2 - q0[2]) / n[2];
        const q = [q0[0] + t * n[0], q0[1] + t * n[1], deel.dz / 2];
        // Een halve spijlbreedte marge: de hartlijn mag net buiten de
        // oorsprongshoek vallen zonder dat het gat verdwijnt.
        const rand = Math.max(maten.breedte, maten.diepte) / 2;
        if (q[0] < -rand || q[0] > deel.dx + rand) return false;
        if (q[1] < -rand || q[1] > deel.dy + rand) return false;
        (deel.doorsteken = deel.doorsteken || []).push({
            punt: q,
            richting: n,
            breedteRichting: richtingVan(deel, maten.breedteAs),
            breedte: maten.breedte,
            diepte: maten.diepte,
            rond: Boolean(maten.rond),
        });
        return true;
    };
    // Alle doorgestoken spijlen van de hele leuning, met wat er nodig is om er
    // een gat voor te maken. De handregel wordt pas NA de veldenlus gebouwd -
    // hij loopt over meerdere velden heen - dus de spijlen moeten tot dan
    // bewaard blijven.
    const doorsteekSpijlen = [];

    // --- vulraamwerk -------------------------------------------------------
    //
    // Zonder raamwerk lopen de spijlen van de rand tot onder de handregel. Met
    // raamwerk zitten ze tussen een onder- en een bovenregel, en is het vulveld
    // een los paneel dat je plat op een bok last en daarna tussen de staanders
    // hangt. Zo zit het in de voorbeeldbalustrade, en zo maakt een
    // leuningmaker het ook. Zie regels.json voor de nagemeten maten.
    //
    // null = geen raamwerk, en dan verandert er niets aan de oude manier.
    // De BREEDTE van de strip volgt de staander. Punt 2 van de tweede opdracht:
    // de app stelt een passende maat voor bij het gekozen staanderprofiel in
    // plaats van er een vast getal van te maken. Bij een staander van 40 komt
    // daar 30 uit - precies wat er hiervoor vast stond - en bij 50 komt er 40
    // uit, het voorbeeld uit de opdracht. Zie stripBreedte in
    // balustrade-rules.js.
    //
    // RANGORDE, van zwaar naar licht: een gekozen regelprofiel gaat voor een
    // handmatige maat, en die gaat voor de afgeleide. Dezelfde rangorde als bij
    // de staanderbreedte. 0 in het veld betekent 'uit de staander afleiden',
    // net als bij voetplaatdikte en paalkapdikte.
    // WAARMEE HET VELD GEVULD WORDT. Zie regels.json: spijlen, horizontale
    // regels, of niets.
    //
    // HORIZONTAAL VRAAGT HET RAAM. De liggende regels moeten ergens tussen, en
    // dat is het vulraamwerk; zonder raam is er geen onder- en bovenregel om
    // ze tussen te verdelen. Het vinkje gaat daarom vanzelf aan - main.js
    // meldt dat op het scherm, zodat het niet stilletjes gebeurt.
    //
    // GEEN VULLING betekent ook GEEN RAAM. Een leeg raampje tussen de
    // staanders hangen heeft geen functie; wie niets wil, wil staanders en een
    // handregel.
    //
    // GLAS VRAAGT HET RAAM OOK. De ruit wordt met klemmen op de onder- en
    // bovenregel vastgezet; zonder raam is er niets om hem aan te klemmen.
    const vulling = vullingSoort(p.vulling);
    const wilRaam = vulling === 'horizontaal' || vulling === 'glas' ? true
        : vulling === 'geen' ? false
        : Boolean(Number(p.vulraamwerk));

    const raamDoos = profielDoos(p.regelProfiel);
    const stripHandmatig = Number(p.stripBreedte) > 0 ? Number(p.stripBreedte) : 0;
    const raam = wilRaam
        ? {
            ...VULRAAMWERK,
            breedte: stripBreedte(staanderBreedte),
            ...(p.raamMaten || {}),
            ...(stripHandmatig ? { breedte: stripHandmatig } : {}),
            // Is er een profiel voor de regel gekozen, dan tellen zijn maten.
            // De catalogus legt de breedte langs X en de hoogte langs Y; een
            // regel ligt plat, dus de HOOGTE van het profiel gaat de diepte in
            // en de BREEDTE wordt de dikte.
            ...(raamDoos ? { dikte: raamDoos[0], breedte: raamDoos[1] } : {}),
        }
        : null;

    // --- het vulveld MIDDEN op de staander ---------------------------------
    //
    // DIT IS TERUGGEDRAAID, en het was mijn eigen fout.
    //
    // Er stond hier dat het vulveld met zijn voorkant VLAK tegen de voorkant
    // van de staander moest. Dat kwam uit een klacht dat de paal er aan voor-
    // en achterkant 5 mm uitstak bij een staander van 40 met een regel van 30.
    //
    // Dat werkt niet, en op een RONDE paal al helemaal niet. Een vlakke strip
    // tegen een cilinder raakt die maar op één lijn, dus je wint er geen
    // gelijkliggend vlak mee - je verliest alleen de symmetrie. Nagemeten op de
    // standaardleuning met CHS 48,3 als staander:
    //
    //     vulregel  hart 5,15 mm uit het hart van de paal
    //     spijl     hart 14,15 mm uit het hart van de paal
    //
    // Veertien millimeter op een paal van 48 is geen afrondverschil maar een
    // scheef vulveld, en zo zag het er ook uit.
    //
    // Nu ligt alles GECENTREERD op de hartlijn van de paal. De paal steekt er
    // dan aan weerszijden even veel uit, en dat is wat een leuning hoort te
    // doen: het paneel zit midden op de paal.
    //
    // Geeft de ligging van de VOORSTE hoek, langs de dwarsrichting gerekend
    // vanaf de hartlijn van het pad.
    const vulveldHoek = (diepte) => -diepte / 2;
    /**
     * Hoe ver het HART van zo'n onderdeel uit het hart van de staander ligt.
     *
     * Nul, sinds alles gecentreerd staat. Blijft een functie omdat het bed voor
     * een vulregel die maat nodig heeft, en omdat dit de plek is waar het staat
     * als het ooit weer anders moet.
     */
    const hartVerschuiving = () => 0;

    // --- uitklinken van de staanderkop -------------------------------------
    //
    // Een uitsparing wordt hier alleen BESCHREVEN, in de assen van de staander
    // zelf; build-balustrade.js snijdt hem er met de doorsnede van het
    // bijbehorende profiel uit. Zo staat de meetkunde op één plek en de OCCT op
    // een andere, net als bij de gaten in de voetplaat.
    const klinkDiepte = Number(p.uitklinken) ? uitklinkDiepte(staanderBreedte) : 0;

    // --- het ZADEL: hoe diep de kop onder de regel duikt -------------------
    //
    // Hoeveel er LOODRECHT op de regel onder zijn bovenkant wordt afgezaagd.
    //
    // Voor een vlakke onderkant - een koker, platstaal, een massief blok - is
    // dat de hele regelhoogte: de kop stopt op het ondervlak en ligt er vlak
    // tegenaan. Klaar, en dat is wat stap 3 al deed.
    //
    // Voor een RONDE regel is dat fout, en dat is precies de klacht die hier al
    // twee keer is langsgekomen. De onderkant van een buis is een cilinder; een
    // vlakke kop raakt die maar op EEN lijn en loopt links en rechts weg. Bij
    // een staander van 40 onder een buis van 48,3 staat de kop aan zijn rand al
    // 10,6 mm van de regel af. Dat is geen lasnaad en het is te zien.
    //
    // De kop hoort er dan OM te vallen: een zadel, bij rond op rond een
    // vismuil. De hoorn naast de buis loopt door tot waar het buisoppervlak het
    // staanderoppervlak raakt. Dat punt ligt, loodrecht gemeten onder de
    // bovenkant van de regel, op
    //
    //     r + wortel(r^2 - min(R, r)^2)
    //
    // met r de halve regelhoogte en R de halve staanderbreedte. Twee limieten
    // om het te controleren:
    //
    //   R = 0     ->  2r, dus de volle regelhoogte: het ondervlak. Een staander
    //                 zonder breedte raakt de buis alleen op de onderste lijn.
    //   R >= r    ->  r, dus de hartlijn van de regel. Daar staat het
    //                 buisoppervlak verticaal; hoger komen zou betekenen dat de
    //                 hoorn naar binnen moet buigen, en dat kan staal niet.
    //
    // Hoger dan de hartlijn komt hij dus nooit, en daarmee steekt de staander
    // ook nooit boven de regel uit - wat punt 1 van de opdracht eist.
    const zadelRond = isRond(p.handregelProfiel);
    const kopOnder = (() => {
        if (!zadelRond) return handregelHoogte;
        const r = handregelHoogte / 2;
        const R = Math.min(staanderBreedte / 2, r);
        return r + Math.sqrt(Math.max(0, r * r - R * R));
    })();

    /**
     * De uitsparingen voor één staander, in de assen van die staander.
     *
     * `langs` wijst van de staander weg, de kant op waar het veld heen loopt.
     * De twee kentallen zijn de componenten op de deelhoek en op de dwarsrichting;
     * in een hoek is dat dus géén as-gerichte richting, en dat hoort ook: daar
     * komt de handregel schuin binnen.
     */
    /**
     * De bovenkant van de bovenregel, boven het pad.
     *
     * NIET gedeeld door de cosinus van de helling, en dat is een correctie.
     *
     * Er stond `hoogte - handregelhoogte / cos - opening`: de opening gemeten
     * vanaf de ONDERKANT van de handregel, en die ligt op een helling
     * handregelhoogte/cos lager in plaats van handregelhoogte. Dat is op
     * zichzelf netter, maar het gaf een KNIK waar een hellend stuk op een vlak
     * stuk uitkomt - bij een trap met een bordes dus. Nagemeten op een helling
     * van 1:2: de bovenregel van het hellende stuk kwam 4,72 mm lager uit dan
     * die van het vlakke stuk, en bij de staander ertussen zag je die stap als
     * een knik in het raamwerk.
     *
     * Nu hangt hij een vaste maat onder de BOVENKANT van de handregel, en die
     * ligt aan weerszijden van zo'n knik op dezelfde hoogte - dat is immers de
     * leuninghoogte. De regels sluiten er dus op aan.
     *
     * Wat het kost: op een helling wordt de opening tot de onderkant van de
     * handregel iets kleiner dan de nominale 150 mm - 145,3 bij 1:2. Dat is
     * 3 % op een maat die in regels.json toch al als aanname staat.
     */
    const raamTopVan = () => p.hoogte - handregelHoogte - raam.opening;

    /**
     * De uitsparingen in een staander: alleen nog voor de VULREGELS.
     *
     * Het bed voor de handregel is hier weg. Dat zat er omdat de regel stomp
     * tegen de staanderzijkant kwam; nu loopt hij over de kop heen, dus er
     * komt geen handregel meer tegen een zijkant aan. De staanderkop sluit op
     * de onderkant van de regel aan (zie regelOnderkant hierboven).
     *
     * Dat haalt tegelijk het zwaarste geval weg waar dit ooit stuk ging: twee
     * handregelbedden onder een hoek in één kop, die bij diepte 0,20 een stuk
     * buiswand lossneden en de staander in twee solids deelden. De
     * vulregelbedden zijn een stuk ondieper en liggen lager in de staander.
     */
    /**
     * De aanliggende velden van staander `i`, in de assen van die staander.
     *
     * `langs` wijst van de staander weg, de kant op waar het veld heen loopt,
     * MET zijn helling erin - niet alleen de horizontale projectie. Hier stond
     * eens `[.., .., 0]`: het bed werd horizontaal in de staander gesneden
     * terwijl de regel schuin binnenkomt. Nagemeten op een helling van 1:2:
     * bedrichting [1, 0, 0] tegen regelrichting [0,894, 0, 0,447]. De regel
     * viel dus niet in zijn bed maar sneed er schuin doorheen - 5459 mm3 staal
     * in staal over zes paren.
     *
     * De twee kentallen zijn de componenten op de deelhoek en op de
     * dwarsrichting; in een hoek is dat dus géén as-gerichte richting, en dat
     * hoort ook: daar komt de regel schuin binnen.
     */
    const veldenBij = (s, i) => {
        const buren = [
            { r: s.naarVolgende, ander: (i + 1) % pad.length },
            { r: s.naarVorige, ander: (i - 1 + pad.length) % pad.length },
        ].filter(b => b.r);

        return buren.map(b => {
            const richting = eenheid(min(pad[b.ander], pad[i]));
            const dwarsVeld = eenheid(kruis(omhoog, richting));
            const opVeld = kruis(richting, dwarsVeld);   // loodrecht, omhoog
            // De assen van de staander zijn orthonormaal - deelhoek en dwars
            // liggen horizontaal, de derde staat recht omhoog - dus de derde
            // component is gewoon de z.
            const lokaal = (w) => [punt(w, s.deelhoek), punt(w, s.dwars), w[2]];
            return {
                langs: lokaal(richting),
                op: lokaal(opVeld),
                cos: vlakLengte(richting),
            };
        });
    };

    /**
     * Het ZADEL in de staanderkop: de handregel zelf eruit snijden.
     *
     * Alleen bij een RONDE regel. Bij een vlakke onderkant stopt de kop al op
     * het ondervlak en ligt hij er vlak tegenaan; er valt dan niets te zadelen
     * en we laten de vorm met opzet onaangeroerd, zodat een koker-op-koker
     * letterlijk dezelfde vorm oplevert als voorheen.
     *
     * De snijder is de ECHTE doorsnede van de handregel op zijn ECHTE plek, dus
     * bij rond op rond wordt het een vismuil. `diepte` is de volle
     * staanderbreedte: de snijder moet er dwars DOORHEEN, niet een bed van een
     * paar millimeter in de zijkant maken.
     *
     * Dit staat los van het vinkje "staanderkop uitklinken". Dat vinkje gaat
     * over de bedden voor de VULREGELS - een keuze. Het zadel is geen keuze:
     * zonder zadel staat de kop in de regel, en dat is geen constructie.
     */
    const zadelVoor = (s, i) => {
        if (!zadelRond) return [];
        // Twee velden die in elkaars VERLENGDE liggen krijgen één zadel. De
        // snijder loopt namelijk naar twee kanten ruim buiten de staander, dus
        // hij snijdt de tunnel al in zijn geheel; een tweede keer snijden langs
        // dezelfde lijn voegt niets toe.
        //
        // Toch niet overslaan maar expliciet: die tweede snede is geen no-op
        // voor OCCT. Nagemeten op een recht stuk met drie staanders - de
        // middenstaander hield er 10,5 mm3 minder van over dan de
        // eindstaanders, terwijl ze dezelfde vorm horen te zijn. Dat is
        // booleaanse ruis van een tangentiële cilindersnede, en genoeg om de
        // controle "allebei de uitsparingen halen evenveel weg" te laten
        // omvallen.
        const gekozen = [];
        for (const v of veldenBij(s, i)) {
            const alEen = gekozen.some(g =>
                lengte(kruis(g.langs, v.langs)) < 1e-9);
            if (!alEen) gekozen.push(v);
        }
        return gekozen.map(v => ({
            langs: v.langs,
            op: v.op,
            // De regel is even diep als de staander en staat dus in het hart.
            opzij: 0,
            // De bovenkant van de snijder valt samen met de bovenkant van de
            // regel. Gerekend vanaf de VOET van de staander, want daar ligt
            // zijn nulpunt.
            top: p.hoogte - plaatDikte,
            breedte: dikte,
            hoogte: handregelHoogte,
            // Dwars er doorheen, niet een bed erin. `diepte` blijft gevuld
            // omdat metUitklinken op diepte > 0 filtert.
            door: true,
            diepte: staanderBreedte,
            // MASSIEF ronde snijder, niet de doorsnede van het profiel. Een
            // CHS-doorsnede is hol: daarmee snijd je een ringvormige tunnel en
            // blijft de kern van de buisholte als los staal in de staander
            // staan. Nagemeten: 2 solids bij een massieve staander, 3 bij een
            // buis, bij élke diepte. De ruimte die een regel inneemt is zijn
            // omhullende. Zie klinkSnijder in build-balustrade.js.
            rond: true,
            // Alleen nog voor de naam in de foutmelding van de bewaking; de
            // vorm van de snijder komt uit `rond` hierboven.
            profiel: p.handregelProfiel,
        }));
    };

    const uitklinkenVoor = (s, i) => {
        const uit = [];

        for (const b of veldenBij(s, i)) {
            const langs = b.langs;
            const op = b.op;
            const cosVeld = b.cos;

            // De twee regels van het vulveld aan die kant.
            //
            // Die kregen eerst geen bed, en dat was te zien: een strip van
            // 30 x 6 met een recht afgezaagd eind tegen een ronde buis van
            // 48,3 raakt die buis op één lijn en loopt links en rechts weg -
            // bij 15 mm uit het hart al 5,2 mm. Precies de aansluitingen die
            // "niet geblend" waren.
            //
            // De sparing is RECHTHOEKIG en niet de doorsnede van het
            // regelprofiel. Een regel ligt namelijk plat: zijn profiel is een
            // kwartslag gedraaid, en de doorsnede uit de catalogus staat
            // rechtop. Breedte x dikte is zijn omhullende doosje, en voor
            // platstaal is dat precies de vorm.
            if (raam) {
                // De bovenkant van elke regel, op de HARTLIJN VAN DE STAANDER.
                //
                // Dat laatste is waar het misging, en het stond er zelfs bij:
                // "verticaal gemeten is dat dikte x cos". Die maat klopt op de
                // plek van de regel zelf, maar het bed wordt gezet ten opzichte
                // van de hartlijn van de paal - en daar kruist datzelfde vlak
                // op een ANDERE hoogte.
                //
                // Een regel is `dikte` dik LOODRECHT op zichzelf, en die
                // loodrechte richting helt achterover. Het bovenvlak schuift
                // daardoor niet alleen omhoog maar ook naar achteren, en waar
                // het de verticale hartlijn kruist zit het
                //
                //     onderkant + dikte / cos        en niet   dikte x cos
                //
                // Op vlak zijn die allebei 1 x dikte, dus daar viel niets te
                // zien. Bij 1:2 met een regel van 6 mm scheelt het 1,3 mm, en
                // dat is precies wat er overbleef: 1462 mm3 staander in
                // vulregel over een hellende leuning met uitklinken aan.
                const opHartlijn = raam.dikte / cosVeld;
                const bovenkanten = [
                    raam.onder + opHartlijn,
                    // De bovenregel: zijn ONDERKANT ligt een verticale dikte
                    // onder raamTop, en daar komt dezelfde maat bovenop.
                    raamTopVan() - raam.dikte * cosVeld + opHartlijn,
                ];
                // HOE VER HET BED EXTRA NAAR BINNEN MOET.
                //
                // De kop van een regel staat haaks op zijn eigen as, en die as
                // helt. Zijn bovenachterhoek ligt daardoor `dikte x sin`
                // verder naar achteren dan zijn onderkant - bij 1:2 met een
                // regel van 6 mm is dat 2,7 mm. Reikt het bed niet zo ver, dan
                // steekt juist die hoek in de paal: nagemeten 115 mm3 per
                // aansluiting. Langs de as van het bed gemeten is het
                // dikte x sin / cos.
                const sinVeld = Math.sqrt(Math.max(0, 1 - cosVeld * cosVeld));
                const bedExtra = raam.dikte * sinVeld / cosVeld;
                for (const bovenkant of bovenkanten) {
                    uit.push({
                        langs, op,
                        // Het vulveld ligt midden op de staander, dus zijn bed
                        // ook. Zie hartVerschuiving hierboven.
                        opzij: hartVerschuiving(),
                        top: bovenkant - plaatDikte,
                        breedte: raam.breedte,
                        hoogte: raam.dikte,
                        diepte: klinkDiepte,
                        // Zie bedExtra hierboven: ruimte voor de schuin
                        // afgezaagde kop van de regel.
                        extra: bedExtra,
                        profiel: null,
                    });
                }
            }
        }
        return uit;
    };

    // --- staanders ---------------------------------------------------------
    // Verticaal, gecentreerd op het punt, bovenop de voetplaat.
    //
    // Elk onderdeel krijgt een GROEPSLABEL mee: bij welke deelsamenstelling het
    // hoort. Dat is alleen een etiket - er verandert niets aan de meetkunde en
    // niets aan de stuklijst. samenstelling.js maakt er de boom van.
    //
    // De indeling volgt die van de HiCAD-voorbeeldbalustrade: een staander is
    // daar een samenstelling (Post), een vulveld ook (Infill), en de handregel
    // hangt er los onder. Zie VERBETERPUNTEN.md punt 1.
    for (const [i, s] of staanders.entries()) {
        const staanderGroep = { soort: 'staander', nummer: i + 1 };
        if (plaatDikte > 0) {
            // De plaat ligt met zijn lange zijde in de looprichting, net als in
            // het voorbeeld (150 langs de leuning, 50 dwars erop).
            const plaatHoek = plus(plus(s.positie, maal(s.deelhoek, -vp.lengte / 2)),
                                   maal(s.dwars, -vp.breedte / 2));
            voetplaatNr[i] = voegToe({
                soort: 'voetplaat', oorsprong: plaatHoek,
                xAs: s.deelhoek, yAs: s.dwars, zAs: omhoog,
                dx: vp.lengte, dy: vp.breedte, dz: plaatDikte,
                // Plaat is geen profiel: je koopt het op dikte en materiaal en
                // snijdt er een vorm uit. Daarom nooit uit de catalogus.
                profiel: null,
                lengteAs: 'x',
                // De gaten, in de maten van de plaat zelf: x langs de lengte,
                // y over de breedte, allebei gerekend vanaf de hoek. De as van
                // elk gat staat loodrecht op de plaat.
                gaten: vp.gat > 0 ? [-1, 1].map(kant => ({
                    x: vp.lengte / 2 + kant * vp.gatAfstand / 2,
                    y: vp.breedte / 2,
                    diameter: vp.gat,
                })) : [],
                groep: staanderGroep,
            });
        }

        const voet = plus(s.positie, maal(omhoog, plaatDikte));
        const hoek = plus(plus(voet, maal(s.deelhoek, -staanderBreedte / 2)),
                          maal(s.dwars, -staanderBreedte / 2));
        // Loopt de regel eroverheen, dan stopt de staander op het ondervlak
        // daarvan. Zie staanderKop hierboven.
        const onderDeRegel = regelOverDeKop(i);
        const kop = onderDeRegel ? staanderKop(s, i) : { top: p.hoogte, vlakken: [] };
        // De snijvlakken in de LOGISCHE assen van de staander: u langs de
        // deelhoek vanaf de hoek van het doosje, v dwars, w omhoog. Het vlak
        // gaat door de onderkant van de regel op de hartlijn; `richting` is de
        // kant die eraf moet, en dat is omhoog langs de normaal.
        const kopVlakken = kop.vlakken.map(lood => {
            const opVlak = plus(plus(s.positie, [0, 0, p.hoogte]),
                                maal(lood, -handregelHoogte));
            const vanHoek = min(opVlak, hoek);
            return {
                punt: [punt(vanHoek, s.deelhoek), punt(vanHoek, s.dwars), vanHoek[2]],
                richting: [punt(lood, s.deelhoek), punt(lood, s.dwars), lood[2]],
            };
        });
        staanderNr[i] = voegToe({
            soort: 'staander', oorsprong: hoek,
            xAs: s.deelhoek, yAs: s.dwars, zAs: omhoog,
            dx: staanderBreedte, dy: staanderBreedte,
            // Tot het HOOGSTE punt dat na het zagen overblijft; de schuine
            // snede hieronder haalt de rest eraf. Zo is dz de echte zaaglengte.
            dz: kop.top - plaatDikte,
            // Op een helling wordt de kop op de hellingshoek afgezaagd. Op een
            // vlak stuk is deze lijst leeg en blijft de vorm precies zoals hij
            // altijd was.
            verstek: kopVlakken,
            // Met een profiel wordt dit geen massief blok maar de doorsnede van
            // dat profiel, op lengte getrokken.
            profiel: p.staanderProfiel || null,
            lengteAs: 'z',        // de lengte van een staander loopt langs zAs
            // Bedden voor de vulregels: een eindstaander krijgt er twee (één
            // vulveld), een midden- of hoekstaander vier. Daarmee zijn het
            // verschillende stukken staal, en splitst de onderdeelherkenning ze
            // vanzelf. Zonder vulraamwerk of met uitklinken uit blijft de lijst
            // leeg, en dan zijn alle staanders van een recht stuk identiek -
            // wat ze sinds de doorlopende handregel ook ECHT zijn: ze stoppen
            // allemaal op de onderkant van de regel.
            uitklinken: klinkDiepte > 0 ? uitklinkenVoor(s, i) : [],
            // APART van `uitklinken`, en niet achter het vinkje. Dat vinkje is
            // een keuze over de bedden voor de vulregels; het zadel is geen
            // keuze, want zonder zadel staat de kop in de regel. Apart houden
            // zodat "hoeveel bedden heeft deze staander" ook blijft betekenen
            // wat het zegt. build-balustrade.js snijdt beide lijsten.
            zadel: onderDeRegel ? zadelVoor(s, i) : [],
            groep: staanderGroep,
        });

        // De kap, bovenop de staander. Niet waar de handregel over de kop
        // loopt: daar ligt de regel erop en zou een kap hem omhoog duwen.
        //
        // Sinds de handregel doorloopt is dat bij ELKE staander het geval, dus
        // er wordt nu nergens meer een kap gebouwd. De kap kwam uit de
        // referentiefoto's, waarop de handregel tússen de palen door loopt en
        // de paal er met een kap bovenuit steekt; die opbouw is met punt 1 van
        // de opdracht vervangen. Het blok blijft staan omdat dit de plek is
        // waar het hoort, niet omdat het nu iets doet. Zie regels.json.
        if (kapDikte > 0 && !onderDeRegel) {
            const kapBreedte = staanderBreedte + 2 * kapOverstek;
            const kapVoet = plus(s.positie, maal(omhoog, p.hoogte));
            delen.push({
                soort: 'paalkap',
                oorsprong: plus(plus(kapVoet, maal(s.deelhoek, -kapBreedte / 2)),
                                maal(s.dwars, -kapBreedte / 2)),
                xAs: s.deelhoek, yAs: s.dwars, zAs: omhoog,
                dx: kapBreedte, dy: kapBreedte, dz: kapDikte,
                // Een kap is geen profiel: het is een plaatje dat je uitsnijdt,
                // net als de voetplaat. Daarom nooit uit de catalogus.
                profiel: null,
                lengteAs: 'z',
                // Op een buis hoort een ronde kap. `rond` laat de bouwer er een
                // cilinder van maken in plaats van een blok; zie maakDeel.
                rond: kapIsRond,
                groep: staanderGroep,
            });
        }

        // --- het sierpunt ---------------------------------------------------
        //
        // WAAROM HIJ OP DE HANDREGEL STAAT EN NIET OP DE STAANDERKOP.
        //
        // Dat was de bedoeling, en het kan niet: de handregel loopt bij deze
        // opbouw over ELKE staanderkop heen - daarom vuurt het kapblok
        // hierboven ook nooit. De kop van de staander ligt per definitie ONDER
        // de regel; daar past niets bovenop zonder de regel omhoog te duwen.
        //
        // Een ornament op de kop vraagt dat de staander boven de handregel
        // uitsteekt, en dan moet de regel in een BED in de zijkant van de paal
        // in plaats van er bovenop te liggen. Dat is een andere constructie dan
        // deze leuning heeft, en die wordt hier niet stilletjes omgebouwd.
        //
        // Wat wel klopt en wel te bouwen is: het ornament bovenop de handregel,
        // recht boven de staander. Zo staat het op een hek ook - de punt staat
        // in lijn met de paal - en de regel blijft doorlopen.
        if (sierpuntModel && sierpuntOp(i)) {
            const voetMaat = staanderBreedte;
            const hoogte = sierpuntHoogte;
            // HET DOOSJE IS BREDER DAN DE VOET, en daar ging het mis.
            //
            // De oorsprong ligt in de HOEK van het omhullende doosje, en dat
            // doosje is maxBreedte keer de voet - bij een staander van 40 dus
            // 58 en niet 40. Er werd maar een halve voetmaat teruggeschoven,
            // zodat het ornament 9 mm scheef op de handregel stond, in beide
            // richtingen. Op de foto was dat goed te zien.
            const doosMaat = voetMaat * SIERPUNT.maxBreedte;
            // Bovenop de handregel: die eindigt op p.hoogte, en op een helling
            // aan de bergkant van de voet hoger. Zie regelTopOnder.
            const kop = plus(s.positie, maal(omhoog,
                regelTopOnder(s, i, voetMaat / 2, isRond(p.staanderProfiel))));
            sierpuntNr[i] = voegToe({
                soort: 'sierpunt',
                oorsprong: plus(plus(kop, maal(s.deelhoek, -doosMaat / 2)),
                                maal(s.dwars, -doosMaat / 2)),
                xAs: s.deelhoek, yAs: s.dwars, zAs: omhoog,
                // Het omhullende doosje. De werkelijke vorm kan smaller zijn;
                // breder dan dit wordt hij niet, en dat wordt nagemeten.
                dx: doosMaat, dy: doosMaat, dz: hoogte,
                lengteAs: 'z',
                // Hieraan ziet maakDeel dat dit geen blok is maar een ornament.
                sierpunt: sierpuntModel,
                sierpuntVoet: voetMaat,
                sierpuntRond: isRond(p.staanderProfiel),
                // Gekocht beslag, net als de glasklem: een sierpunt zaag je
                // niet uit een stang en snijd je niet op de tafel.
                besteld: true,
                groep: staanderGroep,
            });
        }

        // De staander staat OP zijn voetplaat. Vlak op vlak, horizontaal.
        verbind(staanderNr[i], voetplaatNr[i], 'op-plaat', voet, omhoog);
    }

    const aantalVelden = gesloten ? punten.length : punten.length - 1;

    for (let i = 0; i < aantalVelden; i++) {
        const a = i;
        const b = (i + 1) % punten.length;
        const v = veldGegevens(punten[a], punten[b],
            staanders[a].inzetNaarVolgende, staanders[b].inzetNaarVorige);

        // De veiligheidsregel op de HORIZONTALE lengte, met de spijlbreedte die
        // er echt gebouwd wordt - dus uit het profiel als dat gekozen is.
        const maten = { ...p, lengte: v.vrijeLengte, spijlBreedte };
        // Bij een andere vulling staan er geen spijlen, en dan hoort hier geen
        // aantal te staan dat er niet is. Het paneel leest dit uit.
        const spijlen = vulling === 'spijlen' ? berekenSpijlen(maten)
            : { aantal: 0, doorgang: 0, steek: 0, eersteHart: 0 };

        // Het vulveld is één deelsamenstelling: de twee regels en alle spijlen
        // ertussen. Zo kun je zeggen "2x identiek vulveld" in plaats van twaalf
        // losse spijlen op te sommen, en in de werkplaats las je zo'n paneel
        // plat op een bok. De handregel hoort er NIET bij - die loopt over het
        // veld heen en wordt er los op gelegd, net als in het voorbeeld.
        const vulveldGroep = { soort: 'vulveld', nummer: i + 1 };
        // Vastgehouden, want `liggend` kan hier nog niet: daarvoor moet eerst
        // bekend zijn hoe hoog het veld vrij is, en dat wordt verderop pas
        // uitgerekend.
        const veld = {
            index: i,
            randLengte: v.schuineLengte,
            horizontaleLengte: v.horizontaleLengte,
            vrijeLengte: v.vrijeLengte,
            helling: Math.acos(Math.min(1, v.cos)) * 180 / Math.PI,
            spijlen,
            // De stripbreedte die hier ECHT gebouwd wordt, zodat het paneel
            // hem kan laten zien zonder de afleiding over te doen. Dat verschil
            // is in dit project al een keer misgegaan: een paneel dat iets
            // anders voorspelt dan er gebouwd wordt is erger dan geen paneel.
            stripBreedte: raam ? raam.breedte : null,
            vulling,
            // Bij een horizontale vulling: hoeveel liggende regels er tussen
            // de onder- en bovenregel komen, en hoe groot de opening daartussen
            // wordt. Wordt hieronder ingevuld, zodra de vrije hoogte bekend is.
            liggend: null,
            // En bij glas: de bestelmaat van de ruit. Die is groter dan wat je
            // ziet, want hij steekt boven en onder in de klem.
            glas: null,
            klemmen: 0,
        };
        velden.push(veld);

        // Verticale lengte van een spijl: van de rand tot de ONDERKANT van de
        // handregel. Die onderkant loopt evenwijdig aan de bovenkant, loodrecht
        // een regelhoogte eronder; verticaal gemeten is dat regelhoogte/cos.
        // Op een helling is een spijl dus iets korter dan op een vlak stuk.
        //
        // MET een vulraamwerk is dat anders: dan lopen de spijlen niet tot de
        // handregel maar tussen een onder- en een bovenregel. Zie hieronder.
        let spijlVoet = 0;                                  // boven de rand
        let spijlHoogte = p.hoogte - handregelHoogte / v.cos;

        // --- waar een spijl TUSSEN moet vallen -----------------------------
        //
        // Twee evenwijdige vlakken, allebei LOODRECHT op het veld: de bovenkant
        // van de onderregel en de onderkant van de bovenregel. Een spijl staat
        // verticaal en wordt er op de helling tussen afgezaagd.
        //
        // HIER GING HET MIS, en het was op de trap goed te zien. De spijl werd
        // RECHT afgezaagd op een vaste hoogte terwijl die regels schuin liggen,
        // dus stak hij er aan één kant doorheen. Nagemeten op een trap:
        // 10 453 mm3 staal in staal over 60 paren. Op een vlak stuk viel er
        // niets te zien, want daar liggen de regels horizontaal - en daarom
        // heeft geen enkele meting dit eerder gevangen.
        //
        // Er zat bovendien een rekenfout in de lengte: de onderste aftrek was
        // `dikte x cos` waar hij `dikte / cos` moet zijn. Op vlak zijn die
        // allebei 1 x dikte; bij 1:2 scheelt het 2,7 mm. Dat getal verdwijnt nu
        // vanzelf, want de lengte volgt uit de twee vlakken in plaats van uit
        // een optelsom.
        //
        // ZONDER RAAMWERK geldt hetzelfde, en dat was eerst vergeten. Dan loopt
        // de spijl van de rand tot de ONDERKANT VAN DE HANDREGEL, en die ligt
        // op een helling net zo schuin. Een vlakke kop steekt er dan doorheen:
        // nagemeten 12,2 mm3 per spijl op 1:2, en dat werd pas zichtbaar toen
        // het vulveld naar het midden van de paal ging - daarvóór stond de
        // spijl opzij, waar een ronde regel hoger loopt en er dus toevallig
        // ruimte was.
        //
        // De twee vlakken zijn dan: de rand zelf (waar hij op staat) en het
        // raakvlak onder de handregel. Allebei evenwijdig aan het veld, dus
        // dezelfde machinerie werkt.
        let spijlOnderVlak = v.begin;
        let spijlBovenVlak = plus(plus(v.begin, [0, 0, p.hoogte]),
                                  maal(v.loodrecht, -handregelHoogte));

        if (raam) {
            // De bovenregel hangt een vaste opening onder de handregel. Dat is
            // een regel en geen vaste hoogte: bij een andere leuninghoogte of
            // een dikkere handregel moet hij meezakken.
            const raamTop = raamTopVan();
            // Een regel is `dikte` dik LOODRECHT op zichzelf - zo zaag je plat
            // staal ook: je kantelt de strip, hij wordt er niet dunner van.
            // Verticaal gemeten is die dikte dus dikte x cos.
            const verticaleDikte = raam.dikte * v.cos;
            spijlVoet = raam.onder + verticaleDikte;        // bovenop de onderregel
            // tot onder de bovenregel
            spijlHoogte = (raamTop - verticaleDikte) - spijlVoet;

            // De twee vlakken waar de spijl tussen valt, als punt erop. De
            // regels zelf worden hieronder op dezelfde manier gezet: oorsprong
            // op `v.begin + [0,0,onderkant]` en `raam.dikte` dik langs
            // v.loodrecht. De bovenkant van de onderregel ligt dus een dikte
            // langs loodrecht boven zijn oorsprong; de onderkant van de
            // bovenregel is zijn oorsprong zelf.
            spijlOnderVlak = plus(plus(v.begin, [0, 0, raam.onder]),
                                  maal(v.loodrecht, raam.dikte));
            spijlBovenVlak = plus(v.begin, [0, 0, raamTop - verticaleDikte]);

            // De twee regels zelf. Allebei hetzelfde stuk staal, dus de
            // onderdeelherkenning maakt er straks één productieonderdeel van
            // met aantal 2 - precies zoals het in de werkplaats gaat.
            // Net als de handregel zakt een vulregel in zijn bed. Een regel
            // komt ALTIJD aan twee kanten tegen een staander - hij steekt
            // nergens over - dus aan allebei de einden evenveel.
            //
            // Gedeeld door cos: de beddiepte is een HORIZONTALE maat, en langs
            // een helling leg je over een schuine afstand d maar d x cos
            // horizontaal af.
            const regelZakt = klinkDiepte / v.cos;

            // DE KOPPEN VAN EEN REGEL STAAN PLUMB, niet haaks op zijn eigen as.
            //
            // Een staander staat verticaal; een regel die er tegenaan komt moet
            // dus een VERTICAAL kopvlak hebben. Haaks op zijn eigen as afzagen
            // ging mis op een helling: de regel is `dikte` dik LOODRECHT op
            // zichzelf, en die loodrechte richting helt achterover, dus dook
            // zijn bovenachterhoek de paal in. Nagemeten op 1:2 met een regel
            // van 6 mm: precies 6 x sin = 2,68 mm diep, 108 mm3 per aansluiting
            // en 2310 mm3 over een hele trap.
            //
            // Twee EVENWIJDIGE verticale vlakken, dus de lengte langs de as is
            // op elke hoogte gelijk: dat is de zaaglengte. Het blok waar hij uit
            // komt is langer, want de schuine snede moet aan de hoge kant nog
            // materiaal hebben om weg te halen.
            const regelLengte = v.vrijeLengte / v.cos + 2 * regelZakt;
            // ALLEEN waar de regel STOMP tegen de paal komt.
            //
            // Zakt hij in een BED (uitklinken aan), dan hoort zijn kop juist
            // haaks op zijn eigen as te staan: dat bed is met dezelfde
            // oriëntatie uit de paal gesneden en een vierkante kop past er
            // precies in. Een verticale kop steekt er dan onderaan juist
            // uit - nagemeten 1462 mm3 op een hellende leuning, en dat was
            // mijn eigen verbetering die het veroorzaakte.
            const regelHelt = klinkDiepte === 0
                && Math.abs(v.loodrecht[2] - 1) > 1e-12;
            // Hoeveel langer het blok moet zijn: de bovenkant van de regel
            // bereikt het verre vlak pas `dikte x tan` verderop.
            const regelExtra = regelHelt
                ? raam.dikte * Math.abs(punt(v.loodrecht, v.langsVlak)) / v.cos : 0;
            // De twee kopvlakken in de LOGISCHE assen van de regel: u langs
            // zijn as vanaf de oorsprong, v dwars, w loodrecht. Allebei
            // verticaal, dus met langsVlak als normaal.
            const regelVerstek = regelHelt ? [
                { punt: [0, 0, 0],
                  richting: [-punt(v.langsVlak, v.langs), 0,
                             -punt(v.langsVlak, v.loodrecht)] },
                { punt: [regelLengte, 0, 0],
                  richting: [punt(v.langsVlak, v.langs), 0,
                             punt(v.langsVlak, v.loodrecht)] },
            ] : [];

            // DE ONDERKANTEN VAN ALLE LIGGENDE REGELS van dit veld.
            //
            // Bij spijlen zijn dat er twee: de onder- en de bovenregel van het
            // raam. Bij een horizontale vulling komen daar regels tussen, en
            // die worden met DEZELFDE formule verdeeld als de spijlen - alleen
            // dan over de vrije HOOGTE in plaats van over de lengte, en met de
            // dikte van een regel in plaats van de breedte van een spijl.
            //
            // Zie regels.json: in berekenSpijlen staat nergens dat het om een
            // horizontale richting gaat, dus hij klopt onveranderd. Twee
            // formules naast elkaar zouden op een dag uit elkaar gaan lopen.
            const onderkanten = [raam.onder, raamTop - verticaleDikte];
            if (vulling === 'horizontaal' && spijlHoogte > 0) {
                const liggend = {
                    lengte: spijlHoogte,
                    maxDoorgang: VULLING.maxDoorgangHorizontaal,
                    spijlBreedte: verticaleDikte,
                };
                for (const hart of spijlPosities(liggend)) {
                    onderkanten.push(spijlVoet + hart - verticaleDikte / 2);
                }
                // Wat het paneel moet tonen: niet het aantal spijlen, maar het
                // aantal tussenregels en de opening die daartussen overblijft.
                veld.liggend = berekenSpijlen(liggend);
            }

            vulregelNr[i] = [];
            for (const onderkant of onderkanten) {
                const hoek = plus(plus(plus(v.begin, [0, 0, onderkant]),
                                       maal(v.dwars, vulveldHoek(raam.breedte))),
                                  maal(v.langs, -regelZakt));
                vulregelNr[i].push(voegToe({
                    soort: 'vulregel', oorsprong: hoek,
                    groep: vulveldGroep,
                    // zAs LOODRECHT op de regel, niet recht omhoog.
                    //
                    // Met `omhoog` stonden de assen op een helling niet haaks -
                    // gemeten xAs·zAs = 0,447 - en dat kan gp_Trsf niet: die
                    // doet alleen starre verplaatsingen. OCCT maakte er
                    // stilzwijgend een gedraaide balk van in plaats van een
                    // scheefgetrokken, en het verschil was 12,4 mm hoog zonder
                    // dat er iets gemeld werd. Daar kwamen alle overlappingen
                    // op een helling vandaan.
                    //
                    // Loodrecht is trouwens ook de juiste constructie: plat
                    // staal van 6 mm blijft 6 mm dik als je het kantelt.
                    xAs: v.langs, yAs: v.dwars, zAs: v.loodrecht,
                    // Langs de leuning over de volle vrije lengte; op een
                    // helling is dat de schuine maat. Plus wat hij aan
                    // weerszijden in zijn bed zakt, plus het stukje dat de
                    // schuine kopsnede hieronder weer weghaalt.
                    dx: regelLengte + regelExtra,
                    dy: raam.breedte,       // plat liggend: 30 mm de diepte in
                    dz: raam.dikte,         // en 6 mm hoog
                    profiel: p.regelProfiel || null,
                    lengteAs: 'x',          // een regel ligt, net als de handregel
                    verstek: regelVerstek,
                    // De ECHTE zaaglengte: tussen twee evenwijdige verticale
                    // koppen is die op elke hoogte gelijk, en korter dan het
                    // blok waar hij uit gesneden wordt.
                    zaaglengte: regelLengte,
                }));
            }

            // Elke vulregel komt aan ALLEBEI de einden tegen een staander. In
            // een bed als er uitgeklonken wordt, anders stomp ertegenaan.
            const regelSoort = klinkDiepte > 0 ? 'in-bed' : 'stomp';
            for (const nr of vulregelNr[i]) {
                verbind(nr, staanderNr[a], regelSoort, punten[a], v.langs);
                verbind(nr, staanderNr[b], regelSoort, punten[b],
                        maal(v.langs, -1));
            }
        }

        // --- doorgestoken spijlen -------------------------------------------
        //
        // De staaf stopt niet onder de bovenste regel maar loopt er DOORHEEN,
        // tot `spijlOverstek` boven de handregel. Alleen het bovenvlak
        // verschuift; de hele verstekmachinerie hieronder blijft dezelfde.
        //
        // Dat vlak blijft EVENWIJDIG aan de leuning en niet horizontaal. Op een
        // trap staan de punten dan allemaal even ver boven de regel - zoals op
        // de foto van een schuin hek - in plaats van met de leuning mee weg te
        // zakken. `spijlOverstek / cos` is de verticale maat die daarbij hoort;
        // dezelfde omrekening als bij handregelHoogte hierboven.
        if (spijlDoorsteek) {
            spijlBovenVlak = plus(plus(v.begin, [0, 0, p.hoogte]),
                                  maal(v.loodrecht, spijlOverstek));
            spijlHoogte = p.hoogte + spijlOverstek / v.cos - spijlVoet;
        }

        // De VRIJE HOOGTE van het veld: wat een spijl of baluster hier krijgt.
        // Het paneel heeft dit nodig om te kunnen zeggen of een gedraaide
        // baluster hier nog in past, en dat moet uit DEZELFDE berekening komen
        // als waarmee gebouwd wordt - anders belooft het scherm iets anders
        // dan er uit de machine komt.
        veld.vrijeHoogte = spijlHoogte;

        /**
         * De hoogte waarop een VERTICALE lijn door `q` het vlak door `p` snijdt.
         *
         * `n` is de normaal van het vlak; zijn z-component is de cosinus van de
         * helling en dus nooit nul. Hiermee is uit te rekenen waar een
         * rechtopstaande spijl een schuin liggende regel raakt - op elk punt
         * van zijn doorsnede apart, en dat is precies waar het om gaat.
         */
        const vlakHoogte = (pOp, n, q) =>
            pOp[2] + ((pOp[0] - q[0]) * n[0] + (pOp[1] - q[1]) * n[1]) / n[2];

        // --- een glazen ruit ------------------------------------------------
        //
        // Eén plaat per veld, tussen de twee regels en tussen de twee
        // staanders, met rondom speling. Dat laatste is geen netheid: glas kan
        // geen kracht in zijn rand hebben. Klem je een ruit strak in een stalen
        // raam, dan springt hij bij de eerste warme dag.
        //
        // De ruit STEEKT IN DE KLEM aan boven- en onderkant. Die inklemming
        // hoort wel bij de bestelmaat maar niet bij wat je ziet, dus hij wordt
        // hier bij de hoogte opgeteld nadat de vrije opening is bepaald.
        if (vulling === 'glas' && spijlHoogte > 0) {
            const vrij = spijlHoogte - 2 * GLAS.speling;
            const ruitHoogte = vrij + 2 * GLAS.inklemming;
            const onder = spijlVoet + GLAS.speling - GLAS.inklemming;

            // Waar de ruit dwars op het veld komt te liggen: naast het
            // raamwerk, met de binnenwang van de klem en een rubber ertussen.
            // Staat hier en niet verderop, want de hoekcorrectie hieronder
            // heeft deze maat nodig.
            const klem = GLAS.klem;
            const binnenwang = raam.breedte / 2;          // tegen de regel aan
            const glasVanaf = binnenwang + klem.wang + GLAS.rubber;

            // IN EEN HOEK MOET DE RUIT VERDER TERUG dan de vrije lengte zegt.
            //
            // Die vrije lengte is gemeten op de HARTLIJN van het veld, maar de
            // ruit ligt daar een stuk naast - hij staat tegen het raamwerk
            // aan. Twee ruiten die elk tot aan hun eigen hartlijn doorlopen
            // snijden elkaar daardoor in de hoek: gemeten 14 583 mm3 bij 90
            // graden, en 119 199 bij 135.
            //
            // Hoeveel verder: de ruit ligt `glasVanaf` naast de hartlijn, en
            // het vlak waarin beide ruiten elkaar raken is de deelhoek van de
            // hoekstaander. Dat geeft glasVanaf x tan(hoek tussen veld en
            // deelhoek) - bij 90 graden is die hoek 45 en dus precies
            // glasVanaf, en aan een vrij uiteinde is hij 0 en verandert er
            // niets.
            const terug = (staander, richting) => {
                if (!staander || !richting) return 0;
                const c = Math.abs(punt(richting, staander.deelhoek));
                if (!(c > 1e-9)) return 0;
                return glasVanaf * Math.sqrt(Math.max(0, 1 - c * c)) / c;
            };
            const terugA = terug(staanders[a], staanders[a].naarVorige);
            const terugB = terug(staanders[b], staanders[b].naarVolgende);
            const ruitLengte = v.vrijeLengte / v.cos
                - 2 * GLAS.speling - terugA - terugB;

            // DE RUIT STAAT NAAST HET RAAMWERK, niet op het hart ervan.
            //
            // Eerst stond hij wél op het hart, net als de spijlen - en toen
            // stak hij dwars door de onder- en de bovenregel heen: 240 421 mm3
            // glas in staal. Dat is ook geen detail van de tekening maar van
            // de constructie: een ruit gaat niet TUSSEN de regels maar wordt
            // er met klemmen TEGENAAN gezet. Daar steekt hij boven en onder
            // overheen, en juist dat stuk zit in de klem.
            //
            // Vandaar deze plek: naast de regel, met de binnenwang van de klem
            // en een rubber ertussen. (glasVanaf staat hierboven.)
            const hoek = plus(plus(plus(v.begin, [0, 0, onder]),
                                   maal(v.dwars, glasVanaf)),
                              maal(v.langs, GLAS.speling + terugA));
            // OP EEN HELLING STAAN DE KOPPEN VAN DE RUIT RECHTOP, niet haaks
            // op zijn eigen as.
            //
            // De ruit ligt in het hellingsvlak, dus zijn uiteinden staan
            // schuin - maar de staanders ernaast staan recht. De bovenhoek aan
            // de hoge kant dook daardoor in de paal: gemeten 63 891 mm3 bij
            // 1:2. Op een vlak stuk viel er niets te zien, want daar is schuin
            // en recht hetzelfde; daarom kwam dit pas boven bij de helling.
            //
            // Dezelfde machinerie als bij de vulregel hierboven, alleen gaat
            // het hier om de HOOGTE van de ruit in plaats van de dikte van een
            // strip - en die is 728 in plaats van 6, dus het scheelt een stuk
            // meer. Het blok wordt zoveel langer gesneden dat de rechte snede
            // nog materiaal heeft om weg te halen; wat overblijft is een
            // parallellogram, en zo ziet een ruit in een trapleuning er ook uit.
            const glasHelt = Math.abs(v.loodrecht[2] - 1) > 1e-12;
            const glasExtra = glasHelt
                ? ruitHoogte * Math.abs(punt(v.loodrecht, v.langsVlak)) / v.cos : 0;
            const glasVerstek = glasHelt ? [
                { punt: [0, 0, 0],
                  richting: [-punt(v.langsVlak, v.langs), 0,
                             -punt(v.langsVlak, v.loodrecht)] },
                { punt: [ruitLengte, 0, 0],
                  richting: [punt(v.langsVlak, v.langs), 0,
                             punt(v.langsVlak, v.loodrecht)] },
            ] : [];

            veld.glas = { lengte: ruitLengte, hoogte: ruitHoogte,
                          vrijeHoogte: vrij, dikte: GLAS.dikte };
            voegToe({
                soort: 'ruit', oorsprong: hoek,
                groep: vulveldGroep,
                xAs: v.langs, yAs: v.dwars, zAs: v.loodrecht,
                dx: ruitLengte + glasExtra, dy: GLAS.dikte, dz: ruitHoogte,
                lengteAs: 'x',
                verstek: glasVerstek,
                // De maat waarop je hem bestelt: de ruit zelf, niet het blok
                // waar de schuine sneden uit gehaald worden.
                zaaglengte: ruitLengte,
                // HET MATERIAAL MAAKT HET VERSCHIL. Hieraan hangt niet alleen
                // de kleur in beeld: de zaaglijst en de DXF slaan een ruit
                // over, want glas wordt niet gezaagd en niet gesneden maar op
                // maat besteld.
                materiaal: 'glas',
            });

            // --- de klemmen ---------------------------------------------
            //
            // Twee per rand, op een kwart en op driekwart van het veld. Elk is
            // TWEE WANGEN met de ruit ertussen: zo ziet een glasklem er in het
            // echt uit, en een massief blok zou dwars door het glas staan.
            //
            // Verticaal op het hart van de regel waar hij aan vastzit, want
            // daar wordt hij doorheen geschroefd.
            const buitenwang = glasVanaf + GLAS.dikte + GLAS.rubber;
            // DE HOOGTE VAN DE TWEE REGELS, uit wat hier in scope is.
            //
            // `raamTop` en `verticaleDikte` staan binnen het `if (raam)`-blok
            // hierboven en bestaan hier niet - daar liep de bouw op vast, met
            // een leeg paneel en een model dat niet kwam. Maar het staat er
            // wel al in: spijlVoet ligt op de bovenkant van de onderregel en
            // spijlVoet + spijlHoogte op de onderkant van de bovenregel. Het
            // hart van elke regel is daar een halve dikte vandaan.
            const vDikte = raam.dikte * v.cos;
            for (const [naam, hartZ] of [
                ['onder', spijlVoet - vDikte / 2],
                ['boven', spijlVoet + spijlHoogte + vDikte / 2],
            ]) {
                for (let k = 1; k <= klem.perRand; k++) {
                    const langsOp = ruitLengte * (2 * k - 1) / (2 * klem.perRand)
                        - klem.breedte / 2 + GLAS.speling;
                    for (const dwarsOp of [binnenwang, buitenwang]) {
                        voegToe({
                            soort: 'glasklem',
                            oorsprong: plus(
                                plus(plus(v.begin, [0, 0, hartZ - klem.hoogte / 2]),
                                     maal(v.dwars, dwarsOp)),
                                maal(v.langs, langsOp)),
                            groep: vulveldGroep,
                            xAs: v.langs, yAs: v.dwars, zAs: v.loodrecht,
                            dx: klem.breedte, dy: klem.wang, dz: klem.hoogte,
                            lengteAs: 'x',
                            klemRand: naam,
                            // GEKOCHT BESLAG, net als de bouten. Een glasklem
                            // zaag je niet uit een stang en snijd je niet op
                            // de tafel; die bestel je bij de leverancier van
                            // het glasbeslag. Zonder dit zou de zaaglijst 24
                            // blokjes van 50 mm op een stang van 6 meter gaan
                            // inplannen.
                            besteld: true,
                        });
                    }
                }
            }
            veld.klemmen = klem.perRand * 2 * 2;   // twee randen, twee wangen
        }

        // Alleen bij een spijlenvulling. Bij horizontale regels zit de vulling
        // in de regels hierboven, bij glas in de ruit, en bij 'geen' is er
        // niets te plaatsen.
        for (const hart of vulling === 'spijlen' ? spijlPosities(maten) : []) {
            // `hart` is een HORIZONTALE afstand; langs de rand is dat hart/cos.
            const voet = plus(plus(v.begin, maal(v.langs, hart / v.cos)),
                              [0, 0, spijlVoet]);
            // Gecentreerd op het hart: een halve breedte langs de leuning terug
            // en een halve diepte dwars erop. Bij een strip zijn dat twee
            // verschillende maten, bij een vierkant profiel dezelfde.
            const hoek = plus(plus(voet, maal(v.langsVlak, -spijlBreedte / 2)),
                              maal(v.dwars, vulveldHoek(spijlDiepte)));
            // De HARTLIJN van de staaf. `voet` ligt al op het hart in de
            // lengterichting, maar dwars staat het vulveld uit het midden -
            // vandaar dezelfde verschuiving als bij `hoek`, plus een halve
            // diepte. Nodig voor de gaten in de regels en voor de punt erop.
            const spijlHart = plus(voet,
                maal(v.dwars, vulveldHoek(spijlDiepte) + spijlDiepte / 2));
            // Waar deze staaf ophoudt, gemeten op zijn eigen hartlijn.
            const spijlTopZ = vlakHoogte(spijlBovenVlak, v.loodrecht, spijlHart);

            // Op een helling wordt de spijl aan ALLEBEI de einden schuin
            // afgezaagd, evenwijdig aan de regels waar hij tussen valt. Recht
            // afzagen gaf 10 453 mm3 staal in staal op een trap; zie de
            // opmerking bij spijlOnderVlak hierboven.
            //
            // De twee vlakken zijn EVENWIJDIG, dus de spijl heeft op elk punt
            // van zijn doorsnede dezelfde lengte - en dat is de zaaglengte.
            // Het BLOK waar hij uit gesneden wordt is hoger: de schuine snede
            // moet aan de hoge kant nog materiaal hebben om weg te halen.
            let spijlHoek = hoek, spijlDz = spijlHoogte, spijlZaag = spijlHoogte;
            const spijlVerstek = [];
            if (spijlOnderVlak && Math.abs(v.loodrecht[2] - 1) > 1e-12) {
                // De vier hoekpunten van de voetafdruk, horizontaal.
                const hoeken = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) =>
                    plus(plus(hoek, maal(v.langsVlak, a * spijlBreedte)),
                         maal(v.dwars, b * spijlDiepte)));
                const laag = hoeken.map(q => vlakHoogte(spijlOnderVlak, v.loodrecht, q));
                // STEEKT DE STAAF EROVERHEEN, dan wordt zijn kop RECHT
                // afgezaagd en niet schuin. Boven de regel zit niets meer waar
                // hij tegenaan moet passen, en de punt die erop komt staat
                // rechtop - die hoort op een vlakke kop te staan en niet op een
                // schuin afgezaagde. Dat is ook op de foto van een schuin hek te
                // zien: de regel helt, de punten staan loodrecht.
                const hoog = spijlDoorsteek
                    ? hoeken.map(() => spijlTopZ)
                    : hoeken.map(q => vlakHoogte(spijlBovenVlak, v.loodrecht, q));
                const onderkant = Math.min(...laag);
                const bovenkant = Math.max(...hoog);
                spijlDz = bovenkant - onderkant;
                // Evenwijdige vlakken: op elk hoekpunt dezelfde maat. Met een
                // rechte kop zijn ze NIET evenwijdig; dan is de zaaglengte de
                // langste zijde, en dat is precies het hele blok.
                spijlZaag = spijlDoorsteek ? spijlDz : hoog[0] - laag[0];
                spijlHoek = [hoek[0], hoek[1], onderkant];
                // In de LOGISCHE assen van de spijl: u langs langsVlak vanaf de
                // hoek, v langs dwars, w omhoog. `richting` is de kant die eraf
                // moet: onderaan naar beneden, bovenaan naar boven.
                const naarAssen = (w, teken) => [
                    teken * punt(w, v.langsVlak), teken * punt(w, v.dwars),
                    teken * w[2]];
                const inAssen = (P) => {
                    const d = min(P, spijlHoek);
                    return [punt(d, v.langsVlak), punt(d, v.dwars), d[2]];
                };
                spijlVerstek.push({ punt: inAssen(spijlOnderVlak),
                                    richting: naarAssen(v.loodrecht, -1) });
                // Alleen een schuine kop als hij er TUSSEN moet passen. Steekt
                // hij erdoorheen, dan is het blok hierboven al op de rechte
                // kophoogte gebouwd en zou een tweede snede er nog eens een wig
                // afhalen.
                if (!spijlDoorsteek) {
                    spijlVerstek.push({ punt: inAssen(spijlBovenVlak),
                                        richting: naarAssen(v.loodrecht, 1) });
                }
            }

            (spijlNr[i] = spijlNr[i] || []).push(voegToe({
                soort: 'spijl', oorsprong: spijlHoek,
                groep: vulveldGroep,
                xAs: v.langsVlak, yAs: v.dwars, zAs: omhoog,
                dx: spijlBreedte, dy: spijlDiepte, dz: spijlDz,
                // Een gedraaide baluster heeft geen stalen profiel: hij IS de
                // vorm. De bouwer ziet aan `baluster` dat hij de draaibank
                // moet pakken in plaats van een staaf uit de catalogus.
                profiel: balusterModel ? null : (p.spijlProfiel || null),
                ...(balusterModel ? {
                    baluster: balusterModel,
                    // ALLEEN BIJ EEN BALUSTER. Zou dit veld ook op een rechte
                    // spijl gelegd worden, dan werd een stalen staaf stilletjes
                    // van steen - en dat staat dan zo in de stuklijst.
                    materiaal: p.spijlMateriaal || 'steen',
                    // Gekocht of besteld werk, net als de glasklem en het
                    // sierpunt: een gedraaide baluster zaag je niet uit een
                    // stang van zes meter. Zonder dit zou de zaaglijst er
                    // zevenentwintig stuks van gaan inplannen.
                    besteld: true,
                } : {}),
                lengteAs: 'z',      // een spijl staat rechtop, net als een staander
                verstek: spijlVerstek,
                // De ECHTE zaaglengte. Die is kleiner dan het blok waar hij uit
                // komt: twee evenwijdige schuine sneden halen aan elke kant een
                // wig weg. Zonder dit zou de stuklijst een paar millimeter te
                // lang bestellen.
                zaaglengte: spijlZaag,
            }));

            // --- erdoorheen, en er een punt op --------------------------------
            if (spijlDoorsteek) {
                const gat = {
                    langs: omhoog, breedteAs: v.langsVlak,
                    breedte: spijlBreedte, diepte: spijlDiepte,
                    // Een ronde staaf vraagt een rond gat. De OMHULLENDE maat,
                    // niet de wanddoorsnede - zie metDoorsteken.
                    rond: isRond(p.spijlProfiel),
                };
                // Door de BOVENREGEL van het vulraamwerk. Die staat er al - hij
                // wordt verderop in deze lus gebouwd - dus het gat kan er nu bij.
                // `onderkanten[1]` is de bovenregel; zie waar ze gemaakt worden.
                if (vulregelNr[i] && vulregelNr[i].length > 1) {
                    boorDoor(delen[vulregelNr[i][1]], spijlHart, gat);
                }
                // De handregel loopt over meerdere velden en wordt pas NA deze
                // lus gebouwd. Daar worden de gaten erin gezet.
                doorsteekSpijlen.push({ hart: spijlHart, gat });

                // DE PUNT OP DE STAAF, en die volgt de SPIJLBREEDTE en niet de
                // staanderbreedte. Een speerpunt op een staaf van 20 mm wordt
                // 86 mm; dezelfde punt op de paal van 40 wordt 172. Zet je ze
                // allebei op de paalmaat, dan staat er een kolos op een staafje.
                if (spijlSierpunt) {
                    const voetMaat = Math.max(spijlBreedte, spijlDiepte);
                    const doosMaat = voetMaat * SIERPUNT.maxBreedte;
                    const puntHoogte = hoogteVoor(modelVan(spijlSierpunt), voetMaat);
                    const kop = [spijlHart[0], spijlHart[1], spijlTopZ];
                    voegToe({
                        soort: 'sierpunt',
                        oorsprong: plus(plus(kop, maal(v.langsVlak, -doosMaat / 2)),
                                        maal(v.dwars, -doosMaat / 2)),
                        xAs: v.langsVlak, yAs: v.dwars, zAs: omhoog,
                        dx: doosMaat, dy: doosMaat, dz: puntHoogte,
                        lengteAs: 'z',
                        sierpunt: spijlSierpunt,
                        sierpuntVoet: voetMaat,
                        sierpuntRond: isRond(p.spijlProfiel),
                        // Gekocht beslag, net als de punt op de paal.
                        besteld: true,
                        // Hoort bij het vulveld: je last de punten erop terwijl
                        // het paneel nog plat op de bok ligt.
                        groep: vulveldGroep,
                    });
                }
            }
        }

        // Elke spijl klemt TUSSEN de twee vulregels. Zonder vulraamwerk staat
        // hij tussen de vloer en de handregel; die laatste is een doorlopend
        // stuk en wordt hieronder verbonden, als de stukken bekend zijn.
        //
        // STEEKT HIJ ERDOORHEEN, dan is 'tussen' niet waar: hij zit dan niet
        // ingeklemd maar gaat door een gat in de bovenregel. Dat verschil hoort
        // in de verbinding te staan en niet alleen in de meetkunde - dat is de
        // hele reden dat deze lijst bestaat.
        if (vulregelNr[i]) {
            for (const sn of spijlNr[i] || []) {
                for (const [k, rn] of vulregelNr[i].entries()) {
                    const soort = (spijlDoorsteek && k === 1) ? 'doorheen' : 'tussen';
                    verbind(sn, rn, soort, delen[sn].oorsprong, omhoog);
                }
            }
        }
    }

    // --- handregels: EEN stuk per doorlopend deel van het pad ---------------
    //
    // Dit stond eerst IN de veldlus hierboven: één handregel per veld, dus bij
    // een balustrade van 2000 mm drie stukjes van 746 + 626 + 746. Nu loopt hij
    // over de tussenstaanders heen en is het één stuk van 2200 mm. Zie
    // handregelStukken voor waar hij wél geknipt wordt, en waarom dat met
    // verstek kan zonder dat de stuklijst materiaal dubbel telt.
    const handregelNr = [];      // per doorlopend stuk
    const stukken = handregelStukken(punten, gesloten);
    for (const stuk of stukken) {
        const A = punten[stuk.begin];
        const B = punten[stuk.eind];
        // Inzet 0: een stuk loopt van HART tot HART van de buitenste staanders
        // van dat stuk, en niet van binnenvlak tot binnenvlak zoals een veld.
        const r = veldGegevens(A, B, 0, 0);
        // Kan niet gebeuren bij een geldig pad; nooit door nul rekenen.
        if (r.schuineLengte < 1e-9) continue;

        // De bovenkant van de handregel ligt `hoogte` boven het pad, VERTICAAL
        // gemeten - zo bepaal je een leuninghoogte. Dit punt is ook precies
        // waar het verstekvlak door gaat; zie handregelStukken.
        const bovenA = plus(A, [0, 0, p.hoogte]);

        /**
         * Hoe ver het stuk langs zijn as buiten het staanderhart doorloopt om
         * het verstek te kunnen zagen.
         *
         * Het verstekvlak gaat door de bovenkant van de regel, dus op de
         * BOVENSTE hoeklijn valt de snede precies op het hart. Lager in de
         * doorsnede schuift hij op, en hoeveel volgt uit de doorsnede-maten:
         *
         *     (dikte/2) * |dwars . n|      zijwaarts, bij een hoek in het vlak
         *     hoogte    * max(0, ±loodrecht . n)   omlaag, bij een knik
         *
         * allebei gedeeld door langs . n, want zo ver schuift de snede langs de
         * as op. `kant` is +1 aan het eind van het stuk en -1 aan het begin:
         * aan het ene eind steekt de ONDERkant verder door, aan het andere de
         * bovenkant, en dat hangt van het teken van loodrecht . n af.
         *
         * Zo is dx precies de LANGE zijde van het verstek - de maat die de
         * zager nodig heeft - en niet een ruime lengte waar nog iets af moet.
         */
        const verstekUitloop = (n, kant) => {
            const langsN = punt(r.langs, n);
            if (langsN < 1e-9) return 0;
            const opzij = (dikte / 2) * Math.abs(punt(r.dwars, n));
            const omlaag = handregelHoogte
                * Math.max(0, kant * punt(r.loodrecht, n));
            return (opzij + omlaag) / langsN;
        };

        // Overstek aan een VRIJ uiteinde. In de HiCAD-voorbeeldbalustrade
        // steekt de handregel 100 mm voorbij de buitenste staanders uit. Twee
        // redenen: je hand glijdt langs de leuning en moet niet precies bij de
        // staander tegen een dop lopen, en een regel die exact op de staander
        // stopt ziet eruit alsof er een stuk is afgezaagd.
        //
        // Een HORIZONTALE maat vanaf het staanderhart, dus langs een schuine
        // rail is dat overstek/cos. Overstek 0 betekent "geen overstek": dan
        // eindigt de regel op het hart van de buitenste staander.
        const vrijUit = overstek > 0 ? overstek / r.cos : 0;
        const uitBegin = stuk.beginVrij ? vrijUit
            : verstekUitloop(stuk.beginNormaal, -1);
        const uitEind = stuk.eindVrij ? vrijUit
            : verstekUitloop(stuk.eindNormaal, 1);

        // We hangen hem op aan zijn BOVENKANT, want dat is de maat die telt.
        const regelHoek = plus(
            plus(plus(bovenA, maal(r.loodrecht, -handregelHoogte)),
                 maal(r.dwars, -dikte / 2)),
            maal(r.langs, -uitBegin));

        // Het verstek, in de LOGISCHE assen van dit onderdeel: u langs xAs
        // vanaf de oorsprong, v langs yAs, w langs zAs. Beide vlakken gaan
        // door de bovenste hartlijn, dus v = dikte/2 en w = handregelHoogte;
        // alleen de plek langs de as verschilt.
        //
        // `richting` is de kant die WEG moet. Aan het eind is dat +n (daar
        // bewaren we n.(X-P) <= 0), aan het begin -n. Zie handregelStukken.
        const naarAssen = (w, teken) => [teken * punt(w, r.langs),
                                         teken * punt(w, r.dwars),
                                         teken * punt(w, r.loodrecht)];
        const verstek = [];
        if (!stuk.beginVrij) {
            verstek.push({
                punt: [uitBegin, dikte / 2, handregelHoogte],
                richting: naarAssen(stuk.beginNormaal, -1),
            });
        }
        if (!stuk.eindVrij) {
            verstek.push({
                punt: [uitBegin + r.schuineLengte, dikte / 2, handregelHoogte],
                richting: naarAssen(stuk.eindNormaal, 1),
            });
        }

        const nr = voegToe({
            soort: 'handregel', oorsprong: regelHoek,
            xAs: r.langs, yAs: r.dwars, zAs: r.loodrecht,
            dx: r.schuineLengte + uitBegin + uitEind,
            dy: dikte, dz: handregelHoogte,
            // De handregel LIGT, dus zijn lengte loopt langs xAs. Bij de
            // staander is dat zAs. Dat verschil is precies waarom er een
            // lengteAs in staat en niet stilzwijgend "de langste maat".
            profiel: dekbandModel ? null : (p.handregelProfiel || null),
            ...(dekbandModel ? {
                dekband: dekbandModel,
                // Een stenen dekband wordt besteld of gegoten, niet uit een
                // stang gezaagd. Zelfde spoor als de balusters en de klemmen.
                besteld: p.handregelMateriaal === 'steen',
                materiaal: p.handregelMateriaal || 'steen',
            } : {}),
            lengteAs: 'x',
            verstek,
        });
        handregelNr.push(nr);

        // DE GATEN VOOR DE DOORGESTOKEN SPIJLEN.
        //
        // Hier en niet in de veldenlus, want een handregel is ÉÉN doorlopend
        // stuk over meerdere velden. Elke spijl van de hele leuning wordt
        // aangeboden; `boorDoor` laat vanzelf vallen wat buiten dit stuk valt.
        for (const s of doorsteekSpijlen) boorDoor(delen[nr], s.hart, s.gat);

        // Hij LIGT OP elke staander die hij overspant. Dat zijn de uiteinden
        // van alle velden in dit stuk - een tussenstaander zit er dus ook bij,
        // en juist die is de reden dat deze lijst bestaat: bij een te smalle
        // handregel steekt zo'n paal er naast uit, en dat is nergens te zien
        // zolang niemand heeft opgeschreven dat ze bij elkaar horen.
        const dragers = new Set();
        for (const veld of stuk.velden) {
            dragers.add(veld);
            dragers.add((veld + 1) % punten.length);
        }
        for (const i of dragers) {
            verbind(nr, staanderNr[i], 'ligt-op', punten[i], r.langs);
        }

        // Zonder vulraamwerk lopen de spijlen door tot ONDER de handregel, of
        // er met een overstek DOORHEEN. Met raamwerk raken ze de handregel
        // alleen als ze erdoorheen steken.
        if (!raam || spijlDoorsteek) {
            const soort = spijlDoorsteek ? 'doorheen' : 'tussen';
            for (const veld of stuk.velden) {
                for (const sn of spijlNr[veld] || []) {
                    verbind(sn, nr, soort, delen[sn].oorsprong, omhoog);
                }
            }
        }
    }

    // Twee doorlopende stukken komen in een hoek of een knik op VERSTEK bij
    // elkaar. Stuk k sluit aan op stuk k+1; bij een gesloten ronde sluit de
    // laatste weer op de eerste aan.
    for (let k = 0; k < stukken.length; k++) {
        const volgende = (k + 1) % stukken.length;
        if (stukken[k].eindVrij || volgende === k) continue;
        verbind(handregelNr[k], handregelNr[volgende], 'verstek',
                punten[stukken[k].eind], stukken[k].eindNormaal);
    }

    // De afwerking en het metaal in één keer op alles stempelen in plaats van
    // bij elk onderdeel apart. Het is één keuze voor het hele werk - een
    // leuning wordt in één kleur gepoedercoat - en zo kan er geen onderdeel
    // vergeten worden.
    // materialen.js haalt hem er weer af waar hij niet kan, zoals op hout.
    stempelWerk(delen, p);

    return { delen, velden, staanders, verbindingen };
}

/**
 * Schuift een heel pad evenwijdig opzij.
 *
 * Nodig om een leuning NAAST een rand te zetten in plaats van erop - bij een
 * trapboom bijvoorbeeld, waar de leuning aan de buitenkant hoort.
 *
 * Bij een recht stuk is het simpel: elk punt een afstand d langs de normaal.
 * In een HOEK is dat fout. Daar moet het punt verder opschuiven, anders raakt
 * het verschoven pad niet meer evenwijdig:
 *
 *        origineel        verschoven (fout)     verschoven (goed)
 *        ___                ___                    ___
 *       |                  |                      |
 *       |                  |  <- gat              |
 *
 * Het punt schuift langs de deelhoek, over d gedeeld door de component van de
 * deelhoek langs de normaal. Bij 90 graden is dat d maal wortel 2.
 *
 * Een positieve afstand schuift naar een kant, een negatieve naar de andere.
 * Welke kant dat is hangt af van de looprichting van het pad, en die hangt af
 * van de volgorde waarin de randen zijn aangeklikt - dus dat is iets om uit te
 * proberen, niet om vooraf te weten.
 */
export function verschuifPad(punten, gesloten, afstand) {
    if (!afstand) return punten;

    const omhoog = [0, 0, 1];
    const aantal = punten.length;
    const richtingNaar = (i, j) => {
        const d = vlak(min(punten[j], punten[i]));
        return maal(d, 1 / vlakLengte(d));
    };

    return punten.map((V, i) => {
        const vorige = i > 0 ? i - 1 : (gesloten ? aantal - 1 : null);
        const volgende = i < aantal - 1 ? i + 1 : (gesloten ? 0 : null);
        const naarVolgende = volgende !== null ? richtingNaar(i, volgende) : null;
        const naarVorige = vorige !== null ? richtingNaar(i, vorige) : null;

        // De normaal van het pad, altijd aan dezelfde kant van de looprichting.
        const langs = naarVolgende || maal(naarVorige, -1);
        const normaal = eenheid(kruis(omhoog, langs));

        if (naarVolgende && naarVorige) {
            const som = plus(naarVolgende, naarVorige);
            if (lengte(som) > 1e-6) {
                const deelhoek = eenheid(som);
                const component = punt(deelhoek, normaal);
                if (Math.abs(component) > 1e-6) {
                    return plus(V, maal(deelhoek, afstand / component));
                }
            }
        }
        // Uiteinde, of twee randen in elkaars verlengde: gewoon langs de normaal.
        return plus(V, maal(normaal, afstand));
    });
}

/** Controleert of een pad met deze maten te bouwen is. */
export function beoordeelPad(punten, gesloten, p, minVeldLengte) {
    const { velden } = padDelen(punten, gesloten, p);
    for (const v of velden) {
        if (v.vrijeLengte < minVeldLengte) {
            return {
                fout: `Veld ${v.index + 1} is na aftrek van de staanders nog `
                    + `${Math.round(v.vrijeLengte)} mm; het minimum is ${minVeldLengte} mm.`,
            };
        }
    }
    return { velden };
}
