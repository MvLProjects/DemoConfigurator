// Bouwt geometrie met OCCT en levert die op als STEP-bytes.
//
// Waarom STEP-bytes en niet meteen driehoekjes voor three.js: de viewer heeft
// al een werkende weg van STEP naar beeld, inclusief edge-selectie en export.
// Door hier STEP terug te geven gaat het gegenereerde model door precies
// dezelfde deur als een bestand dat je zelf inlaadt. Een tussenstap kost wat
// rekentijd, maar scheelt een tweede manier van doen die apart stuk kan gaan.
//
// Er is EEN constructie voor alle gevallen: een balustrade is altijd een pad
// van punten met een staander op elk punt. Een los veld is gewoon een pad van
// twee punten. Zie pad.js voor de meetkunde.

import { initOcct } from './brep-edges.js';
import { berekenSpijlen, valideer, GRENZEN, CONTROLES,
         ontleedVervolg, AFRONDING } from './balustrade-rules.js';
import { maakPad, padDelen, beoordeelPad, verschuifPad, profielDoos } from './pad.js';
import { maakSierpunt } from './sierpunten.js';
import { maakBaluster } from './balusters.js';
import { maakDekband } from './dekbanden.js';
import { maakStaaf } from './profiel-geometrie.js';
import { groepeerVormen, beschrijf } from './onderdelen.js';
import { maakBoom } from './samenstelling.js';
import { materiaalVanDeel, uiterlijkVanDeel } from './materialen.js';

/** Eenvoudig rechthoekig blok, gecentreerd rond de oorsprong in X en Y. */
export async function bouwBlok({ breedte, diepte, hoogte }) {
    for (const [naam, waarde] of Object.entries({ breedte, diepte, hoogte })) {
        if (!Number.isFinite(waarde) || waarde <= 0) {
            throw new Error(`${naam} moet een positief getal zijn (kreeg ${waarde}).`);
        }
        if (waarde > 50_000) {
            throw new Error(`${naam} van ${waarde} mm is onrealistisch groot.`);
        }
    }

    const oc = await initOcct();
    const hoek = new oc.gp_Pnt_3(-breedte / 2, -diepte / 2, 0);
    const maker = new oc.BRepPrimAPI_MakeBox_3(hoek, breedte, diepte, hoogte);

    // Shape() geeft een verwijzing naar iets dat in de maker zit. Zodra de
    // maker weg is, wijst die verwijzing nergens meer naar. builder.Add kopieert
    // de vorm de bundel in, en die bundel is van ons - dus die blijft geldig.
    const builder = new oc.BRep_Builder();
    const bundel = new oc.TopoDS_Compound();
    builder.MakeCompound(bundel);
    try {
        builder.Add(bundel, maker.Shape());
        return { shape: bundel, aantalDelen: 1 };
    } finally {
        maker.delete();
        hoek.delete();
    }
}

// --- stuklijst -------------------------------------------------------------

/**
 * Vat de onderdelen samen tot een stuklijst: gelijke stukken bij elkaar.
 *
 * Een werkplaats denkt in profiel en zaaglengte, niet in dx/dy/dz.
 *
 * Komt een onderdeel uit de catalogus, dan staat er de ECHTE profielnaam:
 * "CHS 48.3x2.6" met de norm erbij. Dat is bestelbaar. "48.3 × 48.3" is dat
 * niet - dat is een buitenmaat waar een dozijn verschillende buizen bij passen,
 * elk met een andere wanddikte en een ander gewicht.
 *
 * Zonder profiel blijft het zoals het was: de twee kleinste maten vormen de
 * omschrijving. Dat geldt nog voor de trapbomen en de treden.
 */
export function stuklijst(delen) {
    const regels = new Map();

    for (const deel of delen) {
        // Dezelfde afleiding als de onderdelenlijst gebruikt; zie onderdelen.js.
        const { soort, lengte, profiel, norm, materiaal, materiaalSleutel,
                afwerking, afwerkingNummer, staalsoorten } = beschrijf(deel);
        // Het MATERIAAL en de AFWERKING horen in de sleutel: twee staanders van
        // dezelfde maat, de een blank en de ander gepoedercoat, zijn twee
        // regels in de stuklijst en twee bewerkingen in de werkplaats.
        const sleutel =
            `${soort}|${profiel}|${norm}|${materiaal}|${afwerking}|${rond(lengte)}`;

        const bestaand = regels.get(sleutel);
        if (bestaand) bestaand.aantal += 1;
        else regels.set(sleutel, { soort: deel.soort, profiel, norm, materiaal,
            materiaalSleutel, afwerking, afwerkingNummer, staalsoorten,
            lengte, aantal: 1 });
    }

    return [...regels.values()]
        .map(r => ({ ...r, totaalLengte: r.lengte * r.aantal }))
        .sort((a, b) => a.soort.localeCompare(b.soort) || a.lengte - b.lengte);
}

const rond = (v) => Math.round(v * 100) / 100;

/**
 * Het materiaal per solid, in de volgorde waarin de solids in de vorm staan.
 *
 * Dat is de volgorde waarin ze aan de compound zijn toegevoegd. Ligt er al een
 * vorm (een ingeladen model waar de leuning op komt), dan gaat DIE eerst en
 * schuiven onze onderdelen op. Die voorste solids zijn niet van ons en krijgen
 * de gewone grijstint.
 *
 * Zonder die verschuiving zou een houten trede de kleur geven aan een vlak van
 * het ingeladen model - en dat zie je pas als iemand er een balustrade op een
 * bestaand bordes bij haalt.
 */
export function materialenVan(oc, delen, bestaandeShape = null) {
    return metVoorloop(oc, bestaandeShape, 'staal', delen.map(materiaalVanDeel));
}

/**
 * Het UITERLIJK per solid: de kleur waarmee hij in beeld komt.
 *
 * Dat is niet hetzelfde als het materiaal. Een gepoedercoate staander is van
 * staal maar je ziet RAL 7016. Zie uiterlijkVanDeel in materialen.js.
 */
export function uiterlijkVan(oc, delen, bestaandeShape = null) {
    return metVoorloop(oc, bestaandeShape, { sleutel: 'staal', kleur: 0xc8ccd0,
        ruwheid: 0.85 }, delen.map(uiterlijkVanDeel));
}

function metVoorloop(oc, bestaandeShape, vulling, rij) {
    if (!bestaandeShape || bestaandeShape.IsNull()) return rij;

    const vooraf = [];
    const verkenner = new oc.TopExp_Explorer_2(bestaandeShape,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
        for (; verkenner.More(); verkenner.Next()) vooraf.push(vulling);
    } finally {
        verkenner.delete();
    }
    return [...vooraf, ...rij];
}

// --- van onderdelen naar OCCT ----------------------------------------------

/**
 * Zet een lijst onderdelen om in OCCT-geometrie.
 *
 * Elk onderdeel is een balk met een eigen assenstelsel. OCCT kan alleen
 * assgerichte blokken maken, dus we bouwen elke balk in de oorsprong en zetten
 * hem daarna op zijn plek. De kolommen van de matrix zijn waar de lokale assen
 * heen gaan; de vierde kolom is de verschuiving.
 */
/**
 * Zet een onderdeel neer met een draaiing plus een verschuiving.
 *
 * De drie assen zijn de kolommen van de draaimatrix, de plek is de vierde
 * kolom. Dat is precies wat gp_Trsf.SetValues verwacht.
 */
function plaatsing(oc, d, plek) {
    const t = new oc.gp_Trsf_1();
    t.SetValues(
        d.xAs[0], d.yAs[0], d.zAs[0], plek[0],
        d.xAs[1], d.yAs[1], d.zAs[1], plek[1],
        d.xAs[2], d.yAs[2], d.zAs[2], plek[2]);
    return t;
}

/**
 * Van een beschrijving van onderdelen naar OCCT-geometrie.
 *
 * Twee soorten onderdelen:
 *
 * - **zonder profiel**: een massief blok van dx bij dy bij dz. Zo was het altijd,
 *   en zo blijven de spijlen, de handregel, de trapbomen en de treden voorlopig.
 * - **met profiel**: de doorsnede uit de catalogus, op lengte getrokken. Dat is
 *   een echt profiel - een buis is hol, met de juiste wanddikte.
 *
 * Het verschil in plaatsing: een blok wordt vanuit zijn HOEK opgebouwd, een
 * profieldoorsnede staat GECENTREERD rond de oorsprong (zo staat het in de
 * geometrie-afspraak van de catalogus). Een profielonderdeel moet dus op het
 * hart van het onderdeel gezet worden en niet op de hoek.
 *
 * LET OP welk hart: de oorsprong van een profiel is het midden van het
 * OMHULLENDE DOOSJE, niet het zwaartepunt. Bij een buis of koker is dat
 * hetzelfde, maar bij hoekstaal, een U-profiel of T-staal niet - bij
 * L 50x50x5 ligt het zwaartepunt 15 mm van het nulpunt vandaan. De plaatsing
 * hieronder rekent met halve dx en halve dy, dus met het doosje, en dat is
 * precies goed. Ga je hier ooit het zwaartepunt gebruiken, dan komen 152 van
 * de 2337 profielen scheef te staan.
 */
async function maakVormUitDelen(oc, delen) {
    const builder = new oc.BRep_Builder();
    const bundel = new oc.TopoDS_Compound();
    builder.MakeCompound(bundel);

    // De LOKALE vorm van elk onderdeel: zoals het uit de zaag komt, nog niet
    // gedraaid of verschoven. Daar wordt later op herkend welke onderdelen
    // hetzelfde zijn, en daar gaat één STEP-bestand per uniek onderdeel uit.
    //
    // Die vorm werd hier eerst weggegooid. Hij ontstaat toch al - één regel
    // boven de plaatsing - dus het kost niets om hem te bewaren.
    const opruimen = [];
    const lokaal = [];

    for (const d of delen) {
        const gemaakt = await maakDeel(oc, d, opruimen);
        builder.Add(bundel, gemaakt.geplaatst);
        lokaal.push({ deel: d, vorm: gemaakt.lokaal });
    }

    return { vorm: bundel, opruimen, lokaal };
}

