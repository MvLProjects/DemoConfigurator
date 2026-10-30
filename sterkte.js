// Sterkte en doorbuiging van een balustrade: een vereenvoudigde berekening.
//
// ALLEEN BALUSTRADES. En nooit een verklaring dat iets veilig of
// gecertificeerd is: dit is een rekenhulp die zegt wat hij aanneemt, wat hij
// niet weet en waar een constructeur of een proef nodig is. Zie
// PLAN-STERKTE.md.
//
// GEEN VERZONNEN GETALLEN. Belastingen, veiligheidsfactoren en
// doorbuigingsgrenzen komen van de gebruiker, met zijn bron. Ontbreekt er
// iets, dan is de status ONVOLDOENDE_GEGEVENS en niet een aangenomen waarde.
// Alleen materiaalconstanten met een vaste normbron staan hieronder.
//
// DOORSNEDEGROOTHEDEN UIT DE MATEN. De catalogus heeft IY en WY, maar die zijn
// niet te vertrouwen: bij CHS 21,3x1,4 staan ze op 0, bij HQ 20x20x2 is WY
// gelijk aan IY. Dus uit diameter, wanddikte, breedte en hoekstralen, en een
// koker met afgeronde hoeken als veelhoek met bogen.

import { categorieVan } from './profielen.js';

export const STATUS = {
    VOLDOET: 'voldoet',
    VOLDOET_NIET: 'voldoet niet',
    ONVOLDOENDE_GEGEVENS: 'onvoldoende gegevens',
    CONSTRUCTEUR: 'constructeur of proef nodig',
};

/** Materiaalconstanten met hun normbron. fy alleen waar hij vastligt. */
export const MATERIAAL = {
    staal: { E: 210000, bronE: 'NEN-EN 1993-1-1, 3.2.6' },
    rvs: { E: 200000, bronE: 'NEN-EN 1993-1-4, 2.1.3' },
    aluminium: { E: 70000, bronE: 'NEN-EN 1999-1-1, 3.2.5' },
};

// fy voor t ≤ 40 mm, NEN-EN 1993-1-1 tabel 3.1. Afgeleid uit de staalsoort in
// de catalogus ("S235JRH" -> 235).
const FY_STAAL = { 235: 235, 275: 275, 355: 355 };
const BRON_FY = 'NEN-EN 1993-1-1, tabel 3.1 (t ≤ 40 mm)';

/** De aanbevolen Eurocode-factoren, voor de knop - nooit stil ingevuld. */
export const AANBEVOLEN_FACTOREN = {
    gammaQ: { waarde: 1.5, bron: 'NEN-EN 1990, tabel A1.2(B) - aanbevolen; de NB kan afwijken' },
    gammaM0: { waarde: 1.0, bron: 'NEN-EN 1993-1-1, 6.1 - aanbevolen; de NB kan afwijken' },
};

// --- doorsneden ----------------------------------------------------------

/** I om de x-as (∫y² dA) en de y-as (∫x² dA) en de oppervlakte van een
 *  gesloten veelhoek, tegen de klok in, om de oorsprong. */
function veelhoek(punten) {
    let A = 0, Ix = 0, Iy = 0;
    for (let i = 0; i < punten.length; i++) {
        const [x0, y0] = punten[i];
        const [x1, y1] = punten[(i + 1) % punten.length];
        const k = x0 * y1 - x1 * y0;
        A += k / 2;
        Ix += k * (y0 * y0 + y0 * y1 + y1 * y1) / 12;
        Iy += k * (x0 * x0 + x0 * x1 + x1 * x1) / 12;
    }
    return { A, Ix, Iy };
}

/** Een rechthoek bx × by met hoekstraal r, gecentreerd, als veelhoek. */
function rondeRechthoek(bx, by, r, stappen = 16) {
    const uit = [];
    const rr = Math.max(0, Math.min(r, bx / 2, by / 2));
    const hoeken = [[bx / 2 - rr, by / 2 - rr, 0], [-bx / 2 + rr, by / 2 - rr, 90],
                    [-bx / 2 + rr, -by / 2 + rr, 180], [bx / 2 - rr, -by / 2 + rr, 270]];
    for (const [cx, cy, start] of hoeken) {
        for (let k = 0; k <= stappen; k++) {
            const a = (start + 90 * k / stappen) * Math.PI / 180;
            uit.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
            if (rr === 0) break;
        }
    }
    return uit;
}

