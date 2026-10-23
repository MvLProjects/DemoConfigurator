// Sierpunten en paalkoppen: de decoratieve kop op een staander.
//
// WAAR DE VORMEN VANDAAN KOMEN. Twee leveranciersoverzichten zijn bekeken:
// geran.nl (paalkoppen) en consepto.nl (sierpunten). Daar komen de FAMILIES
// vandaan - dennenappel, bol, punt, speerpunt op klosvoet, gelepelde punt,
// kogel op spil, Franse lelie - en bij Geran ook de voetmaten: rond Ø28 tot
// Ø100, vierkant 25x25 tot 100x100.
//
// WAT ER NIET VANDAAN KOMT ZIJN DE HOOGTES. Geran noemt er bijna geen, en
// Consepto schrijft er zelfs bij dat de getoonde producten illustratief zijn.
// Er staan twee maten op de pagina waar wel een hoogte in zit:
//
//     K5050  130 x 70 x 55   hoogte 130, body Ø70, voet 55
//     K5060  160 x 85 x 80   hoogte 160, body Ø85, voet 80
//
// Daar volgt uit: hoogte ongeveer 2,0 tot 2,4 keer de voet, body 1,05 tot 1,3
// keer de voet. Die twee verhoudingen zijn de basis voor alle modellen
// hieronder. ELKE andere verhouding hier is een KEUZE van mij op basis van de
// afbeeldingen, geen opgegeven maat - en de gebruiker kan hoogte en breedte
// zelf bijstellen. Er wordt niets nagemaakt: dit is eigen meetkunde op
// algemene vormen, geen gekopieerd model.
//
// GEEN NIEUWE TECHNIEK. Alles wordt gebouwd met wat er al is - de OCCT die de
// app toch al laadt. Nagemeten welke bouwers in deze bouw aanroepbaar zijn:
//
//     BRepPrimAPI_MakeSphere_1(R)                een bol
//     BRepPrimAPI_MakeCone_1(R1, R2, H)          een (afgeknotte) kegel
//     BRepPrimAPI_MakeCylinder_3(ax2, R, H)      een cilinder
//     BRepPrimAPI_MakeTorus_1(R1, R2)            een ring
//     BRepPrimAPI_MakeWedge_1(dx, dy, dz, ltx)   een wig
//     BRepPrimAPI_MakeRevol_2(vlak, as, kopie)   een omwentelingslichaam
//     BRepAlgoAPI_Fuse_3(a, b, range)            samenvoegen
//
// DE OMWENTELING IS DE WERKPAARD. Bijna elk ornament hier is gedraaid werk:
// je geeft het silhouet op - een rij [straal, hoogte]-punten - en draait dat
// om de verticale as. Dennenappel, speerpunt, vaas en pion zijn allemaal
// hetzelfde gereedschap met een ander silhouet, en daardoor zijn ze ook
// allemaal parametrisch en schaalbaar.

import { SIERPUNT } from './balustrade-rules.js';

// De hals onder elk ornament. Zie regels.json voor waarom hij er is en waarom
// hij smaller is dan de paal.
const SOKKEL = SIERPUNT.sokkel;

// --- het draaiwerk ---------------------------------------------------------
//
// Deze handvol vormen zijn geen sierpuntendingen maar GEREEDSCHAP: een
// draaibank in code. Ze worden hieronder gebruikt voor de ornamenten en in
// balusters.js voor de gedraaide balusters - dezelfde meetkunde, een andere
// bibliotheek silhouetten.
//
// Ze staan daarom geëxporteerd, maar wel hier en niet in een eigen bestand.
// Dat is een afweging: een `draaiwerk.js` zou netter heten, maar het verplaatsen
// van code die door 15 nagemeten modellen gebruikt wordt levert risico op
// zonder dat er één regel beter van wordt. Komt er een derde bibliotheek bij,
// dan is dat het moment om ze te verhuizen.

