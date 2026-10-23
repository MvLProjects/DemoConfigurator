// De verbinding met OCCT: STEP lezen en schrijven, randen uitlezen, en de
// vorm bewaren waar de rest van de viewer op werkt.
//
// Er draaide hier ooit een tweede WASM naast: occt-import-js, voor de
// driehoeken. Dat is eruit. Het ontleedde hetzelfde STEP-bestand nog een keer
// (0,84 s op een trap van 81 delen, tegen 0,27 s als je de vorm tessellleert die
// je al hebt). Nu doet opencascade.js het, zie tessellate.js: één bibliotheek,
// één keer ontleden, 7,6 MB minder.
//
// De echte kosten zaten trouwens niet in het tessellleren maar in het ontleden
// van de STEP-tekst zelf: 1,84 s op datzelfde bestand. Daarom gaat zelfgebouwde
// geometrie via laadVorm() en niet via laadStep() - zie de opmerking daar.
//
// Geverifieerde API's (opencascade.js 2.0.0-beta.b5ff984, runtime gecontroleerd):
//   STEPControl_Reader_1 -> ReadFile / TransferRoots / OneShape
//   TopExp.MapShapes_1(shape, TopAbs_EDGE, TopTools_IndexedMapOfShape_1)
//   TopoDS.Edge_1, BRep_Tool.Degenerated
//   BRepAdaptor_Curve_2(edge) -> GetType / FirstParameter / LastParameter
//   GCPnts_TangentialDeflection_2(adaptor, angDefl, curvDefl, minPts, uTol, minLen)
//   BRepBndLib.Add + Bnd_Box_1 -> CornerMin / CornerMax

import { tessellateer } from './tessellate.js';

let ocPromise = null;

// De laatst ingelezen vorm blijft bewaard, want voor exporteren heb je de
// OCCT-topologie zelf nodig - niet de driehoekjes die three.js tekent.
// Reader en shape gaan samen: de shape leunt op gegevens die in de reader
// zitten, dus we houden ze allebei vast en ruimen ze samen op.
let geladenReader = null;
let geladenShape = null;

function ruimGeladenOp() {
    if (geladenReader) {
        try { geladenReader.delete(); } catch { /* al weg */ }
    }
    geladenReader = null;
    geladenShape = null;
}

/** Is er een model geladen waar we een STEP-bestand van kunnen maken? */
export function heeftGeladenVorm() {
    return geladenShape !== null;
}

/** De OCCT-vorm van het geladen model, om op voort te bouwen. */
export function huidigeVorm() {
    return geladenShape;
}

// De 50 MB wasm wordt pas opgehaald bij het eerste STEP-bestand, en daarna hergebruikt.
export function initOcct() {
    if (ocPromise === null) {
        ocPromise = import('./vendor/opencascade.full.js')
            .then(({ default: Module }) => new Module({
                locateFile: (path) =>
                    path.endsWith('.wasm') ? './vendor/opencascade.full.wasm' : path
            }))
            .catch((err) => { ocPromise = null; throw err; });
    }
    return ocPromise;
}

// Embind geeft enums soms als object met .value, soms als kaal getal.
const enumValue = (e) => (e && typeof e === 'object' && 'value' in e) ? e.value : e;

function curveTypeName(oc, type) {
    const wanted = enumValue(type);
    for (const key of Object.keys(oc.GeomAbs_CurveType)) {
        if (key !== 'values' && enumValue(oc.GeomAbs_CurveType[key]) === wanted) {
            return key.replace('GeomAbs_', '');
        }
    }
    return 'Onbekend';
}

/**
 * Leest de STEP-bytes met OCCT en levert elke TopoDS_Edge als polyline.
 *
 * @param {Uint8Array} bytes  ruwe inhoud van het STEP-bestand
 * @param {number} modelSize  grootste afmeting van het model, voor de doorbuigtolerantie
 * @returns {{edges: Array, counts: Object}}
 *   edges[i] = { edgeId, points: number[], curveType, length }
 *   edgeId is een LOKALE index (1..N) binnen dit geladen model, niet meer dan dat.
 */
export async function readBrepEdges(bytes, modelSize) {
    const oc = await initOcct();
    const shape = await leesVorm(bytes);
    return { ...randenVan(oc, shape, modelSize), shape };
}

/**
 * Leest STEP-bytes en geeft de vorm terug ZONDER hem als "het geladen model" te
 * bewaren.
 *
 * Dat onderscheid is belangrijker dan het lijkt. De profielkiezer leest
 * losse profielbestanden in om er een voorbeeld van te tonen. Zou die leesVorm
 * gebruiken, dan verving elk voorbeeldje het model van de gebruiker, en
 * exporteerde de knop "STEP exporteren" daarna een stukje profiel in plaats van
 * hun eigen balustrade.
 *
 * De reader gaat mee terug: de vorm leunt op gegevens die in de reader zitten,
 * dus wie de vorm bewaart moet de reader ook bewaren.
 */
