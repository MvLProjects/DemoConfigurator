// Keurt een balustrade op aansluitingen, vóórdat er geometrie van gemaakt wordt.
//
// WAAROM DIT BESTAAT. De app controleerde tot nu toe alleen de INVOER: valt elk
// getal binnen zijn grenzen (zie valideer in balustrade-rules.js). Of de
// onderdelen op elkaar PASSEN werd nergens gecontroleerd. Dat is in dit project
// vijf keer op rij misgegaan, steeds op dezelfde manier: er stak staal door
// staal of een paal naast de handregel, de app zei "niets aan de hand", en het
// kwam pas aan het licht toen de gebruiker een schermafdruk stuurde.
//
// Dit bestand rekent alleen. Geen OCCT, geen three.js, geen DOM - dus het is
// snel genoeg om bij elke toetsaanslag te draaien, en het is los te testen.
//
// HET WERKT OP DE VERBINDINGEN. padDelen zegt sinds de derde opdracht niet
// alleen WAAR elk stuk staal ligt maar ook WELKE stukken op elkaar aansluiten
// en HOE. Zonder die lijst zou deze keuring uit de meetkunde moeten raden welke
// twee delen bij elkaar horen, en dan vind je óf te veel óf te weinig.
//
// WAT DIT NIET DOET. Niets hier is een norm. Een balustrade die door deze
// keuring komt is meetkundig consistent en waarschijnlijk maakbaar; of hij
// voldoet aan het Bouwbesluit of aan een NEN-norm is niet gecontroleerd en mag
// de app dus ook niet beweren. Zie de lijst CONTROLEREN in regels.json.

import { CONTROLES } from './balustrade-rules.js';

// --- kleine hulpjes --------------------------------------------------------

const punt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const kruis = (a, b) => [a[1] * b[2] - a[2] * b[1],
                         a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
const lengte = (a) => Math.hypot(a[0], a[1], a[2]);
const eenheid = (a) => { const l = lengte(a); return l < 1e-12 ? a : a.map(w => w / l); };

/**
 * Hoe ver een onderdeel reikt langs een richting: [van, tot].
 *
 * Over alle ACHT hoekpunten van het doosje, niet over de oorsprong en de assen.
 * Een onderdeel kan scheef in zijn eigen doosje liggen - een handregel zakt
 * loodrecht op zijn helling, een trapboom staat op de traphelling - en dan ligt
 * de oorsprong niet op het uiterste punt. Dat is in dit project al vier keer
 * misgegaan, en daarom staat het hier één keer goed.
 */
export function spanOp(deel, as) {
    let laag = Infinity, hoog = -Infinity;
    for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) {
        const w = punt(deel.oorsprong, as)
            + a * deel.dx * punt(deel.xAs, as)
            + b * deel.dy * punt(deel.yAs, as)
            + c * deel.dz * punt(deel.zAs, as);
        if (w < laag) laag = w;
        if (w > hoog) hoog = w;
    }
    return [laag, hoog];
}

/**
 * De richting DWARS op een verbinding, horizontaal.
 *
 * Bij een handregel die over een staander ligt, is dat de richting waarin je
 * moet kijken om te zien of de paal er naast uitsteekt: haaks op de leuning en
 * waterpas. Loopt de verbinding recht omhoog (dat komt hier niet voor, maar
 * nooit door nul delen), dan valt hij terug op de y-as.
 */
function dwarsVan(richting) {
    const d = kruis([0, 0, 1], richting);
    return lengte(d) < 1e-9 ? [0, 1, 0] : eenheid(d);
}

// --- de keuring ------------------------------------------------------------

/** Hoe een onderdeel in een melding heet. */
const naamVan = (deel) => {
    const p = deel.profiel;
    const profiel = p && (p.englishLabel || p.label);
    return profiel ? `${deel.soort} ${profiel}` : deel.soort;
};

/** De maat waarop een onderdeel in een melding wordt aangeduid. */
const breedteVan = (deel, as) => {
    const [laag, hoog] = spanOp(deel, as);
    return hoog - laag;
};

/**
 * DEKKING: ligt er genoeg bovenop?
 *
 * Bij een `ligt-op`-verbinding draagt het ene deel het andere - een handregel
 * over een staander. Is die regel SMALLER dan de paal, dan steekt de paal er
 * aan weerszijden naast uit. Dat is het geval op de foto bij de derde opdracht,
 * en nagemeten: een staander CHS 48,3 onder een handregel CHS 33,7 steekt er
 * 7,30 mm PER KANT naast uit, zonder dat de app iets meldde.
 *
 * Gemeten DWARS op de verbinding en op de werkelijke hoekpunten van allebei de
 * doosjes, niet op "de breedte uit het manifest". Een profiel kan gedraaid
 * staan, en dan is zijn breedte in deze richting een andere maat.
 */
