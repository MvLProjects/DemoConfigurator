// DXF schrijven voor de plaatdelen: wat er naar de snijtafel gaat.
//
// WAAROM. Een voetplaat en een trapboom worden uit plaat gesneden, op een laser
// of een plasmatafel. Die machines lezen DXF. Zonder dat bestand moet iemand de
// plaat natekenen uit een maatvoering op papier - en dan gaat de gatafstand een
// keer mis, of de plaatdikte wordt vergeten.
//
// De app kent de omtrek en de gaten exact: ze staan in dezelfde onderdeellijst
// waar de 3D-geometrie en de stuklijst uit komen. Er wordt hier dus niets
// nagetekend, alleen opgeschreven in een ander formaat.
//
// WELKE DXF. Versie R12, en alleen LINE en CIRCLE. Dat is het oudste en
// eenvoudigste wat er is, en juist daarom leest élke snijmachine en elk
// tekenpakket het. Nieuwere varianten hebben LWPOLYLINE en bogen met bulge,
// wat compacter is, maar oudere besturingen struikelen erover. Een
// productiebestand moet openen, niet elegant zijn.
//
// WAT ER NIET IN ZIT: geen snijvolgorde, geen aanloop/uitloop, geen lead-ins,
// geen kerf-compensatie. Dat zijn keuzes van de machine en van degene die hem
// bedient, en die horen niet in een ontwerpbestand. De DXF beschrijft de VORM.
//
// EENHEID: millimeters, en de oorsprong linksonder op het deel. Wie het bestand
// opent, legt het zelf op de plaat.

const KOP = ['0', 'SECTION', '2', 'ENTITIES'].join('\n');
const STAART = ['0', 'ENDSEC', '0', 'EOF', ''].join('\n');

/** Een getal zoals DXF het wil: punt als decimaalteken, geen exponent. */
const getal = (w) => (Math.abs(w) < 1e-9 ? 0 : w).toFixed(4);

function lijn(x1, y1, x2, y2, laag) {
    return ['0', 'LINE', '8', laag,
            '10', getal(x1), '20', getal(y1), '30', '0.0',
            '11', getal(x2), '21', getal(y2), '31', '0.0'].join('\n');
}

function cirkel(x, y, straal, laag) {
    return ['0', 'CIRCLE', '8', laag,
            '10', getal(x), '20', getal(y), '30', '0.0',
            '40', getal(straal)].join('\n');
}

/**
 * De omtrek van een plaatdeel als een reeks punten, met de oorsprong linksonder.
 *
 * Twee soorten plaatdelen in dit project:
 *
 *  - een VOETPLAAT is een rechthoek van dx bij dy met boutgaten erin. De gaten
 *    staan al in de maten van de plaat zelf, gerekend vanaf de hoek.
 *  - een TRAPBOOM heeft een echte `omtrek`: een rij [x, z]-punten in het
 *    verticale vlak. Die wordt hier naar de oorsprong geschoven, zodat twee
 *    bomen met dezelfde vorm ook hetzelfde bestand opleveren.
 *
 * Geeft null voor alles wat geen plaatdeel is. Een profiel wordt gezaagd, niet
 * gesneden; daar hoort een zaaglengte bij en geen DXF.
 */
export function plaatVorm(deel) {
    if (deel.omtrek && deel.omtrek.length >= 3) {
        const x0 = Math.min(...deel.omtrek.map(([x]) => x));
        const z0 = Math.min(...deel.omtrek.map(([, z]) => z));
        return {
            omtrek: deel.omtrek.map(([x, z]) => [x - x0, z - z0]),
            gaten: [],
            dikte: deel.dikte ?? deel.dy,
        };
    }
    // Een plaat met een eigen omtrek, zoals de taartpunttrede van een
    // wenteltrap: de doorsnede IS de vorm die gesneden wordt, de lengte (dx)
    // is de plaatdikte.
    if (deel.plaat && deel.doorsnede && deel.doorsnede.length >= 3) {
        return { omtrek: deel.doorsnede.map(([v, w]) => [v, w]), gaten: [], dikte: deel.dx };
    }
    if (deel.gaten && deel.gaten.length) {
        return {
            omtrek: [[0, 0], [deel.dx, 0], [deel.dx, deel.dy], [0, deel.dy]],
            gaten: deel.gaten.map(g => ({ x: g.x, y: g.y, straal: g.diameter / 2 })),
            dikte: deel.dz,
        };
    }
    return null;
}

/**
 * Maakt een DXF van één plaatdeel.
 *
 * De omtrek komt op laag `OMTREK` en de gaten op `GATEN`. Veel
 * machinebesturingen snijden per laag in volgorde, en dan wil je de gaten vóór
 * de buitenomtrek: valt het deel er eerst uit, dan kan het verschuiven en staan
 * de gaten scheef. Door ze op een eigen laag te zetten kan de operator die
 * volgorde kiezen.
 *
 * @returns {string|null} de inhoud van het bestand, of null als het geen
 *                        plaatdeel is
 */
export function maakDxf(deel) {
    const vorm = plaatVorm(deel);
    if (!vorm) return null;

    const stukken = [KOP];
    for (const g of vorm.gaten) {
        stukken.push(cirkel(g.x, g.y, g.straal, 'GATEN'));
    }
    for (let i = 0; i < vorm.omtrek.length; i++) {
        const [x1, y1] = vorm.omtrek[i];
        const [x2, y2] = vorm.omtrek[(i + 1) % vorm.omtrek.length];
        stukken.push(lijn(x1, y1, x2, y2, 'OMTREK'));
    }
    stukken.push(STAART);
    return stukken.join('\n');
}