/**
 * Een omwentelingslichaam uit een silhouet.
 *
 * @param profiel [[straal, hoogte], ...] van onder naar boven. Begin en eind
 *                mogen op de as liggen (straal 0); de wire wordt langs de as
 *                gesloten.
 */
export function omwenteling(oc, profiel, opruimen) {
    const veelhoek = new oc.BRepBuilderAPI_MakePolygon_1();
    opruimen.push(veelhoek);
    for (const [r, z] of profiel) {
        const p = new oc.gp_Pnt_3(r, 0, z);
        opruimen.push(p);
        veelhoek.Add_1(p);
    }
    veelhoek.Close();

    const vlak = new oc.BRepBuilderAPI_MakeFace_15(veelhoek.Wire(), false);
    const nul = new oc.gp_Pnt_3(0, 0, 0);
    const omhoog = new oc.gp_Dir_4(0, 0, 1);
    const as = new oc.gp_Ax1_2(nul, omhoog);
    const maker = new oc.BRepPrimAPI_MakeRevol_2(vlak.Face(), as, false);
    opruimen.push(vlak, nul, omhoog, as, maker);
    return maker.Shape();
}

/** Een bol met zijn middelpunt op hoogte z. */
export function bol(oc, straal, z, opruimen) {
    const maker = new oc.BRepPrimAPI_MakeSphere_1(straal);
    opruimen.push(maker);
    return verschuif(oc, maker.Shape(), 0, 0, z, opruimen);
}

/** Een (afgeknotte) kegel met zijn voet op hoogte z. */
export function kegel(oc, onder, boven, hoogte, z, opruimen) {
    const maker = new oc.BRepPrimAPI_MakeCone_1(onder, boven, hoogte);
    opruimen.push(maker);
    return verschuif(oc, maker.Shape(), 0, 0, z, opruimen);
}

/** Een cilinder met zijn voet op hoogte z. */
export function cilinder(oc, straal, hoogte, z, opruimen) {
    const p = new oc.gp_Pnt_3(0, 0, z);
    const d = new oc.gp_Dir_4(0, 0, 1);
    const as = new oc.gp_Ax2_3(p, d);
    const maker = new oc.BRepPrimAPI_MakeCylinder_3(as, straal, hoogte);
    opruimen.push(p, d, as, maker);
    return maker.Shape();
}

/** Een blok, gecentreerd op de as, met zijn onderkant op hoogte z. */
export function blok(oc, breedte, diepte, hoogte, z, opruimen) {
    const hoek = new oc.gp_Pnt_3(-breedte / 2, -diepte / 2, z);
    const maker = new oc.BRepPrimAPI_MakeBox_3(hoek, breedte, diepte, hoogte);
    opruimen.push(hoek, maker);
    return maker.Shape();
}

/**
 * Een vierkante piramide.
 *
 * MakeWedge_1 maakt een wig die maar in één richting toeloopt. Een piramide
 * loopt in twee richtingen toe, en daarvoor is de variant met zeven getallen
 * nodig: die geeft het bovenvlak apart op. Door dat vlak tot een punt samen te
 * laten vallen ontstaat een echte piramide.
 *
 * De wig groeit langs de Y-as van OCCT; hier moet hij omhoog, dus hij wordt
 * daarna een kwartslag gedraaid.
 */
function piramide(oc, breedte, hoogte, z, opruimen) {
    const m = new oc.BRepPrimAPI_MakeWedge_3(
        breedte, hoogte, breedte,
        breedte / 2, breedte / 2, breedte / 2, breedte / 2);
    opruimen.push(m);

    // Van "omhoog is +Y" naar "omhoog is +Z", en daarna gecentreerd.
    const t = new oc.gp_Trsf_1();
    t.SetValues(1, 0, 0, -breedte / 2,
                0, 0, 1, -breedte / 2,
                0, -1, 0, z + hoogte);
    const v = new oc.BRepBuilderAPI_Transform_2(m.Shape(), t, true);
    opruimen.push(t, v);
    return v.Shape();
}

