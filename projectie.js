// Een 3D-vorm platslaan tot echte 2D-lijnen: hidden line removal.
//
// WAAROM. De vier aanzichten op het productieblad zijn nu RENDERS - foto's van
// het 3D-beeld. Daar kan geen schaal op, en dus staat er "niet op schaal" op.
// Een werkplaatstekening is iets anders: geprojecteerde lijnen, waarop je met
// een liniaal mag meten en waar wat achter iets anders zit als streepjeslijn
// staat.
//
// Dat verschil is geen opmaak maar meetkunde, en OCCT kan het: HLRBRep_Algo
// rekent per rand uit welk stuk ervan zichtbaar is en welk stuk achter een
// vlak verdwijnt.
//
// DE NAMEN IN DEZE BOUW. Dat de klassen in de wasm staan betekende niet dat ze
// vanuit JavaScript aan te roepen zijn - alleen wat met embind gebonden is kan
// dat. Nagemeten op deze bouw van opencascade.js; de namen wijken af van wat de
// C++-documentatie noemt, en dat kost zoektijd als het hier niet staat:
//
//     oc.HLRBRep_Algo_1()            het algoritme
//     algo.Add_2(vorm, 0)            de vorm erin, 0 = geen isolijnen
//     algo.Projector_1(projector)    NIET algo.Projector(...)
//     algo.Update(); algo.Hide_1()
//     new oc.Handle_HLRBRep_Algo_2(algo)      de omzetter wil een Handle
//     new oc.HLRBRep_HLRToShape(handle)
//     naar.VCompound_1()             de zichtbare randen
//     naar.HCompound_1()             de verborgen randen
//
// Nagemeten op een doos van 100 x 60 x 40, van voren: 4 zichtbare randen (het
// voorvlak) en 4 verborgen (het achtervlak). De vier zijribben projecteren op
// een punt en vallen weg. Dat is precies goed.

/**
 * Projecteert een vorm naar 2D-lijnen vanuit één kijkrichting.
 *
 * @param oc        de OCCT-instantie
 * @param vorm      een TopoDS_Shape
 * @param richting  [x, y, z] - de richting waarlangs geprojecteerd wordt
 * @param opties    { omhoog, fijnheid }
 *                  omhoog   welke wereldrichting op het blad omhoog wijst
 *                  fijnheid de maximale afwijking bij het volgen van een boog,
 *                           in mm. Kleiner is nauwkeuriger en trager.
 *
 * @returns {{ zichtbaar: number[][][], verborgen: number[][][],
 *             min: number[], max: number[], breedte: number, hoogte: number }}
 *          Elke lijn is een rij [x, y]-punten in MILLIMETERS, in het vlak van
 *          het blad. x loopt naar rechts, y naar boven - zoals je een tekening
 *          leest, en niet zoals een PDF zijn oorsprong legt. Dat omrekenen
 *          gebeurt op één plek, in de tekenmodule.
 */
export function projecteer(oc, vorm, richting, opties = {}) {
    const fijnheid = opties.fijnheid || 0.2;
    const weg = [];                       // alles wat opgeruimd moet worden
    const houd = (o) => { weg.push(o); return o; };

    try {
        const algo = houd(new oc.HLRBRep_Algo_1());
        algo.Add_2(vorm, 0);

        algo.Projector_1(houd(new oc.HLRAlgo_Projector_2(
            assenstelsel(oc, houd, richting, opties.omhoog))));
        algo.Update();
        algo.Hide_1();

        const naar = houd(new oc.HLRBRep_HLRToShape(
            houd(new oc.Handle_HLRBRep_Algo_2(algo))));

        const zichtbaar = lijnenVan(oc, houd, naar.VCompound_1(), fijnheid);
        const verborgen = lijnenVan(oc, houd, naar.HCompound_1(), fijnheid);

        return { zichtbaar, verborgen, ...omvatting([...zichtbaar, ...verborgen]) };
    } finally {
        // Van achter naar voren: wat het laatst gemaakt is leunt op wat eerder
        // kwam. 50 MB wasm vult zich anders bij elke tekening verder.
        for (let i = weg.length - 1; i >= 0; i--) {
            try { weg[i].delete(); } catch { /* al weg */ }
        }
    }
}