/**
 * De doorsnedegrootheden van een profiel, uit zijn maten.
 *
 * @param profiel   een profiel uit de catalogus
 * @returns { soort, A, Ix, Iy, Wx, Wy, bx, by, t } in mm, of { fout }.
 *          x en y zoals boxSize: bij een staander is x langs de leuning en y
 *          dwars erop; Ix hoort bij buiging met de diepte langs y.
 */
export function doorsnede(profiel) {
    if (!profiel) return { fout: 'geen profiel gekozen' };
    // Dezelfde drie plekken als omtrekVan in profielen.js: een profiel uit de
    // boom heeft `catalogue`, een verwijzing uit de kiezer `catalogus`.
    const c = (profiel.bron && profiel.bron.catalogue) || profiel.catalogus
        || profiel.catalogue || {};
    const doos = profiel.boxSize || (profiel.bron && profiel.bron.boxSize);
    const soort = categorieVan(profiel).sleutel;
    const getal = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    let A, Ix, Iy, bx, by, t = null;
    if (soort === 'CHS') {
        const D = getal(c.DA), s = getal(c.S);
        if (!D || !s) return { fout: 'diameter of wanddikte ontbreekt in de catalogus' };
        const d = D - 2 * s;
        A = Math.PI / 4 * (D * D - d * d);
        Ix = Iy = Math.PI / 64 * (D ** 4 - d ** 4);
        bx = by = D; t = s;
    } else if (soort === 'RoundBars') {
        const D = getal(c.D) || (doos && doos[0]);
        if (!D) return { fout: 'diameter ontbreekt' };
        A = Math.PI / 4 * D * D;
        Ix = Iy = Math.PI / 64 * D ** 4;
        bx = by = D;
    } else if (soort === 'SHS' || soort === 'RHS' || soort === 'Flats' || soort === 'SquareBars') {
        if (!doos) return { fout: 'buitenmaten ontbreken' };
        [bx, by] = doos;
        const buiten = rondeRechthoek(bx, by, soort === 'SHS' || soort === 'RHS' ? (getal(c.RA) || 0) : 0);
        let g = veelhoek(buiten);
        if (soort === 'SHS' || soort === 'RHS') {
            t = getal(c.S);
            if (!t) return { fout: 'wanddikte ontbreekt in de catalogus' };
            const binnen = veelhoek(rondeRechthoek(bx - 2 * t, by - 2 * t, getal(c.RI) || 0));
            g = { A: g.A - binnen.A, Ix: g.Ix - binnen.Ix, Iy: g.Iy - binnen.Iy };
        }
        ({ A, Ix, Iy } = g);
    } else {
        return { fout: `profielsoort ${soort} wordt (nog) niet berekend` };
    }
    return { soort, A, Ix, Iy, Wx: Ix / (by / 2), Wy: Iy / (bx / 2), bx, by, t };
}

/** fy en E voor het metaal en profiel, met bron; of { ontbreekt }. */
export function materiaalVoor(metaal, profiel, invoer = {}) {
    const m = MATERIAAL[metaal || 'staal'];
    if (!m) return { ontbreekt: `onbekend metaal "${metaal}"` };
    if ((metaal || 'staal') === 'staal') {
        const soorten = (profiel && profiel.items || []).map(i => i.material || '');
        const grade = soorten.map(s => /^S(\d{3})/i.exec(s.trim())).find(Boolean);
        const fy = grade && FY_STAAL[grade[1]];
        if (!fy) return { ontbreekt: 'staalsoort onbekend - vul fy in', E: m.E };
        return { fy, E: m.E, bronFy: `${grade[0]}: ${BRON_FY}`, bronE: m.bronE };
    }
    const fy = Number(invoer.fy);
    if (!(fy > 0)) return { ontbreekt: `vloeigrens van ${metaal} hangt van de legering af - vul fy in`, E: m.E };
    return { fy, E: m.E, bronFy: invoer.bronFy || 'ingevoerd door gebruiker', bronE: m.bronE };
}

// --- de balustrade -----------------------------------------------------------

/**
 * De invloedsbreedte van elke staander: halve velden links en rechts, aan een
 * vrij eind plus de handregeloverstek. Uit de staanderposities in het model.
 */