/** Een ring (torus) liggend op hoogte z. */
export function ring(oc, straal, dikte, z, opruimen) {
    const maker = new oc.BRepPrimAPI_MakeTorus_1(straal, dikte);
    opruimen.push(maker);
    return verschuif(oc, maker.Shape(), 0, 0, z, opruimen);
}

export function verschuif(oc, vorm, x, y, z, opruimen) {
    const t = new oc.gp_Trsf_1();
    t.SetValues(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z);
    const v = new oc.BRepBuilderAPI_Transform_2(vorm, t, true);
    opruimen.push(t, v);
    return v.Shape();
}

/** Twee vormen tot één solid samenvoegen. */
export function samen(oc, a, b, opruimen) {
    const f = new oc.BRepAlgoAPI_Fuse_3(a, b, new oc.Message_ProgressRange_1());
    f.Build(new oc.Message_ProgressRange_1());
    opruimen.push(f);
    return f.Shape();
}

/** Alles in de lijst aan elkaar. */
export function alles(oc, stukken, opruimen) {
    return stukken.reduce((a, b) => (a ? samen(oc, a, b, opruimen) : b), null);
}

/**
 * Hoeveel twee onderdelen elkaar moeten OVERLAPPEN om tot één solid te
 * versmelten.
 *
 * Twee vormen die elkaar precies RAKEN - een bol die op een voet staat, een
 * piramide op een plaat - versmelten niet. Er komt dan een compound met twee
 * solids uit, en dat is geen onderdeel maar twee losse stukken: de stuklijst
 * telt het dubbel en de STEP bevat twee lichamen. Gemeten op de piramide, de
 * kogel op spil en de bol met kraag: 2 solids in plaats van 1.
 *
 * Een klein beetje doorsteken lost dat op. Het is een eis van het SAMENVOEGEN
 * en geen maat van het product; daarom een verhouding van de hoogte en geen
 * vast getal, zodat hij op elke schaal hetzelfde werkt.
 */
export const kleef = (h) => h * 0.02;

// --- de modellen -----------------------------------------------------------
//
// Elk model krijgt `b` (de voetmaat, gelijk aan de staanderbreedte) en `h` (de
// totale hoogte). Alles daarbinnen is een verhouding van die twee, zodat een
// model op een staander van 25 mm net zo klopt als op een van 100.
//
// `voet` zegt waar het model op past: een ronde voet hoort op een buis, een
// vierkante op een koker. 'beide' betekent dat de vorm zelf de voet bepaalt.