/**
 * Eén onderdeel: met profiel de echte doorsnede, met gaten een uitgesneden
 * plaat, en anders een massief blok.
 *
 * Geëxporteerd omdat de trap dezelfde leuningonderdelen uit padDelen krijgt.
 * Die werden daar als blok gebouwd terwijl de stuklijst de profielnaam noemde -
 * de lijst beloofde dus een buis en de geometrie leverde massief staal.
 */
export async function maakDeel(oc, d, opruimen) {
    if (d.sierpunt) return sierpuntDeel(oc, d, opruimen);
    if (d.gaten && d.gaten.length) return plaatDeel(oc, d, opruimen);
    if (d.rond) return rondDeel(oc, d, opruimen);
    if (d.dekband) {
        // Een dekband loopt verder gewoon mee: zijn lokale vorm wordt
        // hergebruikt en geplaatst als elk ander liggend onderdeel. Alleen de
        // doorsnede tekenen we zelf in plaats van hem uit een STEP te halen.
        const sleutel = JSON.stringify({ k: d.dekband, m: [d.dx, d.dy, d.dz],
                                         v: d.verstek || [], g: d.doorsteken || [] });
        let lokaal = lokaleVormen.get(sleutel);
        if (!lokaal) {
            lokaal = lokaleDekbandvorm(oc, d, opruimen);
            onthoudVorm(sleutel, lokaal);
        }
        return { geplaatst: plaatsVorm(oc, d, lokaal, opruimen), lokaal };
    }
    if (d.bocht) {
        // Een lasbocht: een kwart torus om zijn middelpunt, hol als de buis
        // hol is. Lokaal om de oorsprong met de z-as als draaias en de x-as
        // als begin; plaatsVorm zet hem met dezelfde assen op zijn plek.
        const b = d.bocht;
        const sleutel = JSON.stringify({ bocht: b });
        let lokaal = lokaleVormen.get(sleutel);
        if (!lokaal) {
            const nul = new oc.gp_Pnt_3(0, 0, 0);
            const as = new oc.gp_Ax2_2(nul, new oc.gp_Dir_4(0, 0, 1), new oc.gp_Dir_4(1, 0, 0));
            const buiten = new oc.BRepPrimAPI_MakeTorus_6(as, b.straal, b.buiten, Math.PI / 2);
            let vorm = buiten.Shape();
            if (b.binnen > 0) {
                const binnen = new oc.BRepPrimAPI_MakeTorus_6(as, b.straal, b.binnen, Math.PI / 2);
                const snede = new oc.BRepAlgoAPI_Cut_3(vorm, binnen.Shape(),
                    new oc.Message_ProgressRange_1());
                snede.Build(new oc.Message_ProgressRange_1());
                vorm = snede.Shape();
                opruimen.push(binnen);
            }
            opruimen.push(nul, as, buiten);
            lokaal = eigenVorm(oc, vorm);
            onthoudVorm(sleutel, lokaal);
        }
        return { geplaatst: plaatsVorm(oc, d, lokaal, opruimen), lokaal };
    }
    if (d.doorsnede) {
        // Een eigen doorsnede, zoals het bodemprofiel en de kaplijst van glas
        // zonder staanders. Zie lokalePrismavorm.
        const sleutel = JSON.stringify({ s: d.doorsnede, m: [d.dx, d.dy, d.dz],
                                         v: d.verstek || [] });
        let lokaal = lokaleVormen.get(sleutel);
        if (!lokaal) {
            lokaal = lokalePrismavorm(oc, d, opruimen);
            onthoudVorm(sleutel, lokaal);
        }
        return { geplaatst: plaatsVorm(oc, d, lokaal, opruimen), lokaal };
    }
    if (d.baluster) {
        // Een gedraaide baluster loopt verder gewoon mee: zijn LOKALE vorm
        // wordt hieronder op dezelfde manier hergebruikt en geplaatst als een
        // blok of een profiel. Alleen de vorm zelf komt van de draaibank.
        const sleutel = balusterSleutel(d);
        let lokaal = lokaleVormen.get(sleutel);
        if (!lokaal) {
            lokaal = await lokaleBalustervorm(oc, d, opruimen);
            onthoudVorm(sleutel, lokaal);
        }
        return { geplaatst: plaatsVorm(oc, d, lokaal, opruimen), lokaal };
    }

    // DE LOKALE VORM WORDT HERGEBRUIKT, DE PLAATSING NIET.
    //
    // Dit is de reparatie waar het om begonnen was, en hij is gemeten. Op een
    // leuning van 3 meter met een hoek erin kostte het bouwen van de vormen
    // 12,5 s zodra de staander én de handregel allebei een BUIS zijn. Per
    // profiel apart gemeten, alleen de vormen, per bouw:
    //
    //     alleen de 36 spijlen (FL 20x5)        0,62 s   - niets
    //     alleen de 7 staanders (CHS 48,3)      0,66 s   - niets
    //     alleen de handregel (CHS 33,7)        1,33 s
    //     staander EN handregel samen          12,49 s   <--
    //
    // De oorzaak is de VISMUIL. Elke staander krijgt een zadel uitgesneden
    // waar de handregel overheen loopt. Is die regel een blok, dan is dat een
    // rechthoekige hap. Zijn het allebei buizen, dan snijdt een gebogen vlak
    // door een gebogen vlak, en dat is het duurste wat OCCT kent. Zeven
    // staanders, zeven vismuilen.
    //
    // En die zeven zijn niet zeven verschillende stukken staal: dezelfde buis,
    // dezelfde lengte, hetzelfde zadel. De onderdeelherkenning zegt dat ook al,
    // alleen pas NA het bouwen - dus werd zeven keer dezelfde snede gemaakt om
    // daarna vast te stellen dat het er twee of drie waren.
    //
    // De sleutel bevat ALLES wat de lokale vorm bepaalt. Mist er een veld, dan
    // krijgen twee verschillende onderdelen dezelfde vorm, en dat is een
    // stillere fout dan traag zijn. Daarom staat hij vlak bij de code die hem
    // gebruikt en niet ergens onderaan.
    const sleutel = vormSleutel(d);
    let lokaal = sleutel ? lokaleVormen.get(sleutel) : null;
    if (!lokaal) {
        lokaal = d.profiel ? await lokaleProfielvorm(oc, d, opruimen)
                           : await lokaleBlokvorm(oc, d, opruimen);
        if (sleutel) onthoudVorm(sleutel, lokaal);
    }
    return { geplaatst: plaatsVorm(oc, d, lokaal, opruimen), lokaal };
}

/**
 * De vingerafdruk van alles wat de LOKALE vorm van een onderdeel bepaalt.
 *
 * Niet de plaats, niet de draaiing, niet het materiaal: alleen wat er uit de
 * zaag komt. Twee onderdelen met dezelfde sleutel zijn hetzelfde stuk staal.
 *
 * Geeft null als er niets te winnen valt of als er iets in staat wat hier niet
 * betrouwbaar in een sleutel te vatten is. Geen sleutel betekent gewoon
 * opnieuw bouwen - trager, maar nooit verkeerd.
 */
function vormSleutel(d) {
    // Een profiel is een object met functies erin; alleen zijn adres telt.
    const prof = (p) => (p ? (p.url || p.englishLabel || p.label || '?') : null);
    const sneden = (lijst) => (lijst || []).map(u => ({
        ...u, profiel: prof(u.profiel),
    }));
    try {
        return JSON.stringify({
            p: prof(d.profiel),
            as: d.lengteAs || 'z',
            m: [d.dx, d.dy, d.dz],
            v: d.verstek || [],
            z: sneden(d.zadel),
            k: sneden(d.uitklinken),
            a: d.afronden || null,
            g: d.doorsteken || [],
        });
    } catch {
        return null;            // iets wat niet in JSON past: dan maar opnieuw
    }
}

// De lokale vormen van deze sessie. Begrensd om dezelfde reden als de staven
// in profiel-geometrie.js: de oudste valt eruit maar wordt NIET verwijderd,
// want een al gebouwd onderdeel verwijst er nog naar - zijn lokale vorm gaat
// mee naar de stuklijst, de tekeningen en de STEP-export.
const MAX_VORMEN = 192;
const lokaleVormen = new Map();

function onthoudVorm(sleutel, vorm) {
    lokaleVormen.set(sleutel, vorm);
    while (lokaleVormen.size > MAX_VORMEN) {
        lokaleVormen.delete(lokaleVormen.keys().next().value);
    }
}

/** Een gemaakte lokale vorm op zijn plek in het model zetten. */
function plaatsVorm(oc, d, lokaal, opruimen) {
    let assen = d;
    let plek = d.oorsprong;
    if (d.profiel) {
        // Een profiel staat langs zijn eigen +Z met de doorsnede op de
        // oorsprong; een blok loopt vanaf zijn hoek. Halve dx en halve dy
        // erbij zet je op het hart. De lengterichting krijgt géén halve maat:
        // daar begint de staaf.
        const halve = { x: d.dx / 2, y: d.dy / 2, z: d.dz / 2 };
        halve[d.lengteAs || 'z'] = 0;
        plek = [0, 1, 2].map(as =>
            d.oorsprong[as] + d.xAs[as] * halve.x
                            + d.yAs[as] * halve.y
                            + d.zAs[as] * halve.z);
        assen = draaiingVoor(d);
    }
    const t = plaatsing(oc, assen, plek);
    const verplaatser = new oc.BRepBuilderAPI_Transform_2(lokaal, t, true);
    opruimen.push(t, verplaatser);
    return verplaatser.Shape();
}

/**
 * Een sierpunt of paalkop: de decoratieve kop.
 *
 * De vorm komt uit sierpunten.js, met zijn voet op z = 0 en gecentreerd op de
 * as. De rest van de machinerie rekent met het omhullende doosje vanuit de
 * HOEK - zo doet rondDeel het ook - dus hij wordt een halve breedte opgeschoven
 * voordat hij op zijn plek gaat.
 *
 * Daarmee hoeft niets anders iets van ornamenten te weten: de stuklijst, de
 * onderdeelherkenning, de STEP-export per onderdeel en de maatvoering werken
 * allemaal op dezelfde `delen`-lijst en zien gewoon een onderdeel met een
 * doosje eromheen.
 */
