// Gelijke productieonderdelen herkennen aan hun GEOMETRIE.
//
// Vier staanders op vier plekken in een balustrade zijn vier exemplaren van één
// productieonderdeel. Voor de werkplaats is dat één tekening en één zaagregel
// met aantal 4, niet vier tekeningen.
//
// Waarom niet op naam of profiel vergelijken: twee staanders van CHS 48,3 x 2,6
// en 1000 mm lang zijn hetzelfde onderdeel - tot er in één van de twee een gat
// zit. Dan zijn het er twee, terwijl naam, profiel en lengte gelijk blijven. De
// vergelijking moet dus naar de vorm kijken.
//
// WAT NIET WERKT: OCCT's eigen IsSame/IsEqual/IsPartner. Die vergelijken
// identiteit, niet geometrie. Twee los gebouwde, volkomen identieke blokken van
// 40 x 40 x 1000 geven alle drie `false`. Nagemeten, niet aangenomen.
//
// WAT WEL WERKT: een stel grootheden die niet veranderen als je het onderdeel
// verplaatst of draait, maar wel als er materiaal bij of af gaat.

// Hoe groot een RELATIEF verschil mag zijn om nog "hetzelfde" te heten.
//
// Dit getal is gekozen op metingen, niet op gevoel. Verplaatsen over 7 meter en
// draaien over een schuine as geven hooguit 2,4e-11 verschil; het kleinste echte
// verschil dat getest is (1000 tegen 1000,1 mm lang) geeft 1,0e-4. Tussen die
// twee zit zeven ordes van grootte, en 1e-7 ligt daar met een factor 10.000
// marge aan beide kanten tussenin.
import { materiaalVanDeel, materiaalNaam,
         afwerkingVanDeel, afwerkingTekst } from './materialen.js';

export const TOLERANTIE = 1e-7;

const waardeVan = (e) => (e && typeof e === 'object' && 'value' in e) ? e.value : e;

/**
 * De meetbare kenmerken van een vorm, los van waar hij staat.
 *
 * @param oc    de OCCT-module
 * @param vorm  een TopoDS_Shape - de LOKALE vorm, nog niet geplaatst
 *
 * De drie traagheidsgetallen I1, I2 en I3 zijn de coefficienten van de
 * karakteristieke veelterm van de traagheidsmatrix: spoor, som van de
 * 2x2-hoofdminoren, en determinant. Draai je de vorm, dan wordt de matrix
 * Rt*M*R met R een rotatiematrix, en blijven die drie exact gelijk. Je hebt er
 * dus geen eigenwaardeberekening voor nodig.
 *
 * Verplaatsen maakt ook niets uit, want OCCT rekent de matrix om het
 * ZWAARTEPUNT en niet om de oorsprong. Dat is nagemeten: hetzelfde blok op
 * (0,0,0) en op (-3000, 7000, 12) verschilt 7,9e-14 in I1.
 */
export function kenmerken(oc, vorm) {
    const inhoud = new oc.GProp_GProps_1();
    const huid = new oc.GProp_GProps_1();
    try {
        oc.BRepGProp.VolumeProperties_1(vorm, inhoud, false, false, false);
        oc.BRepGProp.SurfaceProperties_1(vorm, huid, false, false);

        const M = inhoud.MatrixOfInertia();
        const m = (i, j) => M.Value(i, j);
        const I1 = m(1, 1) + m(2, 2) + m(3, 3);
        const I2 = m(1, 1) * m(2, 2) - m(1, 2) * m(2, 1)
                 + m(1, 1) * m(3, 3) - m(1, 3) * m(3, 1)
                 + m(2, 2) * m(3, 3) - m(2, 3) * m(3, 2);
        const I3 = M.Determinant();

        return {
            volume: inhoud.Mass(),
            oppervlak: huid.Mass(),
            I1, I2, I3,
            telling: telTopologie(oc, vorm),
            vlaksoorten: telVlaksoorten(oc, vorm),
        };
    } finally {
        inhoud.delete();
        huid.delete();
    }
}

/**
 * Hoeveel solids, vlakken, ribben en hoekpunten.
 *
 * Een gat voegt vlakken en ribben toe: een blok gaat van 6 naar 7 vlakken en van
 * 12 naar 15 ribben. Dat is een harde, exacte aanwijzing - geen afgerond getal.
 *
 * Maar het is niet genoeg op zichzelf: een VERSTEK houdt 6 vlakken, 12 ribben en
 * 8 hoekpunten, precies als een recht afgezaagd blok. Daarom staan de getallen
 * hierboven er ook bij.
 */