export const MODELLEN = [
    {
        id: 'kap-vlak', naam: 'Vlakke afdekkap', groep: 'Modern',
        voet: 'beide', hoogteFactor: 0.14,
        omschrijving: 'Een plaatje met een kleine oversteek. Sluit de koker af.',
        bouw: (oc, { b, h, rond }, op) => rond
            ? cilinder(oc, b / 2, h, 0, op)
            : blok(oc, b, b, h, 0, op),
    },
    {
        id: 'kap-dome', naam: 'Bolle afdekkap', groep: 'Modern',
        voet: 'beide', hoogteFactor: 0.6,
        omschrijving: 'Een gewelfde kap. Water blijft er niet op staan.',
        bouw: (oc, { b, h }, op) => {
            // Een halve bol die precies op de voetmaat aansluit, op een
            // randje. De bolstraal volgt uit de gewenste hoogte, zodat je de
            // welving kunt bijstellen zonder dat de voet verandert.
            const rand = h * 0.22;
            const r = (b * b / 4 + (h - rand) * (h - rand)) / (2 * (h - rand));
            return alles(oc, [
                cilinder(oc, b / 2, rand, 0, op),
                snijAf(oc, bol(oc, r, rand + (h - rand) - r, op),
                       b, rand, h, op),
            ], op);
        },
    },
    {
        id: 'bol-rond', naam: 'Sierbol op ronde voet', groep: 'Bollen',
        voet: 'rond', hoogteFactor: 2.0,
        omschrijving: 'Een bol op een halsje. Geran PK58 / FOS.',
        bouw: (oc, { b, h }, op) => {
            const hals = h * 0.26;
            const r = Math.min((h - hals) / 2, b * 0.62);
            return alles(oc, [
                omwenteling(oc, [[0, 0], [b / 2, 0], [b * 0.34, hals * 0.6],
                                 [b * 0.3, hals], [0, hals]], op),
                bol(oc, r, hals + r * 0.92, op),
            ], op);
        },
    },
    {
        id: 'bol-vierkant', naam: 'Sierbol op vierkante voet', groep: 'Bollen',
        voet: 'vierkant', hoogteFactor: 2.0,
        omschrijving: 'Dezelfde bol op een vierkante voet. Geran PK70 / FOSC.',
        bouw: (oc, { b, h }, op) => {
            const voet = h * 0.2;
            const r = Math.min((h - voet) / 2, b * 0.62);
            return alles(oc, [
                blok(oc, b, b, voet * 0.55, 0, op),
                kegel(oc, b * 0.42, b * 0.3, voet * 0.45, voet * 0.55, op),
                bol(oc, r, voet + r * 0.92, op),
            ], op);
        },
    },
    {
        id: 'dennenappel-rond', naam: 'Dennenappel, ronde voet', groep: 'Klassiek',
        voet: 'rond', hoogteFactor: 2.2,
        omschrijving: 'De klassieke dennenappel. Geran PK60 / FOT. '
            + 'Verhouding uit K5050 (130×70×55) en K5060 (160×85×80).',
        bouw: (oc, { b, h }, op) => omwenteling(oc, dennenappel(b, h), op),
    },
    {
        id: 'dennenappel-vierkant', naam: 'Dennenappel, vierkante voet',
        groep: 'Klassiek', voet: 'vierkant', hoogteFactor: 2.2,
        omschrijving: 'Dezelfde dennenappel op een vierkante voet. '
            + 'Geran PK57 / FOTC.',
        bouw: (oc, { b, h }, op) => {
            const voet = h * 0.14;
            return alles(oc, [
                blok(oc, b, b, voet, 0, op),
                verschuif(oc, omwenteling(oc, dennenappel(b * 0.92, h - voet), op),
                          0, 0, voet, op),
            ], op);
        },
    },
    {
        id: 'punt-rond', naam: 'Spitse punt', groep: 'Punten',
        voet: 'rond', hoogteFactor: 2.4,
        omschrijving: 'Een kegel op een halsje. Geran PK59.',
        bouw: (oc, { b, h }, op) => {
            const hals = h * 0.18;
            return alles(oc, [
                cilinder(oc, b / 2, hals * 0.5, 0, op),
                kegel(oc, b / 2, b * 0.44, hals * 0.5, hals * 0.5, op),
                kegel(oc, b * 0.44, 0, h - hals, hals, op),
            ], op);
        },
    },
    {
        id: 'piramide', naam: 'Piramide', groep: 'Modern',
        voet: 'vierkant', hoogteFactor: 1.3,
        omschrijving: 'Een strakke piramide op een vlakke voet.',
        bouw: (oc, { b, h }, op) => {
            const voet = h * 0.16;
            return alles(oc, [
                blok(oc, b, b, voet, 0, op),
                piramide(oc, b * 0.94, h - voet + kleef(h), voet - kleef(h), op),
            ], op);
        },
    },
    {
        id: 'speerpunt', naam: 'Speerpunt op klosvoet', groep: 'Punten',
        voet: 'rond', hoogteFactor: 3.1,
        omschrijving: 'Een slanke speer op een klos. Consepto, speerpunt op '
            + 'klosvoet.',
        bouw: (oc, { b, h }, op) => omwenteling(oc, [
            [0, 0], [b * 0.5, 0], [b * 0.5, h * 0.06],
            [b * 0.34, h * 0.1],
            // de klos
            [b * 0.46, h * 0.16], [b * 0.46, h * 0.22], [b * 0.3, h * 0.27],
            // de schacht, die naar boven toe smaller wordt
            [b * 0.26, h * 0.4], [b * 0.3, h * 0.52],
            // en de punt
            [b * 0.22, h * 0.62], [0, h],
        ], op),
    },
    {
        id: 'gelepeld', naam: 'Gelepelde punt', groep: 'Punten',
        voet: 'rond', hoogteFactor: 2.9,
        omschrijving: 'De gelepelde punt: een bolle buik die in een punt '
            + 'uitloopt. Consepto.',
        bouw: (oc, { b, h }, op) => omwenteling(oc, [
            [0, 0], [b * 0.5, 0], [b * 0.5, h * 0.07], [b * 0.3, h * 0.12],
            [b * 0.44, h * 0.2], [b * 0.56, h * 0.33], [b * 0.52, h * 0.47],
            [b * 0.34, h * 0.62], [b * 0.16, h * 0.78], [0, h],
        ], op),
    },
    {
        id: 'kogel-spil', naam: 'Kogel op spil', groep: 'Bollen',
        voet: 'rond', hoogteFactor: 2.8,
        omschrijving: 'Een bol op een spil met een sierlijke voet. Consepto, '
            + 'model Leidschendam.',
        bouw: (oc, { b, h }, op) => {
            const r = b * 0.44;
            return alles(oc, [
                omwenteling(oc, [
                    [0, 0], [b * 0.5, 0], [b * 0.5, h * 0.05],
                    [b * 0.28, h * 0.14], [b * 0.2, h * 0.3],
                    // De spil loopt DOOR TOT HET HART van de bol. Hij stopte
                    // eerst op 0,58 h terwijl de bol pas op 0,62 h begon: drie
                    // millimeter ertussen, en dus twee losse solids in plaats
                    // van één onderdeel.
                    [b * 0.22, h - r], [0, h - r],
                ], op),
                bol(oc, r, h - r, op),
            ], op);
        },
    },
    {
        id: 'pion', naam: 'Pion', groep: 'Klassiek',
        voet: 'rond', hoogteFactor: 2.3,
        omschrijving: 'Een bolletje in schaakstukvorm. Consepto, pion bolletje.',
        bouw: (oc, { b, h }, op) => omwenteling(oc, [
            [0, 0], [b * 0.5, 0], [b * 0.5, h * 0.08], [b * 0.4, h * 0.14],
            [b * 0.24, h * 0.26], [b * 0.22, h * 0.4],
            [b * 0.36, h * 0.46], [b * 0.36, h * 0.52],
            [b * 0.42, h * 0.62], [b * 0.4, h * 0.78],
            [b * 0.24, h * 0.9], [0, h],
        ], op),
    },
    {
        id: 'vaas', naam: 'Vaasornament', groep: 'Klassiek',
        voet: 'rond', hoogteFactor: 2.5,
        omschrijving: 'Gedraaid vaasvormig ornament met een ring.',
        bouw: (oc, { b, h }, op) => alles(oc, [
            omwenteling(oc, [
                [0, 0], [b * 0.52, 0], [b * 0.52, h * 0.07],
                [b * 0.3, h * 0.16], [b * 0.46, h * 0.3], [b * 0.5, h * 0.45],
                [b * 0.38, h * 0.62], [b * 0.4, h * 0.74],
                [b * 0.3, h * 0.82], [b * 0.3, h * 0.9], [0, h * 0.9],
            ], op),
            ring(oc, b * 0.34, b * 0.07, h * 0.62, op),
            bol(oc, b * 0.16, h * 0.9, op),
        ], op),
    },
    {
        id: 'ring-bol', naam: 'Bol met kraag', groep: 'Bollen',
        voet: 'beide', hoogteFactor: 1.9,
        omschrijving: 'Een bol met een ring eromheen, op een lage voet.',
        bouw: (oc, { b, h, rond }, op) => {
            const voet = h * 0.16;
            const r = Math.min((h - voet) / 2, b * 0.56);
            // De bol zakt een kleefje in de voet; anders raken ze elkaar
            // alleen in één punt en versmelten ze niet. Zie kleef().
            const mid = voet + r - kleef(h);
            return alles(oc, [
                rond ? cilinder(oc, b / 2, voet, 0, op) : blok(oc, b, b, voet, 0, op),
                bol(oc, r, mid, op),
                ring(oc, r * 0.92, r * 0.16, mid, op),
            ], op);
        },
    },
    {
        id: 'lelie', naam: 'Franse lelie (vereenvoudigd)', groep: 'Klassiek',
        voet: 'beide', hoogteFactor: 2.9,
        omschrijving: 'Een vereenvoudigde Franse lelie: een middenblad met twee '
            + 'zijbladen. Dit is GEEN natuurgetrouwe lelie — de echte is '
            + 'gesmeed en niet draaisymmetrisch; dit is de silhouetvorm.',
        bouw: (oc, { b, h, rond }, op) => {
            const voet = h * 0.12;
            const basis = rond ? cilinder(oc, b * 0.5, voet, 0, op)
                               : blok(oc, b, b, voet, 0, op);
            // Een blad: een platte wig die naar boven in een punt loopt. Drie
            // stuks, waarvan twee opzij gekanteld - zo ontstaat de silhouet
            // van een lelie zonder dat er gesmeed hoeft te worden.
            const blad = (hoogte, breedte) => omwenteling(oc, [
                [0, 0], [breedte * 0.5, hoogte * 0.18],
                [breedte * 0.34, hoogte * 0.55], [0, hoogte],
            ], op);
            // De bladdikte als VERHOUDING: het blad is `breedte` breed in zijn
            // ronde vorm, en moet `dik` dik worden. Zie plat() - daar ging het
            // eerder mis door een maat voor een factor aan te zien.
            const dik = b * 0.3;
            const factor = (breedte) => dik / breedte;
            const midden = verschuif(oc,
                plat(oc, blad(h - voet, b * 0.62), factor(b * 0.62), op),
                0, 0, voet - kleef(h), op);
            // DE ZIJBLADEN NIET TE VER UIT ELKAAR. Op 38 graden en een halve
            // hoogte kwam de lelie op 89 mm breed uit bij een staander van 40
            // - meer dan twee keer de paal, en dan staat hij niet meer op de
            // leuning maar eroverheen. Op 26 graden en iets korter blijft hij
            // onder anderhalf maal de staander.
            // Hoe hoger de lelie, hoe verder de gekantelde zijbladen naar
            // buiten reiken. Met de hogere standaardmaten kwam hij op 1,5 keer
            // de staander uit en daarmee over de grens van maxBreedte; korter
            // en minder gekanteld houdt hem binnen anderhalve paalbreedte.
            const zij = (kant) => verschuif(oc,
                kantel(oc, plat(oc, blad((h - voet) * 0.42, b * 0.44),
                                factor(b * 0.44), op), kant * 22, op),
                kant * b * 0.14, 0, voet + (h - voet) * 0.12, op);
            return alles(oc, [basis, midden, zij(1), zij(-1)], op);
        },
    },
];