function sierpuntDeel(oc, d, opruimen) {
    // HETZELFDE ORNAMENT WORDT NIET TWEE KEER GEBOUWD.
    //
    // Op een leuning met een punt op elke spijl staan er al gauw 36 dezelfde
    // speerpunten, en elk daarvan is een stapeltje bollen, kegels en fusies.
    // Die werden alle 36 van nul opgebouwd. Nagemeten op een balustrade van 3
    // meter met een hoek: de punten kostten 3,0 s van de 11,5 s.
    //
    // Wat bewaard wordt is de EIGEN compound, en dat is precies de vorm die
    // ook naar de stuklijst en de STEP-export gaat. Die blijft geldig nadat
    // `opruimen` geleegd is - daar rekent de hele app al op - dus hij mag ook
    // een volgende bouw mee.
    const sleutel = `${d.sierpunt}|${d.sierpuntVoet}|${d.dz}|${d.dx}|${d.dy}`
        + `|${d.sierpuntRond ? 'rond' : 'vierkant'}`;
    let eigen = sierpunten.get(sleutel);
    if (!eigen) {
        const vorm = maakSierpunt(oc, d.sierpunt,
            { b: d.sierpuntVoet, h: d.dz, rond: Boolean(d.sierpuntRond) }, opruimen);

        // Van gecentreerd naar vanuit-de-hoek, net als bij een cilinder.
        const naarHoek = new oc.gp_Trsf_1();
        naarHoek.SetValues(1, 0, 0, d.dx / 2, 0, 1, 0, d.dy / 2, 0, 0, 1, 0);
        const gezet = new oc.BRepBuilderAPI_Transform_2(vorm, naarHoek, true);
        opruimen.push(naarHoek, gezet);

        eigen = eigenVorm(oc, gezet.Shape());
        onthoudSierpunt(sleutel, eigen);
    }

    const t = plaatsing(oc, d, d.oorsprong);
    const verplaatser = new oc.BRepBuilderAPI_Transform_2(eigen, t, true);
    opruimen.push(t, verplaatser);
    return { geplaatst: verplaatser.Shape(), lokaal: eigen };
}

// Per model, voetmaat, hoogte en vorm: het ornament zoals het er los uitziet.
// Begrensd om dezelfde reden als de staven in profiel-geometrie.js: de oudste
// gaat eruit maar wordt niet verwijderd, want een al gebouwd onderdeel kan er
// nog naar verwijzen.
const MAX_SIERPUNTEN = 64;
const sierpunten = new Map();

function onthoudSierpunt(sleutel, vorm) {
    sierpunten.set(sleutel, vorm);
    while (sierpunten.size > MAX_SIERPUNTEN) {
        sierpunten.delete(sierpunten.keys().next().value);
    }
}

/**
 * Een rond schijfje: de afdekkap op een ronde staander.
 *
 * Een kap op een buis hoort rond te zijn; een vierkant plaatje op een ronde
 * paal is geen product. De maten komen binnen als een blok - dx bij dy bij dz -
 * en dx is dan de diameter. Zo hoeft de rest van de machinerie niets te weten
 * van ronde onderdelen: de stuklijst, de maatvoering en de herkenning rekenen
 * gewoon met het omhullende doosje, en dat klopt voor een cilinder ook.
 */
function rondDeel(oc, d, opruimen) {
    // Vanuit de HOEK van het doosje opgebouwd, net als een blok, zodat de
    // plaatsing hieronder dezelfde is. Het hart ligt dus op een halve diameter.
    const voet = new oc.gp_Pnt_3(d.dx / 2, d.dy / 2, 0);
    const omhoog = new oc.gp_Dir_4(0, 0, 1);
    const as = new oc.gp_Ax2_3(voet, omhoog);
    const maker = new oc.BRepPrimAPI_MakeCylinder_3(as, d.dx / 2, d.dz);
    opruimen.push(voet, omhoog, as, maker);

    // Ook een rond deel kan een verstek hebben: de wandleuning van een trap
    // knikt bij een bordes, en twee cilinders die elkaar daar overlappen zijn
    // staal op twee plekken. Zonder verstek verandert er niets aan de vorm.
    const vorm = metVerstek(oc, d, maker.Shape(), opruimen);
    const eigen = eigenVorm(oc, vorm);
    const t = plaatsing(oc, d, d.oorsprong);
    const verplaatser = new oc.BRepBuilderAPI_Transform_2(vorm, t, true);

    opruimen.push(t, verplaatser);
    return { geplaatst: verplaatser.Shape(), lokaal: eigen };
}

/**
 * De uitsparingen voor de handregel uit een staanderkop snijden.
 *
 * Dit gebeurt op de LOKALE vorm, vóór het onderdeel op zijn plek gaat. Dat is
 * niet alleen makkelijker rekenen: de onderdeelherkenning kijkt juist naar die
 * lokale vorm, en dáár moet het verschil tussen een eindstaander met één
 * uitsparing en een middenstaander met twee dus in zitten. Doe je het na het
 * plaatsen, dan zijn alle staanders in hun eigen stelsel nog steeds gelijk.
 *
 * `midden` is waar het hart van de doorsnede ligt in het lokale stelsel: een
 * profiel staat gecentreerd op de oorsprong, dus [0, 0], maar een blok wordt
 * vanuit zijn HOEK opgebouwd, dus [dx/2, dy/2]. Zonder dat onderscheid zou de
 * uitsparing bij een blok een halve staander naast de handregel zitten.
 *
 * Geeft de vorm ONGEWIJZIGD terug als er niets uit te snijden valt. Een leuning
 * zonder uitklinken levert dan letterlijk dezelfde vorm op als voorheen - geen
 * extra compound eromheen, geen andere vingerafdruk.
 */
/**
 * De bovenhoeken van een staander afronden, aan beide kanten dwars op de
 * regel. Zie `afronden` in pad.js en regels.json onder _afronding.
 *
 * Per kant een mes: een blok over de hoek, met een cilinder eruit die de boog
 * vormt. Wat er van het mes overblijft gaat van de staander af. De cilinder
 * loopt langs x, de richting van de regel. `midden` is het hart van de
 * doorsnede in de lokale vorm, net als bij metUitklinken.
 */
function metAfronding(oc, d, vorm, midden, opruimen) {
    const a = d.afronden;
    if (!a || !(a.straal > 0)) return vorm;
    // Per kant een eigen straal: met de regel vóór de staander steekt alleen
    // de achterkant uit. Zonder `kanten` aan beide kanten dezelfde.
    const kanten = a.kanten || [{ kant: 1, straal: a.straal }, { kant: -1, straal: a.straal }];
    // HET MES IN DE ASSEN VAN DE KOP: x langs de regel, y dwars (de y van de
    // staander), z loodrecht op de kop. Op een vlak stuk is dat gewoon x, y
    // en omhoog; op een trap kantelt het mee met de helling. Zonder `op` (een
    // oudere beschrijving) een vlakke kop op dz.
    const zAs = a.op || [0, 0, 1];
    const yAs = [0, 1, 0];
    const xAs = [yAs[1] * zAs[2] - yAs[2] * zAs[1], yAs[2] * zAs[0] - yAs[0] * zAs[2],
                 yAs[0] * zAs[1] - yAs[1] * zAs[0]];
    const p0 = a.punt || [0, 0, d.dz];
    const plek = [midden[0] + p0[0], midden[1] + p0[1], p0[2]];
    const lang = 3 * (d.dx + d.dy) + 100;
    for (const { kant, straal: r } of kanten) {
        // In de assen van de kop: de rand op y = kant * halfDwars, de kop op z = 0.
        const rand = kant * a.halfDwars;
        const y0 = Math.min(rand - kant * r, rand + kant * 1);
        const hoek = new oc.gp_Pnt_3(-lang / 2, y0, -r);
        const blok = new oc.BRepPrimAPI_MakeBox_3(hoek, lang, r + 1, r + 1);
        const asPunt = new oc.gp_Pnt_3(-lang / 2, rand - kant * r, -r);
        const asRichting = new oc.gp_Dir_4(1, 0, 0);
        // De naad recht omlaag, buiten het mes: dan ligt hij voor beide kanten
        // even ver van de rand, en is een gespiegelde staander dezelfde vorm.
        // Zie rondeStaaf.
        const naad = new oc.gp_Dir_4(0, 0, -1);
        const as = new oc.gp_Ax2_2(asPunt, asRichting, naad);
        const cilinder = new oc.BRepPrimAPI_MakeCylinder_3(as, r, lang);
        const mes = new oc.BRepAlgoAPI_Cut_3(blok.Shape(), cilinder.Shape(),
            new oc.Message_ProgressRange_1());
        mes.Build(new oc.Message_ProgressRange_1());
        const t = plaatsing(oc, { xAs, yAs, zAs }, plek);
        const gezet = new oc.BRepBuilderAPI_Transform_2(mes.Shape(), t, true);
        const snede = new oc.BRepAlgoAPI_Cut_3(vorm, gezet.Shape(),
            new oc.Message_ProgressRange_1());
        snede.Build(new oc.Message_ProgressRange_1());
        vorm = snede.Shape();
        opruimen.push(hoek, blok, asPunt, asRichting, naad, as, cilinder, mes, t, gezet);
    }
    return vorm;
}

/**
 * De randen langs het zadel afronden met R2, zoals bij Marthijn.
 *
 * Het zadel is een rond vlak met de straal van de buis. Waar het een plat vlak
 * van de staander raakt - de kop, of de zijkant als de staander smaller is dan
 * de buis - loopt een rechte rand evenwijdig aan de regel. Die randen, en
 * alleen die, worden afgerond. Lukt het niet, dan blijft de vorm zoals hij
 * was: een scherpe rand is beter dan een staander die niet gebouwd wordt.
 */
