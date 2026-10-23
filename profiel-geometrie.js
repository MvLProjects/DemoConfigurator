// Van een profiel uit de catalogus naar bruikbare geometrie.
//
// Elk STEP-bestand in de catalogus is een stukje profiel van 10 mm, met de as
// langs +Z. Wat je ervan wilt hebben is de DOORSNEDE: het vlakke vlak op z = 0.
// Die trek je daarna zelf op de lengte die je nodig hebt.
//
// Drie dingen die je hier makkelijk verkeerd doet:
//
// 1. NIET het grootste vlak pakken. Bij een buis van 10 mm lang is de
//    buitencilinder groter dan de doorsnede. Zoeken op POSITIE: het vlakke vlak
//    waarvan alle hoekpunten op |z| < 1e-4 liggen.
// 2. NIET leesVorm() gebruiken. Die bewaart de vorm als "het geladen model", en
//    dan vervangt elk voorbeeldje het model van de gebruiker. leesLosseVorm()
//    laat dat met rust.
// 3. NIET alle 1743 bestanden inlezen. De doorsnede wordt pas bij eerste gebruik
//    gepakt en daarna per bestand bewaard. Het venster moet binnen een seconde
//    open staan, en alles inlezen duurt ruim een minuut.

import { initOcct, leesLosseVorm } from './brep-edges.js';
import { tessellateer } from './tessellate.js';

const waardeVan = (e) => (e && typeof e === 'object' && 'value' in e) ? e.value : e;

// Per bestand: de belofte van een doorsnede. De belofte zelf wordt bewaard en
// niet de uitkomst, zodat twee kliks vlak achter elkaar ook maar één keer
// inlezen.
const bewaard = new Map();

// Per profiel én lengte: de staaf die eruit getrokken is. Zie maakStaaf voor
// waarom dit mag en wat het scheelt.
//
// BEGRENSD, want de lengtes verschillen per ontwerp en een gebruiker bouwt er
// op een middag tientallen. Zonder grens zou dit geheugen blijven oppakken.
// De oudste gaat eruit; hij wordt NIET verwijderd, want een onderdeel dat al
// gebouwd is kan er nog naar verwijzen - zijn lokale vorm gaat mee naar de
// stuklijst en de STEP-export. Dat is dezelfde afspraak als voorheen, toen
// elke staaf werd aangemaakt en nooit vrijgegeven.
const MAX_STAVEN = 256;
const staven = new Map();

function onthoudStaaf(sleutel, vorm) {
    staven.set(sleutel, vorm);
    while (staven.size > MAX_STAVEN) {
        staven.delete(staven.keys().next().value);
    }
}

// Hoe vaak de cache raak schoot. Een cache waarvan je niet weet of hij raak
// schiet is geen verbetering maar een gok: hij kostte hier bijna niets en
// leverde ook bijna niets op, en zonder tellen was niet te zien of dat kwam
// doordat hij nooit aanslaat of doordat het werk ergens anders zit.
export const staafTelling = { raak: 0, mis: 0 };

/** Leeg de bewaarde doorsnedes en staven. Alleen voor tests. */
export function vergeetAlles() {
    bewaard.clear();
    staven.clear();
}

/** Hoeveel doorsnedes er nu bewaard zijn. */
export function aantalBewaard() {
    return bewaard.size;
}

/**
 * Het vlakke vlak op z = 0 van een vorm.
 *
 * Op positie gezocht, niet op grootte. Zie de opmerking bovenaan dit bestand.
 * Geeft null als er geen of meer dan één gevonden wordt - dat is een reden om
 * het profiel als onbruikbaar te melden, niet om te raden.
 */
