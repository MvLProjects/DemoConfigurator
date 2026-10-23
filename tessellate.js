// Van een OCCT-vorm naar driehoeken voor three.js.
//
// Hiervoor gebruikten we occt-import-js: dat las het STEP-bestand nog een keer
// in en tessellleerde het. Gemeten op een trap van 81 delen: 0,84 s, tegen 0,27 s
// als je de vorm tessellleert die je al hebt. Het verschil zat vooral in dat
// opnieuw ontleden van 1,36 MB tekst, niet in het trianguleren.
//
// Nu tessellleren we de vorm die we toch al in handen hebben. Dat scheelt een
// hele ronde door een tekstbestand, en het scheelt een tweede OCCT-bibliotheek
// van 7,6 MB waarvan 0.0.23 toch de laatste versie was.
//
// De uitvoer heeft bewust dezelfde vorm als wat occt-import-js teruggaf
// (position/index/brep_faces), zodat de rest van de viewer ongewijzigd blijft.

/**
 * @param oc         de OCCT-module
 * @param shape      de TopoDS_Shape
 * @param deflectie  hoe fijn: de grootste afwijking tussen driehoek en vlak
 * @returns {{meshes: [...]}} in hetzelfde formaat als occt-import-js gaf
 */
export function tessellateer(oc, shape, deflectie) {
    // false, false = niet relatief, niet parallel. De hoekafwijking van 0,5 rad
    // is ruim; bij vlakke vlakken doet hij er niets mee.
    const mesher = new oc.BRepMesh_IncrementalMesh_2(shape, deflectie, false, 0.5, false);

    const posities = [];
    const indices = [];
    const brepFaces = [];

    // Welke solid hoort bij welk vlak. Nodig om een onderdeel een eigen kleur
    // te kunnen geven: zonder dit weet het beeld alleen dát er een vlak is,
    // niet van welk stuk staal of hout het de buitenkant is.
    //
    // De volgorde waarin de vlakken hieronder doorlopen worden verandert NIET.
    // Dat moet ook niet: de vlakselectie wijst een aangeklikte driehoek terug
    // naar zijn nummer in deze lijst, en dat nummer zou anders verschuiven.
    const solidVanVlak = maakSolidKaart(oc, shape);

    const verkenner = new oc.TopExp_Explorer_2(
        shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

    const OMGEKEERD = waardeVan(oc.TopAbs_Orientation.TopAbs_REVERSED);
    const opruimen = [];

    try {
        for (; verkenner.More(); verkenner.Next()) {
            const face = oc.TopoDS.Face_1(verkenner.Current());
            const plaats = new oc.TopLoc_Location_1();
            opruimen.push(plaats);

            const handle = oc.BRep_Tool.Triangulation(face, plaats, 0);
            if (handle.IsNull()) continue;
            const driehoeken = handle.get();

            // De knopen staan in het eigen assenstelsel van het vlak; de
            // plaatsing zet ze op hun plek in de wereld.
            const t = plaats.Transformation();
            const eersteKnoop = posities.length / 3;

            for (let i = 1; i <= driehoeken.NbNodes(); i++) {
                const p = driehoeken.Node(i);
                posities.push(
                    t.Value(1, 1) * p.X() + t.Value(1, 2) * p.Y() + t.Value(1, 3) * p.Z() + t.Value(1, 4),
                    t.Value(2, 1) * p.X() + t.Value(2, 2) * p.Y() + t.Value(2, 3) * p.Z() + t.Value(2, 4),
                    t.Value(3, 1) * p.X() + t.Value(3, 2) * p.Y() + t.Value(3, 3) * p.Z() + t.Value(3, 4));
            }

            // Bij een omgekeerd vlak wijst de normaal de andere kant op. Dan
            // moeten twee hoekpunten verwisseld worden, anders kijk je tegen de
            // achterkant aan en ziet het model er zwart of hol uit.
            const omgekeerd = waardeVan(face.Orientation_1()) === OMGEKEERD;
            const eersteDriehoek = indices.length / 3;

            for (let i = 1; i <= driehoeken.NbTriangles(); i++) {
                const d = driehoeken.Triangle(i);
                const a = eersteKnoop + d.Value(1) - 1;
                const b = eersteKnoop + d.Value(2) - 1;
                const c = eersteKnoop + d.Value(3) - 1;
                if (omgekeerd) indices.push(a, c, b);
                else indices.push(a, b, c);
            }

            // Welke driehoeken bij welk b-rep-vlak horen. Dit is wat de
            // face-selectie gebruikt: een aangeklikte driehoek wijst zo terug
            // naar het vlak waar hij vandaan komt.
            brepFaces.push({
                first: eersteDriehoek,
                last: indices.length / 3 - 1,
                // -1 als een vlak niet in een solid zit; dat kan bij een losse
                // schil of een kaal vlak in een ingeladen bestand.
                solid: solidVanVlak.nummerVan(face),
            });
        }
    } finally {
        verkenner.delete();
        mesher.delete();
        solidVanVlak.opruimen();
        for (const o of opruimen) { try { o.delete(); } catch { /* al weg */ } }
    }

    return {
        success: true,
        meshes: [{
            name: 'model',
            attributes: { position: { array: posities } },
            index: { array: indices },
            brep_faces: brepFaces,
            aantalSolids: solidVanVlak.aantal,
        }],
    };
}

/**
 * Van elk vlak het nummer van de solid waar het bij hoort.
 *
 * Teruggegeven als `{ nummerVan(face), aantal }`. De solids worden geteld in de
 * volgorde waarin OCCT ze tegenkomt, en dat is dezelfde volgorde als waarin ze
 * aan de compound zijn toegevoegd - dus dezelfde als de lijst onderdelen
 * waaruit het model gebouwd is.
 *
 * Dat laatste is NAGEMETEN en niet aangenomen: drie blokken van 10, 20 en 30 mm
 * in een compound gaven precies 0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,2. Zou die
 * volgorde ooit verschuiven, dan krijgt een houten trede de kleur van een
 * stalen staander, en daar staat een controle op in selftest.html.
 *
 * Een vlak wordt opgezocht via een `TopTools_IndexedMapOfShape`. Dat moet via
 * OCCT zelf: twee TopoDS_Face-objecten die hetzelfde vlak beschrijven zijn niet
 * hetzelfde JavaScript-object, en `face.TShape()` bestaat niet in deze binding
 * (nagegaan: "f.TShape is not a function"). De indexed map vergelijkt met
 * OCCT's eigen IsSame en geeft een nummer dat wél stabiel is.
 */
function maakSolidKaart(oc, shape) {
    const alleVlakken = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, alleVlakken);

    const perVlak = new Map();          // index in de kaart -> solidnummer
    const solids = new oc.TopExp_Explorer_2(
        shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

    let aantal = 0;
    try {
        for (; solids.More(); solids.Next(), aantal++) {
            const vlakken = new oc.TopExp_Explorer_2(
                solids.Current(), oc.TopAbs_ShapeEnum.TopAbs_FACE,
                oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
            try {
                for (; vlakken.More(); vlakken.Next()) {
                    perVlak.set(alleVlakken.FindIndex(vlakken.Current()), aantal);
                }
            } finally {
                vlakken.delete();
            }
        }
    } finally {
        solids.delete();
    }

    return {
        aantal,
        // -1 als een vlak niet in een solid zit: dat kan bij een losse schil of
        // een kaal vlak in een ingeladen bestand.
        nummerVan: (face) => {
            const i = alleVlakken.FindIndex(face);
            return i > 0 && perVlak.has(i) ? perVlak.get(i) : -1;
        },
        opruimen: () => alleVlakken.delete(),
    };
}

// Embind geeft enums soms als object met .value, soms als kaal getal.
const waardeVan = (e) => (e && typeof e === 'object' && 'value' in e) ? e.value : e;
