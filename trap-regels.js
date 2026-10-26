// Rekenregels voor een rechte steektrap.
//
// De getallen staan in regels.json, onder "trap". Net als bij de balustrade
// is dat de enige bron; hier staat alleen de berekening.
//
// Het idee is hetzelfde als bij de balustrade:
//
//   INVOER     de hoogte die overbrugd moet worden, en de breedte
//   REGELS     max. optrede, min. aantrede, de loopregel
//   AFGELEID   aantal treden, werkelijke optrede en aantrede, aanzet, helling
//
// Je zegt "3 meter omhoog"; de regels bepalen dat het 16 stappen worden van
// 187,5 mm. Niet andersom. Een taalmodel hoort hier niets in te vullen.
//
// De normwaarden zijn NIET gecontroleerd tegen het Bouwbesluit of een NEN-norm.

const regels = await (await fetch(new URL('./regels.json', import.meta.url))).json();

export const STANDAARD = regels.trap.standaard;
export const GRENZEN = regels.trap.grenzen;
export const IJKPUNTEN = regels.trap.ijkpunten;
// Tredehoeken, stootborden, voet- en kopplaten, wandleuning. Zie regels.json.
export const ONDERDELEN = regels.trap.onderdelen;

const [MIN_OPTREDE, MAX_OPTREDE] = regels.trap.optrede;
const [MIN_AANTREDE, MAX_AANTREDE] = regels.trap.aantrede;
const [MIN_LOOPREGEL, MAX_LOOPREGEL] = regels.trap.loopregel;
const LOOPREGEL_DOEL = regels.trap.loopregelDoel;

export const NORMEN = {
    optrede: [MIN_OPTREDE, MAX_OPTREDE],
    aantrede: [MIN_AANTREDE, MAX_AANTREDE],
    loopregel: [MIN_LOOPREGEL, MAX_LOOPREGEL],
    loopregelDoel: LOOPREGEL_DOEL,
};

const OMSCHRIJVING = {
    hoogte: 'hoogte',
    breedte: 'breedte',
    tredeDikte: 'trededikte',
    tredeOverstek: 'overstek',
    boomHoogte: 'boomhoogte',
    boomDikte: 'boomdikte',
    vloerdikte: 'vloerdikte',
};

export const HOOFDHOOGTE = regels.trap.hoofdhoogte;

/**
 * Hoe lang het trapgat in de bovenvloer moet zijn. Zie regels.json onder
 * _hoofdhoogte voor de formule en waar de 2300 vandaan komt.
 *
 * @returns { lengte, hoofdhoogte, rond } - `rond` bij een wenteltrap: dan is
 *          `lengte` de diameter van het gat.
 */
export function trapgat(t, p) {
    if (p.soort === 'wentel') {
        return { lengte: p.diameter, hoofdhoogte: HOOFDHOOGTE, rond: true };
    }
    const vloer = Number(p.vloerdikte) || 0;
    return {
        lengte: (vloer + HOOFDHOOGTE) * t.aantrede / t.optrede,
        hoofdhoogte: HOOFDHOOGTE,
        rond: false,
    };
}

export function valideer(p) {
    const fouten = [];
    for (const [naam, [min, max]] of Object.entries(GRENZEN)) {
        const waarde = p[naam];
        if (typeof waarde !== 'number' || !Number.isFinite(waarde)) {
            fouten.push(`${OMSCHRIJVING[naam]}: geen geldig getal`);
        } else if (waarde < min || waarde > max) {
            fouten.push(`${OMSCHRIJVING[naam]}: ${waarde} mm valt buiten ${min}–${max} mm`);
        }
    }
    return fouten;
}

/**
 * Rekent een trap door.
 *
 * Stap 1 - hoeveel stappen omhoog?
 *   Het kleinste aantal waarbij de optrede onder het maximum blijft:
 *       optreden = ceil(hoogte / maxOptrede)
 *   Naar boven afronden. Naar beneden zou een te hoge trede geven, en dat is
 *   de kant waar het onveilig wordt.
 *
 * Stap 2 - hoe diep wordt een trede?
 *   Uit de loopregel:  2 x optrede + aantrede = doel
 *   Dus:               aantrede = doel - 2 x optrede
 *   Daarna begrensd op zijn eigen minimum en maximum.
 *
 * Stap 3 - wat blijft er over?
 *   Het aantal TREDEN is er een minder dan het aantal optreden: de bovenste
 *   stap is de verdiepingsvloer zelf. De aanzet is de horizontale ruimte die
 *   de trap inneemt.
 *
 * We ronden niet tussentijds af: over twintig treden telt dat op.
 */