function metZadelRanden(oc, d, vorm, opruimen) {
    const z = (d.zadel || []).find(u => u.rond);
    const straal = AFRONDING.zadelStraal;
    if (!z || !(straal > 0)) return vorm;
    const r = z.hoogte / 2;
    const ev = (e) => (e && typeof e === 'object' && 'value' in e) ? e.value : e;
    const lang = Math.hypot(...z.langs);
    const as = z.langs.map(c => c / lang);
    try {
        const randen = [];
        const fe = new oc.TopExp_Explorer_2(vorm, oc.TopAbs_ShapeEnum.TopAbs_FACE,
            oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        for (; fe.More(); fe.Next()) {
            const f = oc.TopoDS.Face_1(fe.Current());
            const vlak = new oc.BRepAdaptor_Surface_2(f, true);
            opruimen.push(vlak);
            if (ev(vlak.GetType()) !== ev(oc.GeomAbs_SurfaceType.GeomAbs_Cylinder)) continue;
            if (Math.abs(vlak.Cylinder().Radius() - r) > 0.05) continue;
            const ee = new oc.TopExp_Explorer_2(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE,
                oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            for (; ee.More(); ee.Next()) {
                const e = oc.TopoDS.Edge_1(ee.Current());
                const c = new oc.BRepAdaptor_Curve_2(e);
                opruimen.push(c);
                if (ev(c.GetType()) !== ev(oc.GeomAbs_CurveType.GeomAbs_Line)) continue;
                const dir = c.Line().Direction();
                if (Math.abs(dir.X() * as[0] + dir.Y() * as[1] + dir.Z() * as[2]) < 0.999) continue;
                if (!randen.some(x => x.IsSame(e))) randen.push(e);
            }
            ee.delete();
        }
        fe.delete();
        if (!randen.length) return vorm;
        const rond = new oc.BRepFilletAPI_MakeFillet(vorm, oc.ChFi3d_FilletShape.ChFi3d_Rational);
        for (const e of randen) rond.Add_2(straal, e);
        rond.Build(new oc.Message_ProgressRange_1());
        if (!rond.IsDone()) return vorm;
        // `rond` niet opruimen: zijn resultaat is de vorm waar we mee verder gaan.
        return rond.Shape();
    } catch (err) {
        console.warn('R2 langs het zadel lukte niet; de staander blijft zonder.', err);
        return vorm;
    }
}

async function metUitklinken(oc, d, vorm, midden, opruimen) {
    // Het ZADEL eerst: dat is de ruimte die de handregel inneemt, en die moet
    // er altijd uit. De bedden daarna; die zijn een keuze (het vinkje
    // "staanderkop uitklinken"). Twee lijsten en niet één, zodat "hoeveel
    // bedden heeft deze staander" blijft betekenen wat het zegt - de
    // onderdeelherkenning splitst er immers op.
    const lijst = [...(d.zadel || []), ...(d.uitklinken || [])]
        .filter(u => u.diepte > 0);
    if (lijst.length === 0) return vorm;

    for (const u of lijst) {
        const snijder = await klinkSnijder(oc, d, u, midden, opruimen);
        const snede = new oc.BRepAlgoAPI_Cut_3(
            vorm, snijder, new oc.Message_ProgressRange_1());
        snede.Build(new oc.Message_ProgressRange_1());
        vorm = snede.Shape();
        // `snede` NIET opruimen: zijn resultaat is de vorm waar we mee verder
        // gaan. Zelfde reden als bij de gaten in de voetplaat hierboven.
    }

    // NATELLEN of het nog één stuk staal is.
    //
    // In een hoek komen twee handregels onder een scherpe hoek binnen en liggen
    // de twee uitsparingen naast elkaar in plaats van tegenover elkaar. Snijden
    // die elkaar aan, dan zaag je bij een buis een stuk wand los en valt de
    // staander uiteen - en daar is in de stuklijst niets van te zien, want naam,
    // profiel en lengte blijven gewoon kloppen. Dat is precies het soort fout
    // dat pas in de werkplaats opvalt.
    //
    // De diepte in regels.json is zo gekozen dat dit niet gebeurt, maar dat is
    // nagemeten op ÉÉN combinatie. Er zijn 2337 profielen; dit telt het na voor
    // alle andere.
    const aantal = telSolids(oc, vorm);
    if (aantal !== 1) {
        const staander = naamVan(d.profiel) || 'de staander';
        const regel = naamVan(lijst[0].profiel) || 'de handregel';
        throw new Error(
            `De staanderkop valt uit elkaar bij het uitklinken: er blijven `
            + `${aantal} losse stukken over. ${regel} is te zwaar om er `
            + `${lijst.length}× een bed voor in ${staander} te snijden, zeker `
            + 'waar twee regels onder een hoek samenkomen. Kies een zwaardere '
            + 'staander, een lichtere handregel, of zet "staanderkop uitklinken" '
            + 'uit.');
    }
    return vorm;
}

const naamVan = (profiel) => profiel && (profiel.englishLabel || profiel.label) || null;

/** Kruisproduct, om uit twee assen de derde te maken. */
const kruisProduct = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];

const opEen = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l < 1e-12 ? a : [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Twee richtingen die loodrecht op `n` staan, zodat er een assenstelsel is.
 *
 * Welke twee maakt niet uit: het mes dat hieronder gebouwd wordt is rondom
 * ruim, dus alleen de derde as (n zelf) doet iets. Als hulpas de KLEINSTE
 * component van n nemen, want dan is het kruisproduct het grootst en blijft
 * het rekenwerk stabiel ook als n bijna langs een as ligt.
 */
function dwarsassen(n) {
    const abs = n.map(Math.abs);
    const hulp = abs[0] <= abs[1] && abs[0] <= abs[2] ? [1, 0, 0]
               : abs[1] <= abs[2] ? [0, 1, 0] : [0, 0, 1];
    const xAs = opEen(kruisProduct(n, hulp));
    return { xAs, yAs: kruisProduct(n, xAs) };
}

/**
 * Van de LOGISCHE assen van een onderdeel naar het stelsel van zijn lokale vorm.
 *
 * Een onderdeel wordt beschreven als een doosje: u langs xAs van 0 tot dx, v
 * langs yAs van 0 tot dy, w langs zAs van 0 tot dz. Maar de lokale vorm staat
 * er niet altijd zo in:
 *
 *   - een BLOK wordt vanuit zijn hoek opgebouwd, dus lokaal = logisch
 *   - een PROFIEL komt als staaf langs zijn eigen +Z uit de catalogus, met de
 *     doorsnede GECENTREERD op de oorsprong. Welke logische as de lengte is,
 *     staat in `lengteAs`; die moet op de derde plek komen (zie draaiingVoor),
 *     en de andere twee krijgen hun halve maat eraf omdat ze gecentreerd staan.
 *
 * Geeft een omzetting voor een PUNT en een voor een RICHTING. Zonder dit
 * onderscheid zou een verstekvlak bij een profiel een halve doorsnede naast de
 * regel liggen - dezelfde valkuil als `midden` bij het uitklinken.
 */
function logischNaarLokaal(d) {
    const maten = [d.dx, d.dy, d.dz];
    if (!d.profiel) {
        return { punt: (q) => [...q], richting: (q) => [...q] };
    }
    // draaiingVoor schuift de assen op zodat de lengteas de derde wordt.
    const orde = { x: [1, 2, 0], y: [2, 0, 1], z: [0, 1, 2] }[d.lengteAs || 'z'];
    const lengteIndex = { x: 0, y: 1, z: 2 }[d.lengteAs || 'z'];
    const midden = orde.map(i => i === lengteIndex ? 0 : maten[i] / 2);
    return {
        punt: (q) => orde.map((i, k) => q[i] - midden[k]),
        richting: (q) => orde.map(i => q[i]),
    };
}

/**
 * Het verstek aan de einden van een onderdeel zagen.
 *
 * Elk verstek is een HALFRUIMTE: alles aan de kant waar `richting` heen wijst
 * gaat eraf. Het mes is een ruim blok waarvan één vlak op het verstekvlak ligt.
 *
 * Dit gebeurt op de LOKALE vorm, net als het uitklinken, en om dezelfde reden:
 * de onderdeelherkenning kijkt naar die lokale vorm. Een handregel met verstek
 * aan twee kanten is een ander stuk staal dan een met verstek aan één kant, en
 * dat verschil moet er dus IN zitten en niet alleen in zijn plaatsing.
 */
function metVerstek(oc, d, vorm, opruimen) {
    const lijst = d.verstek || [];
    if (lijst.length === 0) return vorm;

    const om = logischNaarLokaal(d);
    // Ruim om het onderdeel heen, zodat het mes er altijd voorbij reikt.
    const maat = 4 * (d.dx + d.dy + d.dz) + 100;

    for (const v of lijst) {
        const n = opEen(om.richting(v.richting));
        const assen = dwarsassen(n);
        const hoek = new oc.gp_Pnt_3(-maat, -maat, 0);
        const mes = new oc.BRepPrimAPI_MakeBox_3(hoek, 2 * maat, 2 * maat, maat);
        const t = plaatsing(oc, { ...assen, zAs: n }, om.punt(v.punt));
        const gezet = new oc.BRepBuilderAPI_Transform_2(mes.Shape(), t, true);

        const snede = new oc.BRepAlgoAPI_Cut_3(
            vorm, gezet.Shape(), new oc.Message_ProgressRange_1());
        snede.Build(new oc.Message_ProgressRange_1());
        vorm = snede.Shape();

        opruimen.push(hoek, mes, t, gezet);
        // `snede` NIET opruimen: zijn resultaat is de vorm waar we mee verder
        // gaan. Zelfde reden als bij het uitklinken en de gaten.
    }

    // NATELLEN. Een verstek hoort een hoekje af te zagen, niet het hele
    // onderdeel. Staat de richting per ongeluk omgekeerd, dan blijft er NIETS
    // over - en dat is in beeld een onzichtbaar onderdeel en in de stuklijst
    // een regel die er gewoon staat. Precies het soort fout dat pas in de
    // werkplaats opvalt, dus hier tegenhouden.
    const aantal = telSolids(oc, vorm);
    if (aantal !== 1) {
        throw new Error(
            `De schuine snede aan ${d.soort} laat ${aantal} stukken over in `
            + `plaats van 1. De richting van een snijvlak staat verkeerd.`);
    }
    return vorm;
}

/**
 * De gaten voor DOORGESTOKEN SPIJLEN uit een liggend onderdeel snijden.
 *
 * Op de hekken die de opdrachtgever aanwees loopt elke spijl door de bovenste
 * regel heen en eindigt erboven in een punt. Zo'n staaf vraagt een gat, en dat
 * gat wordt hier echt uit het staal gehaald. Niet uit netheid: zonder gat staat
 * er staal in staal, en de doorsnijdingscontrole slaat daar terecht op aan. In
 * de werkplaats gaat het ook zo - het gat wordt in de regel geponst en de staaf
 * gaat erdoor.
 *
 * Dit gebeurt op de LOKALE vorm, net als het verstek en het uitklinken, en om
 * dezelfde reden: de onderdeelherkenning kijkt naar die lokale vorm. Twee
 * regels met hetzelfde gatenpatroon zijn één productieonderdeel; een regel mét
 * gaten is een ander stuk staal dan een zonder.
 *
 * DE SNIJDER IS DE OMHULLENDE VAN DE SPIJL, niet zijn doorsnede. Bij een
 * ronde buis is dat een massieve cilinder. Snijd je met de holle ringdoorsnede,
 * dan blijft de kern van de buisholte als los staal in het gat staan - precies
 * de valkuil die bij het zadel in klinkSnijder al is nagemeten.
 */
function metDoorsteken(oc, d, vorm, opruimen) {
    const lijst = d.doorsteken || [];
    if (lijst.length === 0) return vorm;

    const om = logischNaarLokaal(d);
    // Ruim aan beide kanten het onderdeel uit: snijd je precies tot het
    // oppervlak, dan laat OCCT er soms een flinterdun vlakje staan. Zelfde
    // reden als de boor die een millimeter uit de voetplaat steekt.
    const lengte = 4 * (d.dx + d.dy + d.dz) + 100;
    // EEN GEPONST GAT IS GEEN PERSPASSING. De staaf valt erdoor en wordt
    // vastgelast. Dezelfde speling als een bed; het getal staat in regels.json
    // zodat er één plek is waar eraan gedraaid kan worden.
    const speling = CONTROLES.bedSpeling;

    for (const g of lijst) {
        const n = opEen(om.richting(g.richting));
        // De doorsnede van het gat moet MEEDRAAIEN met de staaf: een vierkante
        // spijl vraagt een vierkant gat in dezelfde stand. Met willekeurige
        // dwarsassen zou het gat scheef in de regel staan.
        const b = opEen(om.richting(g.breedteRichting));
        const assen = { xAs: b, yAs: kruisProduct(n, b), zAs: n };

        const snijder = g.rond
            ? rondeStaaf(oc, Math.max(g.breedte, g.diepte) + 2 * speling,
                         lengte, opruimen)
            : blokStaaf(oc, g.breedte + 2 * speling, g.diepte + 2 * speling,
                        lengte, opruimen);
        // De staaf loopt vanaf zijn oorsprong langs +Z; een halve lengte terug
        // zet hem symmetrisch om het punt op de hartlijn.
        const plek = om.punt(g.punt).map((c, k) => c - n[k] * lengte / 2);
        const t = plaatsing(oc, assen, plek);
        const gezet = new oc.BRepBuilderAPI_Transform_2(snijder, t, true);

        const snede = new oc.BRepAlgoAPI_Cut_3(
            vorm, gezet.Shape(), new oc.Message_ProgressRange_1());
        snede.Build(new oc.Message_ProgressRange_1());
        vorm = snede.Shape();

        opruimen.push(t, gezet);
        // `snede` NIET opruimen: zijn resultaat is de vorm waar we mee verder
        // gaan. Zelfde reden als bij het verstek en het uitklinken.
    }

    // NATELLEN. Een gat hoort een gat te zijn, geen doorzaging. Staan de gaten
    // te dicht bij elkaar of is de regel te smal, dan valt hij uit elkaar - en
    // dat is in beeld een regel die er nog staat en in de stuklijst één regel
    // staal, terwijl er in de werkplaats losse stukjes uit de pons komen.
    const aantal = telSolids(oc, vorm);
    if (aantal !== 1) {
        // DE MELDING MOET DE JUISTE UITWEG NOEMEN, en dat deed hij niet.
        //
        // Hier stond "kies een bredere regel, een smallere spijl of een
        // grotere maximale doorgang". Die laatste helpt niet: een grotere
        // doorgang geeft minder spijlen, maar het gat wordt er geen millimeter
        // smaller van. En dat is nu juist wat er misgaat.
        //
        // Nagemeten met FL 30x6 als spijl: zo'n platte staaf staat met zijn
        // BREDE kant dwars op de leuning, dus hij is daar 30 mm - precies zo
        // breed als de vulregel waar hij doorheen moet. Het gat eet de regel
        // in zijn volle breedte op en er blijven 8 losse stukjes over. Met
        // FL 20x5 (20 mm dwars) past het wel.
        //
        // Daarom de MATEN erbij: dan hoef je niet te raden hoeveel smaller.
        const g = lijst[0];
        throw new Error(
            `${d.soort} valt uit elkaar bij het boren van de spijlgaten: `
            + `${aantal} losse stukken in plaats van 1. Het gat is `
            + `${g.breedte} x ${g.diepte} mm, en de ${d.soort} is maar `
            + `${d.dy} x ${d.dz} mm - daar blijft niets van over. Neem een `
            + 'smallere spijl, of maak de vulregel breder met de stripbreedte.');
    }
    return vorm;
}

/** Hoeveel losse stukken staal een vorm bevat. */
function telSolids(oc, vorm) {
    let aantal = 0;
    const verkenner = new oc.TopExp_Explorer_2(vorm,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
        for (; verkenner.More(); verkenner.Next()) aantal++;
    } finally {
        verkenner.delete();
    }
    return aantal;
}

/**
 * Het stuk staal dat uit de staanderkop weg moet: de handregel zelf.
 *
 * Met een profiel is dat de echte doorsnede, dus bij een buis wordt het een
 * vismuil. Zonder profiel een rechthoekige sparing van breedte bij hoogte.
 *
 * De snijder begint `diepte` binnen de buitenkant van de staander en loopt
 * daarvandaan naar BUITEN, ruim de staander uit. Door hem buiten door te laten
 * steken valt er geen snijvlak samen met het oppervlak van de staander; snijd
 * je precies tot de rand, dan laat OCCT er soms een flinterdun vlakje staan -
 * dezelfde reden waarom de boor in de voetplaat er een millimeter uitsteekt.
 *
 * De buitenkant wordt op `staanderbreedte / 2` van de hartlijn gelegd. Voor een
 * ronde staander klopt dat in elke richting, ook in een hoek waar de handregel
 * schuin binnenkomt. Voor een VIERKANTE staander klopt het langs de vlakken,
 * maar komt de uitsparing in een hoek dieper uit dan de nominale diepte, omdat
 * er over de diagonaal meer materiaal staat. Hij blijft ruim binnen de
 * afkapgrens uit regels.json, dus de staander valt nooit doormidden.
 */
async function klinkSnijder(oc, d, u, midden, opruimen) {
    const breedte = Math.max(d.dx, d.dy);
    // Een BED begint `diepte` binnen de buitenkant en loopt naar buiten; een
    // ZADEL moet er dwars doorheen. Voor dat laatste is de staaf ruim en
    // symmetrisch om het hart.
    //
    // Niet met de bedformule proberen: met diepte = staanderbreedte komt die op
    // een staaf die precies zo lang is als de koorde door de staander (bij 45
    // graden allebei 68 mm). Dan valt het kopvlak van de snijder samen met het
    // oppervlak van de staander, en daar laat OCCT soms een flinterdun vlakje
    // staan - dezelfde reden waarom de boor in de voetplaat er een millimeter
    // uitsteekt.
    const lengte = u.door ? breedte * 6 : breedte * 2;

    // SPELING op een bed. Een bed is een ZAK waar een regel in valt, geen
    // pasvorm. Snijd je hem exact zo groot als de regel, dan moet elk vlak tot
    // op de micrometer kloppen - en dat lukt op een helling niet, want de kop
    // van de regel en de bodem van het bed staan daar onder verschillende
    // hoeken. Nagemeten bleef er dan 100 tot 170 mm3 staal in staal staan per
    // aansluiting, en het verschoof van het ene eind naar het andere zodra ik
    // aan een van beide vlakken draaide.
    //
    // Een halve millimeter rondom is wat een zetter ook aanhoudt: de regel valt
    // erin, de lasnaad vult het op, en er zit nergens staal op twee plekken.
    // Op een vlakke leuning verandert er niets zichtbaars - daar paste het al.
    //
    // Het getal stond hier los in de code; het staat nu bij de andere eisen in
    // regels.json, zodat er één plek is waar aan gedraaid kan worden.
    const speling = u.door ? 0 : CONTROLES.bedSpeling;

    // Net als een profiel uit de catalogus: langs +Z, doorsnede op de oorsprong.
    //
    // MASSIEF bij een zadel, en dat is nagemeten. Een bed is maar 10 % diep en
    // nikt alleen de buitenkant, dus daar mag de snijder de echte doorsnede van
    // het profiel zijn. Een zadel gaat er dwars DOORHEEN - en een CHS-doorsnede
    // is HOL. Dan snijd je een ringvormige tunnel uit de staander en blijft de
    // kern van de buisholte als los staal binnen staan:
    //
    //     blok + CHS-doorsnede  ->  2 solids  (romp + kern)
    //     buis + CHS-doorsnede  ->  3 solids
    //
    // Bij elke diepte, wat ook de reden was dat een ontlastingssnede niets
    // hielp. De ruimte die de regel inneemt is zijn OMHULLENDE, niet zijn
    // wanddoorsnede, dus daarmee wordt gesneden.
    const staaf = u.rond
        ? rondeStaaf(oc, u.hoogte, lengte, opruimen)
        : u.profiel
            ? await maakStaaf(u.profiel, lengte)
            : blokStaaf(oc, u.breedte + 2 * speling, u.hoogte + 2 * speling,
                        lengte, opruimen);

    // De staaf ligt langs zijn +Z; die moet de richting van de regel worden,
    // HELLING INBEGREPEN. Zijn +Y is de hoogte van de doorsnede en moet
    // loodrecht op de regel omhoog wijzen - niet recht omhoog, want dan staan
    // de assen op een helling niet haaks en kan gp_Trsf er geen starre
    // verplaatsing van maken. De derde volgt eruit, rechtsdraaiend.
    //
    // `op` is die loodrechte richting, al uitgerekend in pad.js waar de
    // meetkunde van het veld bekend is. Op een vlak stuk is het gewoon [0,0,1]
    // en komt hier precies uit wat er eerst stond.
    const langs = u.langs;
    const op = u.op || [0, 0, 1];
    const dwars = kruisProduct(op, langs);
    const assen = { xAs: dwars, yAs: op, zAs: langs };

    // `binnen` is een HORIZONTALE maat: de buitenkant van de staander ligt op
    // breedte/2 van de hartlijn. Maar we verplaatsen langs `langs`, en die
    // loopt op een helling schuin omhoog. Over een schuine afstand d leg je
    // maar d x cos horizontaal af, dus delen door cos - anders begint het bed
    // te ver naar binnen en past de regel er niet in.
    const cosLangs = Math.hypot(langs[0], langs[1]) || 1;
    // Ook aan het INNERSTE eind een beetje ruimer: daar staat de kop van de
    // regel, en op een helling staat die onder een andere hoek dan de bodem van
    // het bed.
    const binnen = u.door ? -breedte * 3
                          : (breedte / 2 - u.diepte) / cosLangs
                            - speling * 2 - (u.extra || 0);
    // Het hart van de doorsnede ligt een halve hoogte onder de bovenkant van
    // de regel, gemeten LOODRECHT op die regel.
    // `opzij` schuift het bed naar de kant waar de regel ligt. Het vulveld
    // staat namelijk vlak tegen de voorkant van de staander en niet in het
    // hart; zonder deze verschuiving zou zijn bed ernaast zitten.
    const opzij = u.opzij || 0;
    const plek = [0, 1, 2].map(as =>
        (as === 2 ? u.top : midden[as])
        - op[as] * (u.hoogte / 2)
        + dwars[as] * opzij
        + langs[as] * binnen);

    const t = plaatsing(oc, assen, plek);
    const verplaatser = new oc.BRepBuilderAPI_Transform_2(staaf, t, true);
    opruimen.push(t, verplaatser);
    return verplaatser.Shape();
}

/**
 * Een MASSIEVE ronde staaf langs +Z, hart op de oorsprong - als een profiel.
 *
 * Voor het zadel onder een ronde handregel: de ruimte die een buis inneemt is
 * zijn omhullende cilinder en niet zijn holle wand. Zie klinkSnijder.
 */
function rondeStaaf(oc, diameter, lengte, opruimen) {
    const voet = new oc.gp_Pnt_3(0, 0, 0);
    const langs = new oc.gp_Dir_4(0, 0, 1);
    // DE NAAD BOVENOP, langs +Y - en die wordt in klinkSnijder `op`. Een
    // cilinder heeft een naad op zijn X-richting; zonder die te kiezen lag hij
    // opzij, en een gespiegelde staander (de laatste van een rij, met de buis
    // ervoor) kreeg hem dan aan de andere kant: een vlak meer of minder, en een
    // eigen regel in de stuklijst voor een stuk dat er precies zo uitziet.
    // Bovenop ligt hij in het spiegelvlak, en boven de kop van de staander.
    const naad = new oc.gp_Dir_4(0, 1, 0);
    const as = new oc.gp_Ax2_2(voet, langs, naad);
    const maker = new oc.BRepPrimAPI_MakeCylinder_3(as, diameter / 2, lengte);
    opruimen.push(voet, langs, naad, as, maker);
    return maker.Shape();
}

/** Een rechthoekige staaf langs +Z, doorsnede gecentreerd - als een profiel. */
function blokStaaf(oc, breedte, hoogte, lengte, opruimen) {
    const hoek = new oc.gp_Pnt_3(-breedte / 2, -hoogte / 2, 0);
    const maker = new oc.BRepPrimAPI_MakeBox_3(hoek, breedte, hoogte, lengte);
    opruimen.push(hoek, maker);
    return maker.Shape();
}

/**
 * Een eigen compound om een vorm heen, zodat hij van ons is en blijft.
 *
 * De vorm van een maker is een verwijzing naar iets dat IN die maker zit, en de
 * maker wordt aan het eind opgeruimd. In een eigen compound stoppen maakt hem
 * van ons, zodat het onderdeel later nog geëxporteerd kan worden.
 */
export function eigenVorm(oc, vorm) {
    const bouwer = new oc.BRep_Builder();
    const eigen = new oc.TopoDS_Compound();
    bouwer.MakeCompound(eigen);
    bouwer.Add(eigen, vorm);
    return eigen;
}

/**
 * De lokale vorm van een dekband: de doorsnede uitgetrokken over de lengte.
 *
 * Daarna gaan de schuine kopsneden eroverheen - het verstek in een hoek - en
 * de gaten voor doorgestoken spijlen, precies zoals bij een blok of een
 * profiel. Een dekband is voor de rest van de machinerie gewoon een liggend
 * onderdeel met een doosje eromheen.
 */
function lokaleDekbandvorm(oc, d, opruimen) {
    const vorm = maakDekband(oc, d.dekband,
        { b: d.dy, h: d.dz, lengte: d.dx }, opruimen);
    const gezaagd = metVerstek(oc, d, vorm, opruimen);
    return eigenVorm(oc, metDoorsteken(oc, d, gezaagd, opruimen));
}

/** De vingerafdruk van een gedraaide baluster: model, maten en kopsneden. */
function balusterSleutel(d) {
    return JSON.stringify({ b: d.baluster, m: [d.dx, d.dy, d.dz],
                            v: d.verstek || [] });
}

/**
 * De lokale vorm van een gedraaide baluster.
 *
 * Hij wordt op de VOLLE dz gedraaid en daarna pas afgezaagd. Op een vlakke
 * leuning is dat precies de hoogte tussen de twee regels en verandert de
 * schuine snede niets. Op een helling is dz het omhullende blok - een paar
 * millimeter hoger dan de staaf zelf - en worden de verhoudingen van de buik
 * dus een fractie uitgerekt. Dat is zichtbaar noch meetbaar bij een helling
 * van 1:2 op een baluster van 700 mm, en het alternatief (draaien op de
 * zaaglengte en daarna verschuiven) zou de kopblokken scheef zetten.
 */
async function lokaleBalustervorm(oc, d, opruimen) {
    const vorm = maakBaluster(oc, d.baluster,
        { b: Math.max(d.dx, d.dy), h: d.dz }, opruimen);
    // De baluster staat gecentreerd op de as; de rest van de machinerie rekent
    // vanuit de HOEK van het doosje, net als bij een blok.
    const naarHoek = new oc.gp_Trsf_1();
    naarHoek.SetValues(1, 0, 0, d.dx / 2, 0, 1, 0, d.dy / 2, 0, 0, 1, 0);
    const gezet = new oc.BRepBuilderAPI_Transform_2(vorm, naarHoek, true);
    opruimen.push(naarHoek, gezet);

    // De schuine kopsneden van een helling gelden ook hier: het voetblokje
    // staat op een schuine regel en moet daar evenwijdig aan afgezaagd zijn.
    return eigenVorm(oc, metVerstek(oc, d, gezet.Shape(), opruimen));
}

/** De lokale vorm van een massief blok: zoals het uit de zaag komt. */
async function lokaleBlokvorm(oc, d, opruimen) {
    const nul = new oc.gp_Pnt_3(0, 0, 0);
    const maker = new oc.BRepPrimAPI_MakeBox_3(nul, d.dx, d.dy, d.dz);
    opruimen.push(nul, maker);

    // EERST de schuine kopsnede, DAARNA het zadel en de bedden. Zie
    // lokaleProfielvorm voor waarom die orde ertoe doet.
    //
    // Een blok wordt vanuit zijn hoek opgebouwd, dus het hart van de doorsnede
    // ligt op (dx/2, dy/2).
    const gezaagd = metVerstek(oc, d, maker.Shape(), opruimen);
    const geklonken = metZadelRanden(oc, d, metAfronding(oc, d, await metUitklinken(
        oc, d, gezaagd, [d.dx / 2, d.dy / 2], opruimen), [d.dx / 2, d.dy / 2], opruimen), opruimen);
    // En als laatste de gaten voor doorgestoken spijlen. Die zitten midden in
    // het onderdeel, ver van de koppen, dus de volgorde maakt voor de vorm
    // niets uit - maar als laatste is hij het veiligst: wat er dan nog
    // uiteenvalt, valt uiteen door de gaten en door niets anders.
    return eigenVorm(oc, metDoorsteken(oc, d, geklonken, opruimen));
}

/**
 * Een eigen doorsnede op lengte getrokken, met verstek aan de koppen.
 *
 * De doorsnede staat in het lokale yz-vlak, gemeten vanaf de hoek van het
 * doosje, en loopt dx lang langs x - dus lokaal is logisch, net als bij een
 * blok, en metVerstek kan er zonder omrekenen op. Zo komen een bodemprofiel en
 * een kaplijst in een hoek precies op verstek bij elkaar.
 */
function lokalePrismavorm(oc, d, opruimen) {
    const lijn = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const [v, w] of d.doorsnede) {
        const q = new oc.gp_Pnt_3(0, v, w);
        lijn.Add_1(q);
        opruimen.push(q);
    }
    lijn.Close();
    const vlak = new oc.BRepBuilderAPI_MakeFace_15(lijn.Wire(), true);
    const richting = new oc.gp_Vec_4(d.dx, 0, 0);
    const prisma = new oc.BRepPrimAPI_MakePrism_1(vlak.Shape(), richting, false, true);
    opruimen.push(lijn, vlak, richting, prisma);
    return eigenVorm(oc, metVerstek(oc, d, prisma.Shape(), opruimen));
}

/**
 * Een plaat met gaten erin: een blok waar cilinders uit gesneden worden.
 *
 * Dit is het eerste onderdeel in de app waar echt materiaal uit weggehaald
 * wordt. Dat is precies het geval waarvoor de onderdeelherkenning gebouwd is:
 * naam, profiel en lengte blijven gelijk, maar de vorm niet. Twee platen die
 * alleen in hun gaten verschillen zijn twee productieonderdelen.
 *
 * De gaten staan in de maten van de plaat zelf, gerekend vanaf de hoek, en hun
 * as staat loodrecht op de plaat. De boor steekt er aan beide kanten een
 * millimeter buiten: snij je precies tot het oppervlak, dan laat OCCT er soms
 * een flinterdun vlakje staan.
 */
function plaatDeel(oc, d, opruimen) {
    const nul = new oc.gp_Pnt_3(0, 0, 0);
    const maker = new oc.BRepPrimAPI_MakeBox_3(nul, d.dx, d.dy, d.dz);
    opruimen.push(nul, maker);

    let vorm = maker.Shape();
    for (const gat of d.gaten) {
        const voet = new oc.gp_Pnt_3(gat.x, gat.y, -1);
        const richting = new oc.gp_Dir_4(0, 0, 1);
        const as = new oc.gp_Ax2_3(voet, richting);
        const boor = new oc.BRepPrimAPI_MakeCylinder_3(
            as, gat.diameter / 2, d.dz + 2);

        const snede = new oc.BRepAlgoAPI_Cut_3(
            vorm, boor.Shape(), new oc.Message_ProgressRange_1());
        snede.Build(new oc.Message_ProgressRange_1());
        vorm = snede.Shape();

        opruimen.push(voet, richting, as, boor);
        // `snede` NIET opruimen: zijn resultaat is de vorm waar we mee verder
        // gaan, en die mag niet onder ons vandaan verdwijnen.
    }

    const eigen = eigenVorm(oc, vorm);
    const t = plaatsing(oc, d, d.oorsprong);
    const verplaatser = new oc.BRepBuilderAPI_Transform_2(vorm, t, true);

    opruimen.push(t, verplaatser);
    return { geplaatst: verplaatser.Shape(), lokaal: eigen };
}

/** De lokale vorm van een profielonderdeel: zoals het uit de zaag komt. */
async function lokaleProfielvorm(oc, d, opruimen) {
    // Welke as de lengte is verschilt per onderdeel: een staander staat
    // rechtop (lengte langs zAs), een handregel ligt (lengte langs xAs).
    const langs = { x: 'dx', y: 'dy', z: 'dz' }[d.lengteAs || 'z'];
    const lengte = d[langs];

    // De staaf komt langs zijn EIGEN +Z uit de fabriek, met de doorsnede
    // gecentreerd op de oorsprong.
    const staaf = await maakStaaf(d.profiel, lengte);

    // EERST de schuine sneden: het verstek aan een handregel, en de schuine
    // kopsnede van een staander op een helling. Bij een profiel staat de staaf
    // langs zijn eigen +Z met de doorsnede gecentreerd, en daar rekent
    // logischNaarLokaal mee.
    //
    // DEZE ORDE DOET ERTOE, en dat is nagemeten. De staander wordt gebouwd tot
    // zijn HOOGSTE punt - op een helling is dat de bovenhoek aan de
    // opwaartse kant - en de schuine snede haalt de rest eraf. Zadel je eerst,
    // dan zit er op dat moment nog een stuk paal BOVEN de hartlijn van de
    // regel, en precies daar valt de kop uiteen: gemeten 3 losse stukken op een
    // helling van 1:2. Met de schuine snede eerst is de kop al op maat en
    // blijft het één stuk.
    const gezaagd = metVerstek(oc, d, staaf, opruimen);
    // Daarna het zadel om de handregel en de bedden voor de vulregels. De
    // doorsnede van een profiel staat al op de oorsprong, dus het hart ligt
    // op [0, 0].
    const geklonken = metZadelRanden(oc, d, metAfronding(oc, d,
        await metUitklinken(oc, d, gezaagd, [0, 0], opruimen), [0, 0], opruimen), opruimen);
    // En als laatste de gaten voor doorgestoken spijlen; zie lokaleBlokvorm.
    const vorm = metDoorsteken(oc, d, geklonken, opruimen);

    // `staaf` is al een eigen compound uit maakStaaf, dus die kan zo mee terug
    // als er niets gesneden is. Is er wél gesneden, dan is de vorm het
    // resultaat van een snede en moet er een eigen compound omheen.
    return vorm === staaf ? staaf : eigenVorm(oc, vorm);
}

/**
 * De assen zo omzetten dat de derde (de Z van de staaf) de lengterichting is.
 *
 * Een staaf uit de catalogus ligt altijd langs zijn eigen +Z. Loopt de lengte
 * van het onderdeel langs xAs, dan moet die xAs dus op de derde plek komen.
 * De andere twee schuiven op, en wel zo dat het een RECHTSDRAAIEND stelsel
 * blijft: verwissel je er zomaar twee, dan spiegelt de vorm.
 */
function draaiingVoor(d) {
    switch (d.lengteAs || 'z') {
        case 'x': return { xAs: d.yAs, yAs: d.zAs, zAs: d.xAs };
        case 'y': return { xAs: d.zAs, yAs: d.xAs, zAs: d.yAs };
        default:  return { xAs: d.xAs, yAs: d.yAs, zAs: d.zAs };
    }
}

/**
 * Neemt de buitenmaat van een gekozen profiel over als staanderbreedte.
 *
 * Dit moet, anders klopt de rest niet meer. De velden tussen de staanders
 * worden berekend met `staanderBreedte`: dat bepaalt hoever de handregel
 * inschuift en hoeveel vrije lengte er overblijft voor de spijlen. Kies je een
 * buis van 48,3 mm terwijl het invulveld 40 zegt, dan rekent de app met 40 en
 * steekt de buis 4 mm aan elke kant door de handregel heen.
 *
 * De buitenmaat komt uit `boxSize` in het manifest, dus zonder het STEP-bestand
 * te openen. De langste van de twee wint: een rechthoekige koker die met zijn
 * lange zijde dwars staat, neemt die maat in beslag.
 */
export function metProfielMaten(p) {
    const uit = { ...p };

    const staander = profielDoos(p.staanderProfiel);
    if (staander) uit.staanderBreedte = Math.max(staander[0], staander[1]);

    // Ook de spijlbreedte, want die gaat de veiligheidsregel in. Zonder dit
    // valideert en toont de app een ander getal dan padDelen bouwt.
    const spijl = profielDoos(p.spijlProfiel);
    if (spijl) uit.spijlBreedte = spijl[0];

    return uit;
}

/**
 * Bouwt een balustrade langs een pad en levert de OCCT-vorm op.
 *
 * Hier stonden eerst STEP-bytes. Dat betekende dat de viewer het bestand dat we
 * net geschreven hadden meteen weer moest ontleden, en dat ontleden kostte bij
 * een trap 1,8 s - meer dan het bouwen en tekenen samen. Wie bytes wil, schrijft
 * de vorm zelf weg met schrijfStep(); dat gebeurt nu alleen nog bij exporteren.
 */
export async function bouwPad(punten, gesloten, p, bestaandeShape = null,
                              melden = null) {
    // EERST toetsen wat er INGETYPT is, en pas daarna de maten uit de gekozen
    // profielen overnemen.
    //
    // Andersom ging het mis. De grenzen in regels.json zijn er om een typefout
    // in een invulveld te vangen: staanderbreedte 10 tot 200 mm. Een maat die
    // uit de CATALOGUS komt is geen typefout - daar staat de leverancier voor
    // in. Vierkant staal van 8 mm is een echt profiel, en dat werd geweigerd
    // met "staanderbreedte: 8 mm valt buiten 10-200 mm", terwijl er in dat veld
    // gewoon 40 stond. Onbegrijpelijke melding, en twee van de tien soorten
    // profiel waren er niet mee te kiezen.
    //
    // Wat een onbruikbaar profiel WEL tegenhoudt, blijft staan: beoordeelPad
    // hieronder rekent met de afgeleide maat en weigert een veld dat na aftrek
    // van de staanders te kort overblijft. Dat is de controle die ertoe doet.
    const fouten = valideer(p);
    if (fouten.length) throw new Error('Ongeldige maten:\n- ' + fouten.join('\n- '));

    p = metProfielMaten(p);

    const [minVeld] = GRENZEN.lengte;
    const oordeel = beoordeelPad(punten, gesloten, p, minVeld);
    if (oordeel.fout) throw new Error(oordeel.fout);

    // DE STAPPEN MELDEN, zodat het scherm kan laten zien waar hij is.
    //
    // `melden` mag een belofte teruggeven; die wordt afgewacht. Dat is geen
    // opsmuk: OCCT rekent synchroon op de hoofddraad, dus zonder zo'n moment
    // krijgt de browser nooit de kans om de melding te TEKENEN en zie je de
    // hele bouw niets. Zie `adem()` in main.js.
    //
    // Standaard is hij null en verandert er niets: dit blijft dezelfde functie
    // voor iedereen die hem zonder melder aanroept.
    // Vijf stappen, niet drie: keuren en beeld opbouwen komen hierna nog in
    // main.js. Dezelfde noemer voor allemaal, anders hikt de ring van 67%
    // naar 75% en lijkt het alsof er iets overgeslagen is.
    const stap = melden ? (n, tekst) => melden(n, 5, tekst) : () => {};

    await stap(0, 'Model voorbereiden…');
    const oc = await initOcct();
    const { delen, velden, verbindingen } = padDelen(punten, gesloten, p);

    await stap(1, `${delen.length} onderdelen vormgeven…`);
    const { vorm, opruimen, lokaal } = await maakVormUitDelen(oc, delen);
    const tijdelijk = [...opruimen];

    try {
        let uitvoer = vorm;

        // Samenvoegen met wat er al lag, zodat plaat en leuning samen in beeld
        // komen en samen geexporteerd worden.
        if (bestaandeShape && !bestaandeShape.IsNull()) {
            const builder = new oc.BRep_Builder();
            const totaal = new oc.TopoDS_Compound();
            builder.MakeCompound(totaal);
            builder.Add(totaal, bestaandeShape);
            builder.Add(totaal, vorm);
            uitvoer = totaal;
        }

        // Unieke productieonderdelen, herkend aan hun geometrie. Vier
        // identieke staanders op vier plekken zijn hier één onderdeel met
        // aantal 4, en daar hoort één STEP-bestand bij.
        await stap(2, 'onderdelen herkennen…');
        const onderdelen = groepeerVormen(oc, lokaal);

        return {
            shape: uitvoer,
            velden,
            aantalDelen: delen.length,
            stuklijst: stuklijst(delen),
            onderdelen,
            // Dezelfde onderdelen, maar gegroepeerd zoals je ze in elkaar zet:
            // een staander met zijn voetplaat, een vulveld als paneel. Zie
            // samenstelling.js; het verandert niets aan de lijsten hierboven.
            boom: maakBoom(delen, onderdelen, 'Balustrade'),
            // Het materiaal van elk onderdeel, in dezelfde volgorde als de
            // solids in de vorm staan. Daarmee geeft de viewer elk onderdeel
            // zijn eigen kleur. Zie tessellate.js voor waarom die volgorde
            // klopt, en materialen.js voor de kleuren.
            materialen: materialenVan(oc, delen, bestaandeShape),
            uiterlijk: uiterlijkVan(oc, delen, bestaandeShape),
            // De onderdelen zelf, voor de maatvoering. Die meet aan wat er
            // ECHT staat in plaats van de berekening over te doen.
            delen,
            // WELKE delen op elkaar aansluiten en hoe. Zie padDelen; de
            // technische keuring in controle.js leunt hierop, en zonder deze
            // lijst zou die uit de meetkunde moeten raden welke twee delen bij
            // elkaar horen.
            verbindingen,
        };
    } finally {
        for (const o of tijdelijk) { try { o.delete(); } catch { /* al weg */ } }
    }
}

/**
 * De onderdelen van een los balustradeveld.
 *
 * Een los veld is een pad van twee punten. 'lengte' is de afstand tussen de
 * HARTEN van de twee staanders - zo staat het ook in regels.json. De vrije
 * ruimte tussen de staanders is dus lengte min een staanderbreedte.
 */
export function balustradeDelen(p) {
    return padDelen([[0, 0, 0], [p.lengte, 0, 0]], false, p).delen;
}

// Steiler dan dit is geen trap meer. 45 graden is al heel steil; hierboven
// wordt het een ladder en klopt de hele opzet met verticale spijlen niet meer.
const MAX_HELLING_GRADEN = 50;

/**
 * Het pad van een los balustradeveld.
 *
 * 'lengte' is de HORIZONTALE afstand tussen de harten van de staanders, ook bij
 * een trapleuning. Zo betekent het getal hetzelfde of je nu vlak of schuin
 * bouwt, en klopt het met hoe een trap wordt opgegeven: zoveel aanzet, zoveel
 * hoogteverschil.
 */
function padVanMaten(p) {
    const stijging = Number(p.hoogteverschil) || 0;
    if (!Number.isFinite(stijging)) {
        throw new Error('Hoogteverschil moet een getal zijn.');
    }

    const graden = Math.atan2(Math.abs(stijging), p.lengte) * 180 / Math.PI;
    if (graden > MAX_HELLING_GRADEN) {
        throw new Error(
            `Een helling van ${graden.toFixed(1)}° is te steil. `
            + `Hoogstens ${MAX_HELLING_GRADEN}° bij deze lengte, dus maximaal `
            + `${Math.round(p.lengte * Math.tan(MAX_HELLING_GRADEN * Math.PI / 180))} mm.`);
    }

    // Zonder vervolg precies wat het altijd was: één recht stuk.
    const vervolg = ontleedVervolg(p.vervolg);
    if (vervolg.length === 0) return [[0, 0, 0], [p.lengte, 0, stijging]];

    // MET HOEKEN GEEN HELLING. Een leuning die én de hoek om gaat én oploopt
    // is een andere constructie: dan moet per veld bepaald worden hoeveel van
    // de stijging erin zit, en gaan de verstekken in de hoek over twee vlakken
    // tegelijk. Dat is niet nagemeten, en iets bouwen dat er wel uitziet maar
    // niet nagerekend is, is erger dan het niet kunnen.
    if (stijging !== 0) {
        throw new Error('Een hoek én een hoogteverschil gaan nog niet samen. '
            + 'Zet het hoogteverschil op 0, of haal de hoeken weg.');
    }

    // Het pad uitzetten: steeds een stuk vooruit, dan draaien. Een positieve
    // hoek draait naar links.
    const punten = [[0, 0, 0]];
    let x = 0, y = 0, richting = 0;         // richting in graden, 0 = de x-as
    const loop = (mm) => {
        const r = richting * Math.PI / 180;
        x += Math.cos(r) * mm;
        y += Math.sin(r) * mm;
        punten.push([x, y, 0]);
    };
    loop(p.lengte);
    for (const { hoek, lengte } of vervolg) {
        richting += hoek;
        loop(lengte);
    }
    return punten;
}

export async function bouwBalustrade(p, melden = null) {
    const resultaat = await bouwPad(padVanMaten(p), false, p, null, melden);
    return { ...resultaat, spijlen: resultaat.velden[0].spijlen };
}

/**
 * Wat er uit komt als je nu op 'Genereer balustrade' drukt.
 *
 * Het paneel toont dit terwijl je typt. Het MOET langs dezelfde weg gerekend
 * worden als het bouwen zelf: 'lengte' is de afstand tussen de harten van de
 * staanders, dus het vrije veld is een staanderbreedte korter. Reken je dat
 * hier anders uit, dan laat je een voorbeeld zien dat niet klopt met wat er
 * gebouwd wordt - en dat is erger dan geen voorbeeld.
 */
export function voorspelBalustrade(p) {
    const velden = padDelen(padVanMaten(p), false, p).velden;
    // Het paneel toont het EERSTE veld. Bij een recht stuk zijn alle velden
    // even lang en geldt dat getal voor alle; met een hoek erin niet meer.
    //
    // `veldenVerschillen` zegt welk van de twee het is, zodat het paneel er
    // alleen "veld 1 van 3" bij hoeft te zetten als dat écht iets toevoegt.
    // Zonder dat onderscheid stond het er altijd - ook bij een recht stuk van
    // 2000 mm, dat met een maximale staanderafstand van 850 al drie velden
    // heeft - en dan is het ruis in plaats van een waarschuwing.
    const eerste = velden[0];
    const gelijk = velden.every(v =>
        v.spijlen.aantal === eerste.spijlen.aantal
        && Math.abs(v.spijlen.doorgang - eerste.spijlen.doorgang) < 1e-6
        && (v.glas ? Math.round(v.glas.lengte) : 0)
           === (eerste.glas ? Math.round(eerste.glas.lengte) : 0));
    return { ...eerste, aantalVelden: velden.length, veldenVerschillen: !gelijk };
}

// --- balustrade op geselecteerde randen ------------------------------------

const bijnaNul = 1e-9;

function vec(a, b) { return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; }
function lengteVan(v) { return Math.hypot(v[0], v[1], v[2]); }
function deel(v, s) { return [v[0] / s, v[1] / s, v[2] / s]; }

/**
 * Onderzoekt of er een balustrade op deze randen past.
 * Geeft alleen gegevens terug - geen OCCT, dus goed apart te testen.
 */
export function beoordeelRanden(randen, p) {
    const pad = maakPad(randen);
    if (pad.fout) return { fout: pad.fout };

    // Eerst opzij schuiven, dan pas de uiteinden inkorten: de inkorting hoort
    // langs het verschoven pad te gebeuren, niet langs het oorspronkelijke.
    const verschoven = verschuifPad(pad.punten, pad.gesloten, Number(p.verschuiving) || 0);
    const punten = krimpUiteinden(verschoven, pad.gesloten, p.staanderBreedte);
    const [minVeld] = GRENZEN.lengte;
    const oordeel = beoordeelPad(punten, pad.gesloten, p, minVeld);
    if (oordeel.fout) return { fout: oordeel.fout };

    return {
        punten,
        gesloten: pad.gesloten,
        velden: oordeel.velden,
        totaleLengte: oordeel.velden.reduce((s, v) => s + v.randLengte, 0),
        hoeken: pad.gesloten ? punten.length : Math.max(0, punten.length - 2),
    };
}

/**
 * Schuift de twee vrije uiteinden een halve staander naar binnen.
 *
 * Zonder dit staat de eindstaander met zijn hart op de hoek van de plaat, en
 * steekt hij er dus half overheen. Door een halve staanderbreedte in te
 * schuiven past de balustrade precies binnen de aangeklikte randen.
 *
 * Bij een gesloten lus zijn er geen vrije uiteinden, dus daar gebeurt niets.
 */
function krimpUiteinden(punten, gesloten, staanderBreedte) {
    if (gesloten || punten.length < 2) return punten;

    const kopie = punten.map(p => [...p]);
    const halve = staanderBreedte / 2;

    const schuif = (van, naar) => {
        const richting = vec(punten[van], punten[naar]);
        const l = lengteVan(richting);
        if (l < bijnaNul) return;
        const eenheid = deel(richting, l);
        kopie[van] = [
            punten[van][0] + eenheid[0] * halve,
            punten[van][1] + eenheid[1] * halve,
            punten[van][2] + eenheid[2] * halve,
        ];
    };

    schuif(0, 1);
    schuif(punten.length - 1, punten.length - 2);
    return kopie;
}

/**
 * Bouwt een balustrade langs de aangeklikte randen en voegt hem samen met het
 * al geladen model.
 */
export async function bouwBalustradeOpRanden(randen, maten, bestaandeShape) {
    const oordeel = beoordeelRanden(randen, maten);
    if (oordeel.fout) throw new Error(oordeel.fout);

    const resultaat = await bouwPad(
        oordeel.punten, oordeel.gesloten, maten, bestaandeShape);

    return {
        ...resultaat,
        gesloten: oordeel.gesloten,
        hoeken: oordeel.hoeken,
        totaleLengte: oordeel.totaleLengte,
    };
}