/**
 * Het assenstelsel waarin geprojecteerd wordt.
 *
 * De hoofdrichting is de kijkrichting; de X-as wordt de horizontale as van het
 * blad. Welke kant op het blad "omhoog" is, is een keuze: standaard de
 * wereld-Z, want een balustrade staat rechtop en dan staat hij ook rechtop op
 * papier.
 *
 * KIJK JE RECHT VAN BOVEN, dan valt die keuze samen met de kijkrichting en is
 * er geen hoek meer te bepalen - hetzelfde dat bij het bovenaanzicht in de
 * viewer NaN opleverde. Dan wijst "omhoog" op het blad naar het noorden, zoals
 * op een plattegrond.
 */
function assenstelsel(oc, houd, richting, omhoog) {
    const v = vlakVan(richting, omhoog);
    return houd(new oc.gp_Ax2_2(
        houd(new oc.gp_Pnt_3(0, 0, 0)),
        houd(new oc.gp_Dir_4(v.n[0], v.n[1], v.n[2])),
        houd(new oc.gp_Dir_4(v.x[0], v.x[1], v.x[2]))));
}

/**
 * Het vlak waarin een kijkrichting projecteert, zonder OCCT erbij.
 *
 * WAAROM DIT APART STAAT. De getekende lijnen komen uit HLR, maar een MAATLIJN
 * komt uit de onderdelenlijst en moet in datzelfde vlak belanden. Zou die zijn
 * eigen omrekening gebruiken, dan wijst een maatlijn net naast de lijn waar hij
 * over gaat - en dat zie je pas op papier. `assenstelsel` hierboven gebruikt
 * dezelfde assen, dus er is één definitie.
 *
 * @returns {{ n, x, y, naar2D(p) }} de drie assen en de omrekening van een
 *          3D-punt naar [x, y] in het vlak van het blad.
 */
export function vlakVan(richting, omhoog) {
    const n = normaliseer(richting);
    let op = normaliseer(omhoog || [0, 0, 1]);
    if (Math.abs(punt(op, n)) > 0.999) op = [0, 1, 0];

    // Rechtshandig: X x Y = Z. Met Z de kijkrichting en Y "omhoog" op het blad
    // is X het kruisproduct van die twee, en Y volgt daaruit.
    const x = normaliseer(kruis(op, n));
    const y = kruis(n, x);

    return { n, x, y, naar2D: (p) => [punt(p, x), punt(p, y)] };
}

/**
 * De randen van een compound als rijen 2D-punten.
 *
 * HLR levert de lijnen al in het vlak van het blad: de X en Y van elk punt zijn
 * de bladcoördinaten, de Z is de diepte en doet hier niet meer mee.
 *
 * De bemonstering is dezelfde als in brep-edges.js - BRepAdaptor_Curve plus
 * GCPnts_TangentialDeflection - zodat er niet twee manieren bestaan om een rand
 * in punten om te zetten die langzaam uit elkaar gaan lopen. Een rechte rand
 * levert altijd twee punten op; alleen bogen worden echt bemonsterd.
 */
function lijnenVan(oc, houd, compound, fijnheid) {
    const lijnen = [];
    if (!compound || compound.IsNull()) return lijnen;

    const verkenner = houd(new oc.TopExp_Explorer_2(compound,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));

    for (; verkenner.More(); verkenner.Next()) {
        const rand = oc.TopoDS.Edge_1(verkenner.Current());
        if (oc.BRep_Tool.Degenerated(rand)) continue;

        const adapter = houd(new oc.BRepAdaptor_Curve_2(rand));
        const bemonstering = houd(new oc.GCPnts_TangentialDeflection_2(
            adapter, 0.08, fijnheid, 2, 1e-7, 1e-7));

        const n = bemonstering.NbPoints();
        if (n < 2) continue;
        const punten = [];
        for (let k = 1; k <= n; k++) {
            const p = bemonstering.Value(k);
            punten.push([p.X(), p.Y()]);
        }
        lijnen.push(punten);
    }
    return lijnen;
}

/** De omhullende rechthoek van een stel lijnen. */
function omvatting(lijnen) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const lijn of lijnen) {
        for (const [x, y] of lijn) {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
        }
    }
    if (!Number.isFinite(x0)) return { min: [0, 0], max: [0, 0], breedte: 0, hoogte: 0 };
    return { min: [x0, y0], max: [x1, y1], breedte: x1 - x0, hoogte: y1 - y0 };
}

const punt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const kruis = (a, b) => [a[1] * b[2] - a[2] * b[1],
                         a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];

function normaliseer(v) {
    const l = Math.hypot(v[0], v[1], v[2]);
    if (!(l > 0)) throw new Error('projectie: richting mag niet nul zijn');
    return [v[0] / l, v[1] / l, v[2] / l];
}