export function doorsnedeVlakVan(oc, shape) {
    const platVlak = waardeVan(oc.GeomAbs_SurfaceType.GeomAbs_Plane);
    const gevonden = [];

    for (const verkenner = new oc.TopExp_Explorer_2(shape,
             oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
         verkenner.More(); verkenner.Next()) {
        const face = oc.TopoDS.Face_1(verkenner.Current());

        const vlak = new oc.BRepAdaptor_Surface_2(face, true);
        const isPlat = waardeVan(vlak.GetType()) === platVlak;
        vlak.delete();
        if (!isPlat) continue;

        let opNul = true, hoekpunten = 0;
        for (const ve = new oc.TopExp_Explorer_2(face,
                 oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
             ve.More(); ve.Next()) {
            const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex_1(ve.Current()));
            if (Math.abs(p.Z()) > 1e-4) { opNul = false; break; }
            hoekpunten++;
        }
        if (opNul && hoekpunten > 0) gevonden.push(face);
    }

    return gevonden.length === 1 ? gevonden[0] : null;
}

function doosVan(oc, shape) {
    const doos = new oc.Bnd_Box_1();
    try {
        oc.BRepBndLib.Add(shape, doos, false);
        if (doos.IsVoid()) return null;
        const a = doos.CornerMin(), b = doos.CornerMax();
        return { dx: b.X() - a.X(), dy: b.Y() - a.Y(), dz: b.Z() - a.Z() };
    } finally {
        doos.delete();
    }
}

/**
 * De doorsnede van een profiel, pas ingelezen als je hem nodig hebt.
 *
 * @param {object} profiel  een profiel uit de boom, of een profielverwijzing
 * @returns {Promise<{face, maat}>}
 *
 * Gooit een fout met een leesbare tekst als het bestand niet te lezen is of de
 * doorsnede niet te vinden. De aanroeper hoort dat profiel dan als onbruikbaar
 * te tonen; nooit de hele app laten omvallen op één kapot bestand.
 */
export function doorsnedeVan(profiel) {
    const url = profiel.url || ('./profielen/' + profiel.bestand);
    if (bewaard.has(url)) return bewaard.get(url);

    const belofte = leesDoorsnede(profiel, url).catch((err) => {
        // Een mislukking niet bewaren: een volgende poging mag opnieuw proberen,
        // bijvoorbeeld nadat de server met de juiste map herstart is.
        bewaard.delete(url);
        throw err;
    });
    bewaard.set(url, belofte);
    return belofte;
}

async function leesDoorsnede(profiel, url) {
    const oc = await initOcct();

    let bytes;
    try {
        const antwoord = await fetch(url);
        if (!antwoord.ok) throw new Error(`status ${antwoord.status}`);
        bytes = new Uint8Array(await antwoord.arrayBuffer());
    } catch (err) {
        throw new Error(`bestand niet op te halen (${err.message})`);
    }

    // De reader blijft leven zolang de doorsnede bewaard wordt: de vorm leunt
    // op gegevens die erin zitten.
    const { shape, reader } = await leesLosseVorm(bytes);

    const face = doorsnedeVlakVan(oc, shape);
    if (!face) {
        reader.delete();
        throw new Error('geen enkel vlak vlak op z = 0 gevonden');
    }

    const doos = doosVan(oc, face);

    // De opdracht schrijft deze controle voor: de doorsnede moet kloppen met
    // boxSize uit het manifest, binnen 0,01 mm. Klopt dat niet, dan kijk je naar
    // iets anders dan je denkt - bijvoorbeeld het verkeerde vlak.
    const verwacht = (profiel.bron && profiel.bron.boxSize) || profiel.boxSize;
    if (verwacht && doos) {
        const mis = Math.abs(doos.dx - verwacht[0]) > 0.01
                 || Math.abs(doos.dy - verwacht[1]) > 0.01;
        if (mis) {
            reader.delete();
            throw new Error(
                `doorsnede ${doos.dx.toFixed(3)} x ${doos.dy.toFixed(3)} mm past niet `
                + `bij boxSize ${verwacht[0]} x ${verwacht[1]}`);
        }
    }

    return {
        face, reader, doos,
        maat: Math.max(doos ? doos.dx : 1, doos ? doos.dy : 1),
        ...eigenschappenVan(oc, face),
    };
}

/**
 * Oppervlak en zwaartepunt van de doorsnede, uit de VORM gerekend.
 *
 * Waarom dit hier staat en niet uit de catalogus komt: de kolom `ASTEG` is niet
 * het doorsnede-oppervlak. Bij open profielen is het het lijfoppervlak, en bij
 * kokers is het afgerond op drie cijfers. De kiezer toonde ASTEG als "Section
 * area" en dat klopte dus niet.
 *
 * Het ZWAARTEPUNT is geen opsmuk. Het nulpunt van een profiel is het midden van
 * het omhullende doosje en NIET het zwaartepunt. Bij een buis valt dat samen,
 * maar bij hoekstaal, U-profiel en T-staal niet: 152 van de 2337 profielen in
 * de catalogus hebben hun zwaartepunt ergens anders. Bij L 50x50x5 scheelt dat
 * 15 mm. Wie de twee door elkaar haalt, zet zo'n profiel scheef neer.
 *
 * Een gat in het vlak gaat er bij allebei automatisch af.
 */
function eigenschappenVan(oc, face) {
    const eig = new oc.GProp_GProps_1();
    try {
        oc.BRepGProp.SurfaceProperties_1(face, eig, false, false);
        const zw = eig.CentreOfMass();
        return { oppervlak: eig.Mass(), zwaartepunt: [zw.X(), zw.Y()] };
    } finally {
        eig.delete();
    }
}

/**
 * Een staaf: de doorsnede recht op lengte getrokken.
 *
 * Dit is de "Making a member - Straight" uit hoofdstuk 2 van de opdracht. Een
 * gebogen leuning zou met BRepOffsetAPI_MakePipeShell gaan; dat is hier nog niet
 * nodig.
 */
export async function maakStaaf(profiel, lengte) {
    if (!(lengte > 0)) throw new Error(`lengte moet positief zijn (kreeg ${lengte})`);

    // DEZELFDE STAAF WORDT NIET TWEE KEER GETROKKEN.
    //
    // Een balustrade van drie meter met een hoek erin heeft 24 spijlen, en dat
    // zijn 24 keer dezelfde FL 20x5 van dezelfde lengte. Die werden alle 24
    // apart uit het STEP-bestand getrokken. Nagemeten op de zin uit de
    // opdrachtbalk: met blokken kostte die balustrade 0,86 s, met echte
    // profielen 13,77 s - zestien keer zoveel voor dezelfde 64 onderdelen.
    //
    // DIT MAG, en dat is geen aanname. De staaf die hieronder teruggegeven
    // wordt is een EIGEN compound: hij hoort niemand toe en wordt nergens
    // opgeruimd - zie de opmerking hieronder en `eigenVorm` in
    // build-balustrade.js. Wie hem gebruikt snijdt er hooguit iets van af
    // (BRepAlgoAPI_Cut laat zijn invoer met rust) of verplaatst hem met
    // copy=true. Delen is dus veilig.
    //
    // Het scheelt bovendien geheugen in plaats van dat het geheugen kost: tot
    // nu toe werd elke staaf aangemaakt en nooit vrijgegeven.
    // DEZELFDE IDENTITEIT ALS doorsnedeVan, en dat is geen netheid.
    //
    // Hier stond `profiel.url`, en dat ging mis: een profiel dat rechtstreeks
    // uit de catalogus komt heeft helemaal geen `url` - die wordt pas door de
    // profielkiezer toegevoegd. Alle profielen kregen dus de sleutel
    // "undefined|1000" en deelden één staaf. De zelftest ving het: een IPE 200
    // op 1000 mm getrokken leverde 50 x 50 x 1000 op, want dat was de L
    // 50x50x5 die er toevallig vóór langskwam.
    //
    // Twintig regels hoger stond de goede sleutel al. Die gebruiken we nu, en
    // zonder bruikbare identiteit wordt er NIET bewaard: dan maar opnieuw
    // bouwen, want een verkeerde vorm is veel erger dan een trage.
    const naam = profiel && (profiel.url
        || (profiel.bestand && './profielen/' + profiel.bestand));
    const sleutel = naam ? `${naam}|${lengte.toFixed(6)}` : null;
    if (sleutel && staven.has(sleutel)) {
        staafTelling.raak++;
        return staven.get(sleutel);
    }
    staafTelling.mis++;

    const oc = await initOcct();
    const { face } = await doorsnedeVan(profiel);

    const richting = new oc.gp_Vec_4(0, 0, lengte);
    const prisma = new oc.BRepPrimAPI_MakePrism_1(face, richting, false, true);
    try {
        // In een compound stoppen: dan is de vorm van ons en blijft hij geldig
        // nadat het prisma-object weg is. Shape() van een algoritme is maar een
        // verwijzing naar iets dat in dat algoritme zit.
        const bouwer = new oc.BRep_Builder();
        const bundel = new oc.TopoDS_Compound();
        bouwer.MakeCompound(bundel);
        bouwer.Add(bundel, prisma.Shape());
        if (sleutel) onthoudStaaf(sleutel, bundel);
        return bundel;
    } finally {
        prisma.delete();
        richting.delete();
    }
}

/**
 * Driehoeken voor het voorbeeldvenster: de doorsnede op `lengte` getrokken.
 *
 * De opdracht vraagt om 200 mm. Dat is lang genoeg om te zien dat het een staaf
 * is en kort genoeg om de doorsnede te kunnen bekijken.
 */
export async function voorbeeldVan(profiel, lengte = 200) {
    const oc = await initOcct();
    const staaf = await maakStaaf(profiel, lengte);
    const { maat } = await doorsnedeVan(profiel);

    // De fijnheid op de DOORSNEDE afstemmen en niet op de lengte: de ronding van
    // een buis van 21 mm moet je nog zien, ook als hij 200 mm lang is.
    const deflectie = Math.max(maat / 400, 1e-4);
    return { meshes: tessellateer(oc, staaf, deflectie).meshes, maat, lengte, staaf };
}