export async function leesLosseVorm(bytes) {
    const oc = await initOcct();
    const path = '/step-viewer-input.step';
    oc.FS.writeFile(path, bytes);

    const reader = new oc.STEPControl_Reader_1();
    let gelukt = false;
    try {
        const status = enumValue(reader.ReadFile(path));
        const ok = enumValue(oc.IFSelect_ReturnStatus.IFSelect_RetDone);
        if (status !== ok) {
            // DE MELDING IS VOOR DE GEBRUIKER, DE CODE VOOR ONS. Een
            // leescode van de kern zegt hem niets; wat hij eraan kan doen
            // wel. Het nummer gaat naar de console, voor als er gezocht
            // moet worden.
            console.error('STEP lezen mislukt, OCCT-status', status);
            throw new Error('Dit bestand kon niet gelezen worden. '
                + 'Controleer of het een compleet STEP-bestand is '
                + '(.stp of .step).');
        }

        reader.TransferRoots(new oc.Message_ProgressRange_1());
        const shape = reader.OneShape();
        if (shape.IsNull()) {
            throw new Error('Dit bestand bevat geen model dat geopend kan '
                + 'worden. Mogelijk is het leeg of beschadigd.');
        }

        gelukt = true;
        return { shape, reader };
    } finally {
        if (!gelukt) reader.delete();
        try { oc.FS.unlink(path); } catch { /* niet erg */ }
    }
}

/**
 * Leest een STEP-bestand en bewaart de vorm als HET geladen model. Ontleedt het
 * bestand precies één keer; alles wat daarna komt (randen, driehoeken, export)
 * werkt op de vorm.
 */
export async function leesVorm(bytes) {
    await initOcct();
    ruimGeladenOp(); // vorige model loslaten voor we een nieuw inlezen

    const { shape, reader } = await leesLosseVorm(bytes);
    geladenReader = reader;
    geladenShape = shape;
    return shape;
}

/** De grootste afmeting van een vorm. Nodig om de fijnheid te kiezen. */
export function grootteVan(oc, shape) {
    const doos = new oc.Bnd_Box_1();
    try {
        oc.BRepBndLib.Add(shape, doos, false);
        if (doos.IsVoid()) return 1;
        const a = doos.CornerMin();
        const b = doos.CornerMax();
        return Math.max(b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z()) || 1;
    } finally {
        doos.delete();
    }
}

/** Alle randen van een vorm als polylijnen. */
function randenVan(oc, shape, modelSize) {
    {
        const counts = countTopology(oc, shape);

        // MapShapes geeft iedere edge exact een keer, ook als twee faces hem delen.
        // De index in deze map (1..Size) is ons edgeId.
        const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
        oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);

        // Rechte edges leveren altijd 2 punten; deze tolerantie telt alleen voor
        // cirkels/splines. modelSize/2000 houdt de fout onder een halve promille.
        const curvatureDeflection = Math.max(modelSize / 2000, 1e-6);
        const angularDeflection = 0.08; // rad

        const edges = [];
        for (let i = 1; i <= edgeMap.Size(); i++) {
            const edge = oc.TopoDS.Edge_1(edgeMap.FindKey(i));

            // Degeneraten (bv. de punt van een kegel) hebben geen 3D-lengte.
            if (oc.BRep_Tool.Degenerated(edge)) continue;

            const adaptor = new oc.BRepAdaptor_Curve_2(edge);
            const sampler = new oc.GCPnts_TangentialDeflection_2(
                adaptor, angularDeflection, curvatureDeflection, 2, 1e-7, 1e-7);

            const n = sampler.NbPoints();
            const points = new Array(n * 3);
            for (let k = 1; k <= n; k++) {
                const p = sampler.Value(k);
                points[(k - 1) * 3] = p.X();
                points[(k - 1) * 3 + 1] = p.Y();
                points[(k - 1) * 3 + 2] = p.Z();
            }

            edges.push({
                edgeId: i,
                points,
                curveType: curveTypeName(oc, adaptor.GetType()),
                length: polylineLength(points)
            });

            sampler.delete();
            adaptor.delete();
        }

        edgeMap.delete();
        return { edges, counts };
    }
}

/**
 * De hele weg van STEP-bytes naar wat de viewer nodig heeft: driehoeken voor
 * het beeld, randen om aan te klikken, en de vorm om mee verder te werken.
 *
 * Het bestand wordt hier EEN keer ontleed. Daarvoor gebeurde dat twee keer: een
 * keer door occt-import-js voor de driehoeken en een keer hier voor de randen.
 *
 * Alleen voor bestanden van buiten. Wat we zelf bouwen gaat via laadVorm; dat
 * ontleden kost 1,84 s op een trap van 81 delen en is voor eigen geometrie
 * puur weggegooid werk.
 */