/** Het silhouet van een dennenappel: een zigzag van schubben. */
function dennenappel(b, h) {
    const voet = h * 0.1;
    const profiel = [[0, 0], [b * 0.5, 0], [b * 0.5, voet * 0.6],
                     [b * 0.34, voet]];
    // Vijf schubbenrijen. De body is op zijn breedst op een derde van de
    // hoogte en loopt daarna toe - zo ziet een dennenappel eruit.
    const rijen = 5;
    for (let i = 0; i < rijen; i++) {
        const t = i / (rijen - 1);
        const z = voet + (h - voet) * (0.08 + t * 0.78);
        const breed = b * 0.6 * Math.sin(Math.PI * (0.22 + t * 0.66));
        profiel.push([breed, z]);
        profiel.push([breed * 0.72, z + (h - voet) * 0.07]);
    }
    profiel.push([0, h]);
    return profiel;
}

/**
 * Een omwentelingslichaam platdrukken: van rond naar blad.
 *
 * `factor` is een VERHOUDING, geen maat. Hier stond eerst de gewenste dikte in
 * millimeters, en die werd als vermenigvuldiging gebruikt: een blad met een
 * straal van 20 mm werd dan 20 x 12 = 240 mm aan elke kant. De lelie kwam
 * daardoor op 515 mm breed uit, op een staander van 40.
 *
 * Geen starre verplaatsing maar een schaling in één richting. gp_Trsf kan dat
 * niet - die doet alleen starre verplaatsingen - dus hier gp_GTrsf.
 */