function telTopologie(oc, vorm) {
    const uit = {};
    for (const soort of ['SOLID', 'SHELL', 'FACE', 'WIRE', 'EDGE', 'VERTEX']) {
        const kaart = new oc.TopTools_IndexedMapOfShape_1();
        oc.TopExp.MapShapes_1(vorm, oc.TopAbs_ShapeEnum['TopAbs_' + soort], kaart);
        uit[soort] = kaart.Size();
        kaart.delete();
    }
    return uit;
}

/** Hoeveel vlakken van elke soort: plat, cilindrisch, kegel, bol, ... */
function telVlaksoorten(oc, vorm) {
    const uit = {};
    for (const verkenner = new oc.TopExp_Explorer_2(vorm,
             oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
         verkenner.More(); verkenner.Next()) {
        const opp = new oc.BRepAdaptor_Surface_2(
            oc.TopoDS.Face_1(verkenner.Current()), true);
        const soort = String(waardeVan(opp.GetType()));
        uit[soort] = (uit[soort] || 0) + 1;
        opp.delete();
    }
    return uit;
}

/**
 * De draairichting van het assenstelsel waarin een onderdeel geplaatst wordt.
 *
 * +1 = rechtsdraaiend (normaal), -1 = gespiegeld.
 *
 * Waarom dit nodig is: een onderdeel en zijn spiegelbeeld hebben hetzelfde
 * volume, hetzelfde oppervlak, dezelfde traagheidsgetallen en dezelfde
 * topologie. Op die kenmerken zijn ze niet te onderscheiden. Voor productie zijn
 * het wel twee verschillende dingen - een linker trapwang is geen rechter.
 *
 * BEPERKING, bewust opgeschreven: dit vangt een onderdeel dat met een
 * spiegelende plaatsing neergezet wordt. Het vangt NIET een onderdeel waarvan de
 * lokale vorm zelf al gespiegeld gebouwd is. Zodra dat voorkomt, moet het aan de
 * bouwkant gemarkeerd worden.
 */
export function draairichting(deel) {
    const [x, y, z] = [deel.xAs, deel.yAs, deel.zAs];
    if (!x || !y || !z) return 1;
    const det = x[0] * (y[1] * z[2] - y[2] * z[1])
              - x[1] * (y[0] * z[2] - y[2] * z[0])
              + x[2] * (y[0] * z[1] - y[1] * z[0]);
    return det < 0 ? -1 : 1;
}

// --- vergelijken -----------------------------------------------------------

/** Zijn twee getallen binnen de relatieve tolerantie gelijk? */
function zelfdeGetal(a, b, tol) {
    if (a === b) return true;
    const schaal = Math.max(Math.abs(a), Math.abs(b));
    // Bij waarden rond nul heeft "relatief" geen betekenis; dan absoluut.
    if (schaal < 1e-12) return Math.abs(a - b) < 1e-12;
    return Math.abs(a - b) / schaal <= tol;
}

const zelfdeTelling = (a, b) =>
    Object.keys({ ...a, ...b }).every(k => (a[k] || 0) === (b[k] || 0));

/**
 * Zijn dit twee exemplaren van hetzelfde productieonderdeel?
 *
 * De tellingen moeten EXACT gelijk zijn (het zijn hele getallen), de gemeten
 * grootheden binnen de tolerantie.
 */
export function gelijk(a, b, tol = TOLERANTIE) {
    return a.draairichting === b.draairichting
        && zelfdeTelling(a.telling, b.telling)
        && zelfdeTelling(a.vlaksoorten, b.vlaksoorten)
        && zelfdeGetal(a.volume, b.volume, tol)
        && zelfdeGetal(a.oppervlak, b.oppervlak, tol)
        && zelfdeGetal(a.I1, b.I1, tol)
        && zelfdeGetal(a.I2, b.I2, tol)
        && zelfdeGetal(a.I3, b.I3, tol);
}

/**
 * Groepeert exemplaren tot unieke productieonderdelen.
 *
 * @param exemplaren  [{ kenmerken, deel, vorm }, ...] in bouwvolgorde
 * @returns [{ nummer, aantal, kenmerken, vorm, deel, exemplaren }, ...]
 *
 * Vergelijkt elk nieuw exemplaar met de al gevonden unieke onderdelen in plaats
 * van een sleutel te hashen. Dat is bewust: met afronden op een sleutel kunnen
 * twee waarden die maar 1e-11 schelen tóch aan weerszijden van een afrondgrens
 * vallen en uit elkaar getrokken worden. Vergelijken met een tolerantie heeft
 * dat probleem niet.
 *
 * Kosten: aantal exemplaren maal aantal unieke onderdelen. Bij een balustrade
 * zijn dat enkele tientallen maal een handvol - verwaarloosbaar.
 */
export function groepeer(exemplaren, tol = TOLERANTIE) {
    const uniek = [];

    for (const e of exemplaren) {
        const bestaand = uniek.find(u => gelijk(u.kenmerken, e.kenmerken, tol));
        if (bestaand) {
            bestaand.aantal += 1;
            bestaand.exemplaren.push(e.deel);
            continue;
        }
        uniek.push({
            nummer: uniek.length + 1,
            aantal: 1,
            kenmerken: e.kenmerken,
            vorm: e.vorm,              // de LOKALE vorm, om te exporteren
            deel: e.deel,              // de eerste beschrijving, voor de naam
            exemplaren: [e.deel],
        });
    }

    return uniek;
}

/**
 * Van losse lokale vormen naar unieke productieonderdelen.
 *
 * @param lokaal  [{ deel, vorm }, ...] - `vorm` is de LOKALE vorm van het
 *                onderdeel, dus zoals het uit de zaag komt en niet zoals het in
 *                het model staat.
 *
 * Staat hier zodat de balustrade en de trap dezelfde herkenning gebruiken. Twee
 * kopieën van deze logica zouden op termijn verschillend gaan groeperen.
 */
export function groepeerVormen(oc, lokaal) {
    // DEZELFDE VORM WORDT ÉÉN KEER GEMETEN, en dat scheelt echt wat.
    //
    // `kenmerken` rekent per onderdeel het volume, het oppervlak en de
    // traagheidsmatrix uit. Bij een blok is dat niets; bij een profiel dat uit
    // een STEP-doorsnede getrokken is, met gebogen vlakken, is dat echt werk -
    // en het gebeurde 64 keer op een leuning waar maar een handvol
    // verschillende vormen in zitten.
    //
    // Sinds de staven hergebruikt worden (zie maakStaaf in
    // profiel-geometrie.js) wijzen identieke onderdelen naar HETZELFDE
    // vormobject. Dan is dit een gewone opzoeking: 36 spijlen leveren één
    // meting op in plaats van 36 die allemaal hetzelfde antwoord geven.
    //
    // De map leeft alleen binnen deze aanroep. Een vorm die hier binnenkomt is
    // al af, dus binnen één aanroep kan hij niet veranderen - en daarbuiten
    // bewaren we niets, zodat er ook niets oud kan worden.
    const gemeten = new Map();
    const meet = (vorm) => {
        if (gemeten.has(vorm)) return gemeten.get(vorm);
        const k = kenmerken(oc, vorm);
        gemeten.set(vorm, k);
        return k;
    };

    const uniek = groepeer(lokaal.map(({ deel, vorm }) => ({
        deel,
        vorm,
        kenmerken: { ...meet(vorm), draairichting: draairichting(deel) },
    })));

    // De zaaghoeken pas NA het groeperen meten: één keer per uniek onderdeel in
    // plaats van één keer per exemplaar. Bij 58 spijlen scheelt dat 57 metingen
    // die allemaal hetzelfde antwoord geven.
    // Een PLAAT wordt gesneden, niet gezaagd: een taartpunttrede leverde hier
    // dertien "zaaghoeken" op, één per hoekpunt van zijn omtrek.
    for (const u of uniek) u.zaaghoeken = u.deel.plaat ? [] : zaaghoeken(oc, u.vorm);
    return uniek;
}

/**
 * De volledige stuklijstregel van een uniek productieonderdeel.
 *
 * Dit is wat de opdracht een BOM noemt: positienummer, aantal, materiaal,
 * profiel, zaaglengte, zaaghoeken, afwerking en de naam van het STEP-bestand
 * dat erbij hoort. Alles wat je nodig hebt om het te bestellen en te maken.
 */
export function bomRegel(uniek) {
    const b = beschrijf(uniek.deel);
    return {
        positie: String(uniek.nummer).padStart(3, '0'),
        aantal: uniek.aantal,
        soort: b.soort,
        materiaal: b.materiaal,
        profiel: b.profiel,
        norm: b.norm,
        zaaglengte: b.lengte,
        zaaghoeken: zaaghoekTekst(uniek.zaaghoeken),
        afwerking: b.afwerking,
        bestand: bestandsnaam(uniek.nummer),
    };
}

// --- zaaghoeken ------------------------------------------------------------

/**
 * Onder welke hoeken dit onderdeel afgezaagd wordt, in graden.
 *
 * 90 is een rechte kop. Alles daaronder is een verstek, en dat moet de zager
 * weten: hij zet er zijn zaag op in.
 *
 * HOE DE LENGTERICHTING BEPAALD WORDT: de langste RECHTE rib. Niet de langste
 * maat van het omhullende doosje - dat gaat mis zodra een onderdeel schuin in
 * zijn eigen doosje ligt. Een trapboom van 4510 mm lang meet 3681 x 3000 in
 * zijn doosje, en dan kwamen de hoeken eruit ten opzichte van de X-as: 38,6 en
 * 51,4 graden, wat de traphelling is en geen zaaghoek. Met de langste rib komt
 * er 90, 38,6, 90 uit, en dát klopt: twee rechte koppen en één snede op de
 * helling waar hij op de vloer staat.
 *
 * Ronde ribben tellen niet mee als lengterichting. Bij een buis zijn de
 * kopvlakken cirkels; de naad langs de lengte is de langste RECHTE rib.
 */
export function zaaghoeken(oc, vorm) {
    const richting = lengteRichting(oc, vorm);
    if (!richting) return [];

    const platVlak = waardeVan(oc.GeomAbs_SurfaceType.GeomAbs_Plane);
    const gezien = new Set();

    for (const v = new oc.TopExp_Explorer_2(vorm,
             oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
         v.More(); v.Next()) {
        const opp = new oc.BRepAdaptor_Surface_2(oc.TopoDS.Face_1(v.Current()), true);
        try {
            if (waardeVan(opp.GetType()) !== platVlak) continue;
            const n = opp.Plane().Axis().Direction();
            const cos = Math.abs(n.X() * richting[0] + n.Y() * richting[1]
                               + n.Z() * richting[2]);
            // Staat de normaal loodrecht op de lengte, dan is het een zijvlak
            // en geen kop. De drempel vangt afrondruis op.
            if (cos <= 0.02) continue;
            const hoek = 90 - Math.acos(Math.min(1, cos)) * 180 / Math.PI;
            gezien.add(Math.round(hoek * 10) / 10);
        } finally {
            opp.delete();
        }
    }
    return [...gezien].sort((a, b) => a - b);
}

/** De richting van de langste RECHTE rib, als eenheidsvector. */
function lengteRichting(oc, vorm) {
    const lijnSoort = waardeVan(oc.GeomAbs_CurveType.GeomAbs_Line);
    let langste = 0, richting = null;

    for (const v = new oc.TopExp_Explorer_2(vorm,
             oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
         v.More(); v.Next()) {
        const c = new oc.BRepAdaptor_Curve_2(oc.TopoDS.Edge_1(v.Current()));
        try {
            if (waardeVan(c.GetType()) !== lijnSoort) continue;
            const a = c.Value(c.FirstParameter());
            const b = c.Value(c.LastParameter());
            const d = [b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z()];
            const lengte = Math.hypot(...d);
            if (lengte > langste) { langste = lengte; richting = d.map(x => x / lengte); }
        } finally {
            c.delete();
        }
    }
    return richting;
}

/** De zaaghoeken als tekst voor een stuklijst: "recht" of "38,6° / 90°". */
export function zaaghoekTekst(hoeken) {
    if (!hoeken || hoeken.length === 0) return '';
    if (hoeken.every(h => Math.abs(h - 90) < 0.05)) return 'recht';
    return hoeken.map(h => `${String(h).replace('.', ',')}°`).join(' / ');
}

/** Een bestandsnaam zoals de opdracht hem vraagt: onderdeel_001.stp */
export function bestandsnaam(nummer) {
    return `onderdeel_${String(nummer).padStart(3, '0')}.stp`;
}

const rond = (v) => Math.round(v * 100) / 100;

/**
 * Hoe een onderdeel heet en hoe lang het is.
 *
 * Staat hier en niet in de stuklijst, omdat de stuklijst en de onderdelenlijst
 * het allebei nodig hebben. Twee keer dezelfde afleiding gaat vroeg of laat uit
 * elkaar lopen.
 *
 * De zaaglengte is de maat langs de LENGTEAS. Alleen bij een onderdeel zonder
 * lengteas valt hij terug op "de langste maat"; dat klopt voor een balk maar
 * niet per se voor een kort stuk uit een dik profiel.
 */
export function beschrijf(deel) {
    const maten = [deel.dx, deel.dy, deel.dz].sort((a, b) => a - b);
    const langs = { x: 'dx', y: 'dy', z: 'dz' }[deel.lengteAs];
    const pr = deel.profiel;

    // Het materiaal zoals de werkplaats het moet lezen. Bij een profiel uit de
    // catalogus is dat de staalsoort - die staat per profiel vast en kan er
    // meer dan één zijn. Bij een trede is het de keuze uit het paneel.
    //
    // Allebei in ÉÉN kolom, want in een stuklijst staat één materiaalkolom. Een
    // aparte kolom "staalsoort" naast "materiaal" zou bij een houten trede
    // altijd leeg zijn en bij staal altijd dubbel.
    const soorten = pr && pr.items ? pr.items.map(i => i.material).filter(Boolean) : [];
    const uitProfiel = soorten.join(', ');
    const sleutel = materiaalVanDeel(deel);
    // EÉN STAALSOORT IN DE KOLOM. De catalogus zet bij een profiel vaak staal
    // én RVS (S235JRH en X5CrNi18-10); allebei in de stuklijst laat de
    // werkplaats raden wat er besteld moet worden. Bij staal dus de eerste
    // soort die geen RVS is - die beginnen met een X of met 1.4
    // (werkstofnummer). Bij RVS niet de soort uit de catalogus: dat is 304,
    // en de app belooft RVS 316.
    const isRvsSoort = (m) => /^(?:X|1\.4)/i.test(m.trim());
    const gekozenSoort = sleutel === 'staal' ? soorten.find(m => !isRvsSoort(m)) : undefined;

    return {
        soort: deel.soort,
        // `zaaglengte` wint als hij er staat. Dat is nodig zodra een onderdeel
        // uit een BLOK gesneden wordt dat groter is dan het stuk zelf: een
        // spijl die aan twee kanten schuin wordt afgezaagd komt uit een blok
        // dat een paar millimeter hoger is dan de spijl. Zonder dit zou de
        // werkplaats dat blok bestellen in plaats van het stuk.
        lengte: deel.zaaglengte !== undefined ? deel.zaaglengte
              : langs ? deel[langs] : maten[2],
        // `omschrijving` voor een doorsnede die niet uit de catalogus komt
        // maar wel een naam heeft, zoals de L-hoek onder een trede of een
        // ronde wandleuning. Zonder dat stond er "50 × 50" bij een hoeklijn.
        profiel: pr ? (pr.englishLabel || pr.label || 'profiel')
                    : deel.omschrijving || `${rond(maten[0])} × ${rond(maten[1])}`,
        norm: pr ? (pr.standardLabel || '') : '',
        // De staalsoort uit de catalogus geldt alleen voor STAAL. Is het frame
        // RVS of aluminium, dan zou "S235JRH" bij een RVS-staander een
        // verkeerde bestelling opleveren. Zie gekozenSoort hierboven.
        materiaal: gekozenSoort || materiaalNaam(sleutel),
        materiaalSleutel: sleutel,
        // De afwerking is een EIGEN gegeven naast het materiaal: een staander
        // is van staal én gepoedercoat. Leeg betekent blank.
        // Met verzinken erbij: "thermisch verzinkt" of duplex.
        afwerking: afwerkingTekst(deel),
        afwerkingNummer: afwerkingVanDeel(deel) || '',
        // Blijft staan voor wie er al op leunde; het is hetzelfde als
        // `materiaal` zodra het om staal uit de catalogus gaat.
        staalsoorten: uitProfiel,
    };
}