export async function laadStep(bytes) {
    const oc = await initOcct();
    const shape = await leesVorm(bytes);
    const maat = grootteVan(oc, shape);

    return {
        ...randenVan(oc, shape, maat),
        meshes: tessellateer(oc, shape, Math.max(maat / 2000, 1e-6)).meshes,
        maat,
    };
}

/**
 * Hetzelfde, maar voor een vorm die we zelf net gebouwd hebben.
 *
 * Hier zit de winst: geen STEP schrijven (0,51 s) en geen STEP ontleden (1,84 s)
 * van iets wat we al in handen hebben. Genereren ging daarmee van 2,9 s naar
 * 0,30 s. Bij exporteren wordt er nog steeds een echt STEP-bestand geschreven,
 * uit precies deze vorm.
 */
export async function laadVorm(shape) {
    const oc = await initOcct();
    ruimGeladenOp();
    geladenShape = shape;          // geen reader: de vorm staat op zichzelf
    const maat = grootteVan(oc, shape);

    return {
        ...randenVan(oc, shape, maat),
        meshes: tessellateer(oc, shape, Math.max(maat / 2000, 1e-6)).meshes,
        maat,
    };
}

/**
 * Schrijft het geladen model weg als STEP en geeft de bytes terug.
 *
 * Dit is een echte B-Rep-export: OCCT schrijft de topologie weg die het bij
 * het inlezen heeft opgebouwd, niet de tessellatie waarmee three.js tekent.
 * Vlakken blijven dus vlakken en cirkels blijven cirkels.
 */
export async function exportStep() {
    if (!geladenShape) {
        throw new Error('Er is nog geen model geladen om te exporteren.');
    }
    return schrijfStep(geladenShape);
}

/** Schrijft een willekeurige TopoDS_Shape weg als STEP-bytes. */
export async function schrijfStep(shape) {
    const oc = await initOcct();
    const path = '/step-viewer-output.step';
    // Overladen constructors krijgen van opencascade.js een _1, _2 enzovoort.
    const Writer = oc.STEPControl_Writer_1 || oc.STEPControl_Writer;
    const writer = new Writer();

    try {
        const klaar = enumValue(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

        // AsIs = schrijf weg in de vorm die het model al heeft (solid blijft
        // solid). De alternatieven dwingen alles naar bijvoorbeeld losse
        // vlakken, en dan raak je informatie kwijt.
        const modus = oc.STEPControl_StepModelType.STEPControl_AsIs;
        const overgezet = enumValue(
            writer.Transfer(shape, modus, true, new oc.Message_ProgressRange_1()));
        if (overgezet !== klaar) {
            console.error('STEP omzetten mislukt, OCCT-status', overgezet);
            throw new Error('Het model kon niet omgezet worden naar een '
                + 'STEP-bestand. Bouw het opnieuw op en probeer het nog eens.');
        }

        const geschreven = enumValue(writer.Write(path));
        if (geschreven !== klaar) {
            console.error('STEP schrijven mislukt, OCCT-status', geschreven);
            throw new Error('Het STEP-bestand kon niet weggeschreven worden.');
        }

        return oc.FS.readFile(path); // Uint8Array
    } finally {
        writer.delete();
        try { oc.FS.unlink(path); } catch { /* niet erg */ }
    }
}

function countTopology(oc, shape) {
    const counts = {};
    for (const kind of ['SOLID', 'SHELL', 'FACE', 'WIRE', 'EDGE', 'VERTEX']) {
        const map = new oc.TopTools_IndexedMapOfShape_1();
        oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum['TopAbs_' + kind], map);
        counts[kind] = map.Size();
        map.delete();
    }
    return counts;
}

function polylineLength(points) {
    let total = 0;
    for (let i = 0; i + 5 < points.length; i += 3) {
        total += Math.hypot(
            points[i + 3] - points[i],
            points[i + 4] - points[i + 1],
            points[i + 5] - points[i + 2]);
    }
    return total;
}

// Telt de unieke randen van de tessellatie. Alleen bedoeld als controle: dit getal
// hoort NIET gelijk te zijn aan counts.EDGE, anders kijken we naar mesh-data.
export function countMeshEdges(meshes) {
    const seen = new Set();
    let offset = 0;
    for (const mesh of meshes) {
        const index = mesh.index.array;
        for (let i = 0; i < index.length; i += 3) {
            const a = index[i] + offset, b = index[i + 1] + offset, c = index[i + 2] + offset;
            for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                seen.add(u < v ? `${u}_${v}` : `${v}_${u}`);
            }
        }
        offset += mesh.attributes.position.array.length / 3;
    }
    return seen.size;
}