function keurDekking(delen, verbindingen, eisen) {
    const uit = [];
    const marge = eisen.dekking?.ligtOp ?? 0;

    for (const v of verbindingen) {
        if (v.soort !== 'ligt-op') continue;
        const boven = delen[v.a], onder = delen[v.b];
        if (!boven || !onder) continue;
        // Een afgeronde staanderkop steekt wel uit, maar zonder scherpe hoek:
        // zo bouwt Marthijn het ook. Zie _afronding in regels.json.
        if (onder.afronden || onder.regelVoor) continue;

        const as = dwarsVan(v.richting);
        const [bLaag, bHoog] = spanOp(boven, as);
        const [oLaag, oHoog] = spanOp(onder, as);

        // Aan elke kant apart: hoeveel steekt het gedragen deel buiten het
        // dragende uit? Een negatieve waarde betekent dat er nog ruimte over is.
        const links = bLaag - oLaag;
        const rechts = oHoog - bHoog;
        const uitsteek = Math.max(links, rechts);
        if (uitsteek <= marge + 1e-9) continue;

        const breedBoven = bHoog - bLaag;
        const breedOnder = oHoog - oLaag;
        // Wat er nodig is: het gedragen deel afdekken, plus aan weerszijden de
        // gevraagde marge. Niet "er een vast getal bij" - de opdracht vraagt
        // uitdrukkelijk om de maat uit de werkelijke meetkunde te halen.
        const nodig = breedOnder + 2 * marge;

        uit.push({
            soort: 'te-smal',
            ernst: 'meetkundig',
            delen: [v.a, v.b],
            hoofddeel: v.a,
            titel: `${naamVan(boven)} is onvoldoende breed voor de aansluiting`,
            tekst: `${naamVan(onder)} steekt er ${uitsteek.toFixed(1)} mm per kant `
                 + 'naast uit.',
            gemeten: breedBoven,
            nodig,
            eenheid: 'mm',
            // Welke kant het op moet, zodat een voorstel weet wat te zoeken.
            wens: { wat: 'breedte', deel: v.a, minstens: nodig },
            punt: v.punt,
        });
    }
    return uit;
}

/**
 * Keurt een balustrade. Alleen rekenwerk; `delen` en `verbindingen` komen uit
 * padDelen.
 *
 * `eisen` is standaard het blok `controles` uit regels.json, maar kan worden
 * meegegeven zodat een test of een latere HiCAD-regelset er een andere in kan
 * schuiven zonder aan dit bestand te komen.
 *
 * Geeft een VERSLAG terug en nooit een exception: een keuring die zelf omvalt
 * is erger dan geen keuring. De bevindingen staan op volgorde van ernst.
 */
export function keurGeometrie(delen, verbindingen, eisen = CONTROLES) {
    const bevindingen = [];
    if (Array.isArray(delen) && Array.isArray(verbindingen)) {
        bevindingen.push(...keurDekking(delen, verbindingen, eisen));
    }

    const volgorde = { meetkundig: 0, maakbaarheid: 1, norm: 2 };
    bevindingen.sort((a, b) => (volgorde[a.ernst] ?? 9) - (volgorde[b.ernst] ?? 9)
        || b.nodig - b.gemeten - (a.nodig - a.gemeten));

    return {
        bevindingen,
        // Expliciet, zodat niemand "geen bevindingen" leest als "goedgekeurd".
        // Wat hier getoetst is, staat in regels.json onder _controles; normen
        // zitten daar niet bij.
        getoetst: ['dekking'],
        goed: bevindingen.length === 0,
    };
}

// --- van bevinding naar voorstel -------------------------------------------

/**
 * Zoekt het eerstvolgende profiel dat wél breed genoeg is.
 *
 * In DEZELFDE FAMILIE: zelfde norm (`table`), zodat je niet van een warm
 * gewalste buis naar een koudgevormde koker springt omdat die toevallig past.
 * De catalogus heeft per norm honderden maten - alleen DIN_EN_10210-2_R al 871 -
 * dus er is bijna altijd iets.
 *
 * GEEN VAST GETAL ERBIJ. De opdracht zegt het met zoveel woorden: "Gebruik niet
 * standaard een willekeurige extra 10 mm." Daarom de eerstvolgende maat die aan
 * de gemeten eis voldoet, en niets groter.
 *
 * @param profielen  alle profielen uit de catalogus (cat.alleProfielen)
 * @param huidig     het profiel dat nu gekozen is, of null
 * @param minstens   de breedte die het moet halen, in mm
 */
export function zoekBreder(profielen, huidig, minstens) {
    if (!Array.isArray(profielen) || !profielen.length) return null;
    const doos = (p) => (p.bron && p.bron.boxSize) || p.boxSize || null;

    // Zonder huidig profiel kunnen we geen familie kiezen; dan geen voorstel.
    // Beter geen voorstel dan een profiel uit een willekeurige norm.
    if (!huidig || !huidig.table) return null;

    const familie = profielen
        .filter(p => p.table === huidig.table && doos(p))
        .map(p => ({ p, breedte: doos(p)[0], hoogte: doos(p)[1] }))
        .filter(x => x.breedte >= minstens - 1e-9)
        // Eerst op breedte, dan op hoogte: de kleinste die voldoet.
        .sort((a, b) => a.breedte - b.breedte || a.hoogte - b.hoogte);

    return familie.length ? familie[0].p : null;
}