function plat(oc, vorm, factor, opruimen) {
    const g = new oc.gp_GTrsf_1();
    g.SetValue(1, 1, 1); g.SetValue(1, 2, 0); g.SetValue(1, 3, 0); g.SetValue(1, 4, 0);
    g.SetValue(2, 1, 0); g.SetValue(2, 2, factor); g.SetValue(2, 3, 0); g.SetValue(2, 4, 0);
    g.SetValue(3, 1, 0); g.SetValue(3, 2, 0); g.SetValue(3, 3, 1); g.SetValue(3, 4, 0);
    const v = new oc.BRepBuilderAPI_GTransform_2(vorm, g, true);
    opruimen.push(g, v);
    return v.Shape();
}

/** Een vorm om de Y-as kantelen, in graden. */
function kantel(oc, vorm, graden, opruimen) {
    const r = graden * Math.PI / 180;
    const t = new oc.gp_Trsf_1();
    t.SetValues(Math.cos(r), 0, Math.sin(r), 0,
                0, 1, 0, 0,
                -Math.sin(r), 0, Math.cos(r), 0);
    const v = new oc.BRepBuilderAPI_Transform_2(vorm, t, true);
    opruimen.push(t, v);
    return v.Shape();
}

/** Alles boven `top` en onder `onder` eraf snijden. */
function snijAf(oc, vorm, breedte, onder, top, opruimen) {
    const maat = Math.max(breedte, top) * 4;
    const hoek = new oc.gp_Pnt_3(-maat / 2, -maat / 2, onder);
    const mes = new oc.BRepPrimAPI_MakeBox_3(hoek, maat, maat, top - onder);
    const snede = new oc.BRepAlgoAPI_Common_3(vorm, mes.Shape(),
        new oc.Message_ProgressRange_1());
    snede.Build(new oc.Message_ProgressRange_1());
    opruimen.push(hoek, mes, snede);
    return snede.Shape();
}