export function invloedsbreedtes(posities, overstek = 0) {
    const n = posities.length;
    const afstand = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const velden = posities.slice(1).map((p, i) => afstand(posities[i], p));
    return posities.map((_, i) => (i > 0 ? velden[i - 1] / 2 : overstek)
                                  + (i < n - 1 ? velden[i] / 2 : overstek));
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Alle controles van fase 1.
 *
 * @param m      { hoogte, overstek, metaal, staanderProfiel, handregelProfiel,
 *                 staanders: [[x,y,z]...] }   - uit het model
 * @param invoer { qk [kN/m], Qk [kN], gammaQ, gammaM0, dMax [mm], fy, bronQk }
 * @param catalogus  alle profielen, voor een voorstel (mag leeg)
 * @returns [{ naam, status, waarde, grens, eenheid, toelichting, voorstel }]
 */
export function controleerBalustrade(m, invoer, catalogus = []) {
    const uit = [];
    const tekort = [];
    const qk = Number(invoer.qk), Qk = Number(invoer.Qk);
    const gQ = Number(invoer.gammaQ), gM0 = Number(invoer.gammaM0);
    const dMax = Number(invoer.dMax);
    if (!(qk > 0)) tekort.push('lijnlast qk (NEN-EN 1991-1-1 + NB, bijlage NB.A)');
    if (!(gQ > 0)) tekort.push('belastingfactor γQ');
    if (!(gM0 > 0)) tekort.push('materiaalfactor γM0');

    const st = doorsnede(m.staanderProfiel);
    const hr = doorsnede(m.handregelProfiel);
    const matSt = materiaalVoor(m.metaal, m.staanderProfiel, invoer);
    const matHr = materiaalVoor(m.metaal, m.handregelProfiel, invoer);
    const H = Number(m.hoogte);
    const breedtes = invloedsbreedtes(m.staanders || [], Number(m.overstek) || 0);
    const bMax = breedtes.length ? Math.max(...breedtes) : 0;
    const velden = (m.staanders || []).slice(1).map((p, i) =>
        Math.hypot(p[0] - m.staanders[i][0], p[1] - m.staanders[i][1]));
    const Lmax = velden.length ? Math.max(...velden) : 0;

    const geenGegevens = (naam, wat) => uit.push({
        naam, status: STATUS.ONVOLDOENDE_GEGEVENS, toelichting: `Ontbreekt: ${wat}.` });

    // --- staander: buiging ------------------------------------------------
    const stBron = (s, mat) => `Wel = ${r1(s.Wx / 1000)} cm³, I = ${r1(s.Ix / 1e4)} cm⁴ (uit de maten), `
        + `fy = ${mat.fy} N/mm² (${mat.bronFy}), E = ${mat.E} N/mm² (${mat.bronE})`;
    if (st.fout) geenGegevens('Staander: buiging', `staanderprofiel - ${st.fout}`);
    else if (matSt.ontbreekt) geenGegevens('Staander: buiging', matSt.ontbreekt);
    else if (tekort.length) geenGegevens('Staander: buiging', tekort.join(', '));
    else {
        const F = qk * bMax;                       // N: kN/m × mm = N
        const MEd = gQ * F * H;                    // Nmm
        const MRd = st.Wx * matSt.fy / gM0;
        const ok = MEd <= MRd;
        // Grootste staanderafstand die nog voldoet (midden in een rechte rij is
        // de invloedsbreedte één h.o.h.).
        const hohMax = MRd / (gQ * qk * H);
        uit.push({
            naam: 'Staander: buiging aan de voet',
            status: ok ? STATUS.VOLDOET : STATUS.VOLDOET_NIET,
            waarde: r2(MEd / 1e6), grens: r2(MRd / 1e6), eenheid: 'kNm', exact: { MEd, MRd },
            toelichting: `Ingeklemd op de voetplaat; F = qk × ${Math.round(bMax)} mm invloedsbreedte `
                + `op ${H} mm hoogte. M_Ed = γQ·F·H, M_Rd = Wel·fy/γM0. ${stBron(st, matSt)}. `
                + 'Elastisch getoetst; normaalkracht en knik verwaarloosd.',
            voorstel: ok ? null : voorstelProfiel(m.staanderProfiel, catalogus,
                (s) => s.Wx * matSt.fy / gM0 >= MEd, 'staander')
                || `Staanderafstand hooguit ${Math.floor(hohMax)} mm.`,
            // De rekenkrachten aan de voet, voor de ankers (anker.js).
            voet: { MEd, VEd: gQ * F },
        });
    }

    // --- handregel: buiging per veld ------------------------------------------
    if (hr.fout) geenGegevens('Handregel: buiging', `handregelprofiel - ${hr.fout}`);
    else if (matHr.ontbreekt) geenGegevens('Handregel: buiging', matHr.ontbreekt);
    else if (tekort.length) geenGegevens('Handregel: buiging', tekort.join(', '));
    else if (!(Lmax > 0)) geenGegevens('Handregel: buiging', 'staanderafstand');
    else {
        // Horizontale last: buiging met de diepte langs x (de breedte).
        const MEdq = gQ * qk * Lmax * Lmax / 8;
        const MEdQ = Qk > 0 ? gQ * Qk * 1000 * Lmax / 4 : 0;
        const MEd = Math.max(MEdq, MEdQ);
        const MRd = hr.Wy * matHr.fy / gM0;
        const ok = MEd <= MRd;
        uit.push({
            naam: 'Handregel: buiging in het grootste veld',
            status: ok ? STATUS.VOLDOET : STATUS.VOLDOET_NIET,
            waarde: r2(MEd / 1e6), grens: r2(MRd / 1e6), eenheid: 'kNm', exact: { MEd, MRd },
            toelichting: `Veld ${Math.round(Lmax)} mm als ligger op twee steunpunten (veilige kant). `
                + `M_Ed = γQ·max(q·L²/8${Qk > 0 ? ', Q·L/4' : ''}). Wel = ${r1(hr.Wy / 1000)} cm³, `
                + `fy = ${matHr.fy} N/mm² (${matHr.bronFy}).`,
            voorstel: ok ? null : voorstelProfiel(m.handregelProfiel, catalogus,
                (s) => s.Wy * matHr.fy / gM0 >= MEd, 'handregel')
                || 'Kleinere staanderafstand.',
        });
    }

    // --- doorbuiging (bruikbaarheid, zonder factoren) -----------------------
    if (st.fout || hr.fout || matSt.ontbreekt || matHr.ontbreekt || !(qk > 0) || !(dMax > 0)) {
        geenGegevens('Doorbuiging van de handregel', [!(qk > 0) && 'lijnlast qk',
            !(dMax > 0) && 'toelaatbare doorbuiging (uit NB, bestek of constructeur)',
            (st.fout || hr.fout) && 'profielen', (matSt.ontbreekt || matHr.ontbreekt) && 'materiaal']
            .filter(Boolean).join(', '));
    } else {
        const F = qk * bMax;
        const dSt = F * H ** 3 / (3 * matSt.E * st.Ix);
        const dHq = 5 * qk * Lmax ** 4 / (384 * matHr.E * hr.Iy);
        const dHQ = Qk > 0 ? Qk * 1000 * Lmax ** 3 / (48 * matHr.E * hr.Iy) : 0;
        const d = dSt + Math.max(dHq, dHQ);
        const ok = d <= dMax;
        uit.push({
            naam: 'Doorbuiging van de handregel (midden in het veld)',
            status: ok ? STATUS.VOLDOET : STATUS.VOLDOET_NIET,
            waarde: r1(d), grens: r1(dMax), eenheid: 'mm',
            toelichting: `Staander ${r1(dSt)} mm (F·H³/3EI) + handregel ${r1(Math.max(dHq, dHQ))} mm `
                + `(5qL⁴/384EI${Qk > 0 ? ' of QL³/48EI' : ''}), karakteristieke belasting. `
                + `Grens ${dMax} mm ingevoerd door de gebruiker.`,
            voorstel: ok ? null : 'Stijver staander- of handregelprofiel, of een kleinere staanderafstand.',
        });
    }

    // --- wat de app (nog) niet betrouwbaar kan -------------------------------
    uit.push({
        naam: 'Voetplaat en las staander-voetplaat',
        status: STATUS.CONSTRUCTEUR,
        toelichting: 'Niet berekend: de buiging van de voetplaat en de las horen door een constructeur '
            + 'getoetst te worden. De ankers zelf staan hieronder (NEN-EN 1992-4, vereenvoudigd).',
    });
    uit.push(slingerIndicatie({ st, hr, matSt, matHr, H, Lmax }));
    return uit;
}

/** De stootenergie van de slingerproef: 50 kg, 0,5 kNm (≈ 1 m val). */
export const SLINGER = { massa: 50, energie: 500e3,      // Nmm
    bron: 'NB bij NEN-EN 1991-1-1 (oorsprong NEN 6702); opzet volgens Peutz en AGC' };

/**
 * FASE 3: de slingerproef als INDICATIE, nooit als oordeel.
 *
 * Stoot midden in het grootste veld op handregelhoogte. De stijfheid op dat
 * punt is de handregel als ligger op twee steunpunten (48EI/L³) in serie met
 * de twee staanders die elk de helft opnemen (2 × 3EI/H³). Gaat alle energie
 * in elastische vervorming, dan is de kracht F = √(2·E·k) - een bovengrens,
 * want in werkelijkheid gaat er energie verloren in de zak, de verbindingen en
 * plastische vervorming. Daarmee: blijven staander en handregel elastisch
 * (σ ≤ fy), of vervormen ze blijvend? Blijvende vervorming mag bij de proef,
 * bezwijken of doorvallen niet - en dat kan een berekening niet zeggen.
 */
export function slingerIndicatie({ st, hr, matSt, matHr, H, Lmax }) {
    const naam = 'Slingerproef (zandzak 50 kg, 0,5 kNm) - indicatie';
    if (!st || st.fout || !hr || hr.fout || !matSt || matSt.ontbreekt || !matHr || matHr.ontbreekt
        || !(Lmax > 0) || !(H > 0)) {
        return { naam, status: STATUS.CONSTRUCTEUR,
            toelichting: 'Geen indicatie: profielen of materiaal ontbreken. Een berekening vervangt de '
                + `slingerproef hoe dan ook niet (${SLINGER.bron}).` };
    }
    const kHr = 48 * matHr.E * hr.Iy / Lmax ** 3;
    const kSt = 2 * 3 * matSt.E * st.Ix / H ** 3;
    const k = 1 / (1 / kHr + 1 / kSt);
    const F = Math.sqrt(2 * SLINGER.energie * k);
    const sigmaSt = (F / 2) * H / st.Wx;
    const sigmaHr = F * Lmax / 4 / hr.Wy;
    const elastisch = sigmaSt <= matSt.fy && sigmaHr <= matHr.fy;
    return {
        naam, status: STATUS.CONSTRUCTEUR,
        waarde: r1(F / 1000), grens: null, eenheid: 'kN',
        exact: { F, k, sigmaSt, sigmaHr, verplaatsing: F / k },
        toelichting: `Bovengrens als alle 0,5 kNm elastisch wordt opgenomen: F = √(2·E·k) = ${r1(F / 1000)} kN, `
            + `verplaatsing ${r1(F / k)} mm. Spanning staander ${Math.round(sigmaSt)} N/mm², handregel `
            + `${Math.round(sigmaHr)} N/mm² (fy ${matSt.fy}). `
            + (elastisch ? 'Blijft volgens deze indicatie elastisch. '
                : 'Vervormt volgens deze indicatie blijvend; dat mag bij de proef, bezwijken niet. ')
            + 'Een berekening vervangt de slingerproef niet: de proef (of een constructeur) beslist. '
            + `Proefopzet: ${SLINGER.bron}.`,
    };
}

/**
 * Het lichtste profiel van dezelfde soort uit de catalogus dat voldoet, als
 * voorstel. null als er geen is of de catalogus leeg is.
 */
function voorstelProfiel(huidig, catalogus, voldoet, rol) {
    if (!huidig || !catalogus || !catalogus.length) return null;
    const soort = categorieVan(huidig).sleutel;
    const kandidaten = catalogus
        .filter(p => categorieVan(p).sleutel === soort)
        .map(p => ({ p, s: doorsnede(p) }))
        .filter(k => !k.s.fout && voldoet(k.s))
        .sort((a, b) => a.s.A - b.s.A);
    if (!kandidaten.length) return null;
    const naam = (p) => p.englishLabel || p.label || 'profiel';
    return `Lichtste ${soort}-profiel dat voldoet als ${rol}: ${naam(kandidaten[0].p)}.`;
}