export function berekenTrap({ hoogte, bordesNa = 0, bordesLengte = 0 }) {
    const optreden = Math.max(1, Math.ceil(hoogte / MAX_OPTREDE));
    const optrede = hoogte / optreden;

    const uitLoopregel = LOOPREGEL_DOEL - 2 * optrede;
    const aantrede = Math.min(MAX_AANTREDE, Math.max(MIN_AANTREDE, uitLoopregel));

    const treden = optreden - 1;

    // Met een bordes valt er één trede weg - het bordes neemt die plek in - en
    // komt de bordeslengte ervoor in de plaats. De trap wordt dus langer dan
    // zonder bordes, want een bordes is breder dan een trede.
    const bordes = geldigBordes(bordesNa, optreden)
        ? { na: bordesNa, lengte: bordesLengte, hoogte: bordesNa * optrede }
        : null;

    const vluchten = bordes
        ? [{ treden: bordes.na - 1 }, { treden: treden - bordes.na }]
        : [{ treden }];

    const aanzet = bordes
        ? (treden - 1) * aantrede + bordes.lengte
        : treden * aantrede;

    return {
        optreden,
        treden,
        optrede,
        aantrede,
        aanzet,
        bordes,
        vluchten,
        // De helling van de trap is de hoek van de lijn door de TREDENEUZEN,
        // dus optrede/aantrede. Niet hoogte/aanzet: die twee zijn niet gelijk,
        // omdat de bovenste stap de verdiepingsvloer zelf is en dus geen
        // aantrede kost. Bij 3 meter scheelt dat bijna 2 graden.
        helling: Math.atan2(optrede, aantrede) * 180 / Math.PI,
        // De loopregel zoals hij werkelijk uitpakt. Klemt de aantrede tegen
        // zijn minimum of maximum aan, dan kan dit buiten het comfortbereik
        // vallen - en dan hoort de gebruiker dat te weten.
        loopregel: 2 * optrede + aantrede,
    };
}

/**
 * Kan er een bordes na deze stap?
 *
 * Er moet aan beide kanten minstens één trede overblijven. Een bordes meteen na
 * de eerste stap is geen bordes maar een verhoogde vloer, en een bordes vlak
 * onder de bovenvloer net zo goed.
 */
function geldigBordes(na, optreden) {
    return Number.isFinite(na) && na >= 2 && na <= optreden - 2;
}

/**
 * Controleert het bordes apart, want of het kan hangt af van het AANTAL
 * optreden - en dat volgt pas uit de hoogte. Dat past niet in de gewone
 * grenzencontrole, die elk veld op zichzelf bekijkt.
 */
export function controleerBordes(p) {
    const na = Number(p.bordesNa) || 0;
    if (na === 0) return [];

    const optreden = Math.max(1, Math.ceil(p.hoogte / MAX_OPTREDE));
    if (optreden < 4) {
        return [`Deze trap heeft maar ${optreden} optreden; voor een bordes zijn `
            + 'er minstens 4 nodig.'];
    }
    if (!geldigBordes(na, optreden)) {
        return [`Een bordes kan hier na stap 2 tot en met ${optreden - 2}. `
            + `Je koos ${na}.`];
    }
    return [];
}

/** Waarschuwingen die geen fout zijn, maar wel het vermelden waard. */
export function beoordeelTrap(trap) {
    const opmerkingen = [];

    if (trap.optrede < MIN_OPTREDE) {
        opmerkingen.push(
            `De optrede is ${trap.optrede.toFixed(1)} mm, onder het minimum van `
            + `${MIN_OPTREDE} mm. Zo'n flauwe trap loopt onprettig.`);
    }
    if (trap.loopregel < MIN_LOOPREGEL || trap.loopregel > MAX_LOOPREGEL) {
        opmerkingen.push(
            `De loopregel komt uit op ${trap.loopregel.toFixed(0)} mm, buiten `
            + `${MIN_LOOPREGEL}–${MAX_LOOPREGEL} mm. De aantrede is tegen zijn `
            + 'grens aangelopen; de trap loopt hierdoor minder comfortabel.');
    }
    return opmerkingen;
}