// --- naar buiten -----------------------------------------------------------

export const GEEN = 'geen';

/** Het model met dit nummer, of null. */
export function modelVan(id) {
    return MODELLEN.find(m => m.id === id) || null;
}

/** De modellen per groep, voor een keuzevenster. */
export function perGroep() {
    const uit = new Map();
    for (const m of MODELLEN) {
        if (!uit.has(m.groep)) uit.set(m.groep, []);
        uit.get(m.groep).push(m);
    }
    return [...uit.entries()].map(([groep, modellen]) => ({ groep, modellen }));
}

/**
 * Past dit model op een staander van deze vorm?
 *
 * Een ronde voet op een koker laat een kier rondom, een vierkante voet op een
 * buis steekt in de hoeken over de paal heen. Allebei is het geen product.
 */
export function pastOp(model, rondeStaander) {
    if (!model || model.voet === 'beide') return true;
    return model.voet === (rondeStaander ? 'rond' : 'vierkant');
}

/**
 * De hoogte die bij dit model hoort bij een staander van deze breedte.
 *
 * INCLUSIEF DE HALS. Dat is wat je ziet staan en wat je opmeet, en het is ook
 * wat de gebruiker in het hoogteveld zet.
 */
export function hoogteVoor(model, breedte) {
    return Math.round(breedte * (model.hoogteFactor + SOKKEL.hoogte));
}

/** Hoe hoog een vorm werkelijk is, uit zijn omhullende doos. */
function hoogteVan(oc, vorm) {
    const doos = new oc.Bnd_Box_1();
    try {
        oc.BRepBndLib.Add(vorm, doos, false);
        return doos.CornerMax().Z() - doos.CornerMin().Z();
    } finally {
        doos.delete();
    }
}

/** Hoe hoog de hals wordt bij deze voetmaat en deze totale hoogte. */
export function sokkelHoogte(b, h) {
    // Nooit meer dan een deel van het geheel: zet iemand de hoogte op 60 mm,
    // dan moet er nog wel een ornament overblijven.
    return Math.min(b * SOKKEL.hoogte, h * SOKKEL.maxDeel);
}

/**
 * Bouwt het ornament. De voet ligt op z = 0, gecentreerd op de as.
 *
 * @param maten { b, h, rond } - voetmaat, hoogte, en of de staander rond is
 */
export function maakSierpunt(oc, id, maten, opruimen) {
    const model = modelVan(id);
    if (!model) throw new Error(`Onbekend sierpunt: ${id}`);

    const { b, h, rond } = maten;
    // DE HALS, zodat het ornament vrij op de handregel staat in plaats van er
    // plat op te liggen. Zonder hals ligt een bolle kap als een knobbel op de
    // regel - dat was op de foto goed te zien. Zie regels.json.
    const hals = maten.sokkel === false ? 0 : sokkelHoogte(b, h);
    const model_h = h - hals;
    if (!(model_h > 0)) {
        throw new Error(`Sierpunt ${id}: hoogte ${h} mm is te laag — de hals `
            + `alleen is al ${hals.toFixed(0)} mm.`);
    }

    const vorm = model.bouw(oc, { ...maten, h: model_h }, opruimen);
    if (!vorm || vorm.IsNull()) {
        throw new Error(`Sierpunt ${id} leverde geen vorm op.`);
    }
    if (hals <= 0) return vorm;

    // DE HALS VULT AAN WAT HET MODEL NIET OPMAAKT.
    //
    // Een paar modellen begrenzen hun eigen maat: een sierbol houdt zijn
    // straal op hoogstens 0,62 keer de voet, want een bol die met de hoogte
    // meegroeit wordt een ei. Vraag je dan 128 mm, dan bouwt het model er maar
    // 112 - en kreeg je 16 mm minder dan je had ingevuld. De hals maakt dat
    // verschil goed, zodat de opgegeven hoogte ook de hoogte is die er staat.
    const echt = hoogteVan(oc, vorm);
    const tekort = Math.max(0, model_h - echt);
    const halsEcht = hals + tekort;

    const hb = b * SOKKEL.breedte;
    // De hals steekt een kleefje in het ornament, anders raken ze elkaar
    // alleen en worden het twee losse solids. Zie kleef().
    const kop = verschuif(oc, vorm, 0, 0, halsEcht, opruimen);
    const voet = rond
        ? cilinder(oc, hb / 2, halsEcht + kleef(h), 0, opruimen)
        : blok(oc, hb, hb, halsEcht + kleef(h), 0, opruimen);
    return samen(oc, voet, kop, opruimen);
}
