// Chemische ankers op beton: een vereenvoudigde toets naar NEN-EN 1992-4.
//
// FASE 2 van PLAN-STERKTE.md. Een rekenhulp, geen ankerberekening: de
// fabrikant van het anker levert software die alle bezwijkvormen en de
// ETA-voorwaarden meeneemt, en een constructeur hoort het resultaat te
// beoordelen. Dat staat er bij elke uitkomst bij.
//
// ALLES WAT PRODUCTSPECIFIEK IS KOMT UIT DE ETA en wordt ingevoerd: diameter,
// verankeringsdiepte, hechtsterkte τRk, staalsterkte NRk,s en VRk,s, de
// kritieke afstanden en de partiële factoren. Zonder die waarden: onvoldoende
// gegevens. Ook k1 is invoer - bronnen noemen 7,7/11,0 (nagemonteerd) en
// 8,9/12,7 (ingestort) voor gescheurd/ongescheurd beton, en het verschil is
// te groot om te raden.
//
// Wat de app zelf rekent, met het artikel erbij:
//   kegeluitbraak    N0Rk,c = k1·√fck·hef^1,5            (NEN-EN 1992-4, 7.2.1.4)
//   hechting         N0Rk,p = π·d·hef·τRk                  (NEN-EN 1992-4, 7.2.1.6)
//   randinvloed      ψs = 0,7 + 0,3·c/ccr ≤ 1              (idem, voor beide)
//   oppervlakte      Ac/A0c met scr = 2·ccr, ccr uit de ETA of 1,5·hef
//
// Niet berekend, wel gemeld: betonrandbreuk door dwarskracht, splijten,
// wapening (ψre), excentriciteit (ψec), en de voorwaarden h ≥ hmin, c ≥ cmin,
// s ≥ smin uit de ETA - die worden alleen vergeleken als ze ingevuld zijn.

import { STATUS } from './sterkte.js';

const r1 = (v) => Math.round(v * 10) / 10;

/** De oppervlakteverhouding Ac/A0c van één anker bij één rand op afstand c. */
function oppervlakteFactor(c, ccr) {
    const scr = 2 * ccr;
    const breedte = Math.min(c, ccr) + ccr;           // naar de rand toe ingekort
    return (breedte * scr) / (scr * scr);
}

/**
 * GROEPSWERKING: n ankers in trek op onderlinge afstand s delen hun kegel als
 * s kleiner is dan scr = 2·ccr. De gezamenlijke projectie is (scr + (n-1)·s)
 * in plaats van n·scr; per anker dus die verhouding. Zonder dit rekent een
 * groep van twee ankers op 90 mm alsof elk een eigen kegel heeft - onveilig.
 */
const groepFactor = (n, s, ccr) => {
    const scr = 2 * ccr;
    if (n <= 1) return 1;
    return Math.min(1, (scr + (n - 1) * Math.min(s, scr)) / (n * scr));
};

/** Randfactor ψs = 0,7 + 0,3·c/ccr, hooguit 1. */
const randFactor = (c, ccr) => Math.min(1, 0.7 + 0.3 * c / ccr);

/**
 * De krachten op de ankers onder één staander.
 *
 * Starre voetplaat, het moment wordt opgenomen tussen de ankerrij aan de
 * trekzijde en de drukzone aan de rand van de plaat. De arm is de afstand van
 * die ankers tot de drukrand - bij de huidige plaat (beide ankers op de
 * hartlijn, 50 mm breed) maar 25 mm. Dat is de veilige kant van een starre
 * plaat; een constructeur kan een kleinere arm aanhouden.
 *
 * @param MEd   rekenmoment aan de voet [Nmm]
 * @param VEd   rekendwarskracht [N]
 * @param plaat { breedte (dwars op de leuning), ankers: [afstand dwars vanaf het hart] }
 */
export function ankerKrachten(MEd, VEd, plaat) {
    const halfB = plaat.breedte / 2;
    const ankers = plaat.ankers || [];
    if (!ankers.length) return { fout: 'geen ankers' };
    // Trekzijde: de ankers aan de kant tegenover de drukrand (+halfB is druk).
    const minPos = Math.min(...ankers);
    const trek = ankers.filter(a => Math.abs(a - minPos) < 1e-6);
    const arm = halfB - minPos;
    if (!(arm > 0)) return { fout: 'de ankers liggen niet binnen de plaat' };
    const NEdTotaal = MEd / arm;
    return { arm, NEdPerAnker: NEdTotaal / trek.length, aantalTrek: trek.length,
             VEdPerAnker: VEd / ankers.length };
}

/**
 * De voetplaat zoals de berekening hem ziet: breedte dwars op de leuning en
 * de dwarspositie van elk anker. `langs` is de plaat zoals hij getekend wordt
 * (150 langs de leuning, beide gaten op de hartlijn); `dwars` is dezelfde
 * plaat een kwartslag gedraaid.
 */
export function plaatVoor(stand, vp) {
    return stand === 'dwars'
        ? { breedte: vp.lengte, ankers: [-vp.gatAfstand / 2, vp.gatAfstand / 2], sTrek: 0 }
        : { breedte: vp.breedte, ankers: [0, 0], sTrek: vp.gatAfstand };
}

/**
 * Alle ankercontroles voor de zwaarst belaste staander.
 *
 * @param last   { MEd [Nmm], VEd [N] } - uit sterkte.js (rekenwaarden)
 * @param plaat  { breedte, ankers }
 * @param a      ETA en beton: { d, hef, tauRk, NRks, VRks, k1, ccr, gammaMs,
 *               gammaMp, gammaMc, fck, c, h, hmin, cmin }
 *               (mm, N/mm², kN; c = kleinste randafstand)
 */
export function controleerAnkers(last, plaat, a) {
    const uit = [];
    const n = (v) => Number(v);
    const nodig = { d: 'ankerdiameter d', hef: 'verankeringsdiepte hef', tauRk: 'hechtsterkte τRk (ETA)',
        NRks: 'staalsterkte NRk,s (ETA)', VRks: 'staalsterkte VRk,s (ETA)', k1: 'k1 (ETA/NEN-EN 1992-4)',
        gammaMs: 'γMs (ETA)', gammaMp: 'γMp (ETA)', gammaMc: 'γMc (ETA)', fck: 'betonsterkte fck', c: 'randafstand c' };
    const ontbreekt = Object.entries(nodig).filter(([k]) => !(n(a[k]) > 0)).map(([, t]) => t);
    const kr = ankerKrachten(last.MEd, last.VEd, plaat);
    const kop = 'Ankers onder de zwaarst belaste staander';
    if (kr.fout) return [{ naam: kop, status: STATUS.ONVOLDOENDE_GEGEVENS, toelichting: kr.fout }];
    const krachtTekst = `Trek ${r1(kr.NEdPerAnker / 1000)} kN per anker (${kr.aantalTrek} in trek, arm `
        + `${r1(kr.arm)} mm tot de drukrand), dwars ${r1(kr.VEdPerAnker / 1000)} kN per anker.`;
    if (ontbreekt.length) {
        return [{ naam: kop, status: STATUS.ONVOLDOENDE_GEGEVENS,
            toelichting: `${krachtTekst} Ontbreekt: ${ontbreekt.join(', ')}.` }];
    }
    const d = n(a.d), hef = n(a.hef), c = n(a.c);
    const ccr = n(a.ccr) > 0 ? n(a.ccr) : 1.5 * hef;
    const NEd = kr.NEdPerAnker, VEd = kr.VEdPerAnker;
    const rij = (naam, Ed, Rd, toel) => uit.push({
        naam, status: Ed <= Rd ? STATUS.VOLDOET : STATUS.VOLDOET_NIET,
        waarde: r1(Ed / 1000), grens: r1(Rd / 1000), eenheid: 'kN', exact: { Ed, Rd },
        toelichting: toel,
        voorstel: Ed <= Rd ? null : 'Grotere verankeringsdiepte of diameter, een grotere randafstand, '
            + 'of een voetplaat met de ankers dwars op de leuning (grotere arm).',
    });

    rij('Anker: staalbreuk op trek', NEd, n(a.NRks) * 1000 / n(a.gammaMs),
        `${krachtTekst} NRd,s = NRk,s/γMs (ETA).`);
    const sTrek = Number(plaat.sTrek) || 0;
    const groepP = groepFactor(kr.aantalTrek, sTrek, ccr);
    const groepC = groepFactor(kr.aantalTrek, sTrek, 1.5 * hef);
    const groepTekst = (g) => (kr.aantalTrek > 1
        ? ` Groep van ${kr.aantalTrek} in trek op ${sTrek} mm: factor ${Math.round(g * 1000) / 1000} per anker.` : '');
    const NRkp = Math.PI * d * hef * n(a.tauRk) * oppervlakteFactor(c, ccr) * randFactor(c, ccr) * groepP;
    rij('Anker: uittrekken / hechting', NEd, NRkp / n(a.gammaMp),
        `N0Rk,p = π·d·hef·τRk (NEN-EN 1992-4, 7.2.1.6), met Ap/A0p en ψs voor randafstand ${c} mm `
        + `(ccr = ${r1(ccr)} mm${n(a.ccr) > 0 ? ', ETA' : ' = 1,5·hef'}).${groepTekst(groepP)}`);
    const NRkc = n(a.k1) * Math.sqrt(n(a.fck)) * hef ** 1.5 * oppervlakteFactor(c, 1.5 * hef)
        * randFactor(c, 1.5 * hef) * groepC;
    rij('Beton: kegeluitbraak', NEd, NRkc / n(a.gammaMc),
        `N0Rk,c = k1·√fck·hef^1,5 (NEN-EN 1992-4, 7.2.1.4), k1 = ${a.k1}, fck = ${a.fck} N/mm², `
        + `met Ac/A0c en ψs voor randafstand ${c} mm. ψre en ψec = 1 aangenomen.${groepTekst(groepC)}`);
    rij('Anker: staalbreuk op afschuiving', VEd, n(a.VRks) * 1000 / n(a.gammaMs),
        'VRd,s = VRk,s/γMs (ETA); zonder hefboomarm (voetplaat op het beton).');

    // De ETA-voorwaarden - alleen als ze ingevuld zijn.
    const voorwaarden = [];
    if (n(a.hmin) > 0) voorwaarden.push([n(a.h) >= n(a.hmin), `betondikte ${a.h} ≥ hmin ${a.hmin} mm`]);
    if (n(a.cmin) > 0) voorwaarden.push([c >= n(a.cmin), `randafstand ${c} ≥ cmin ${a.cmin} mm`]);
    if (voorwaarden.length) {
        const ok = voorwaarden.every(([v]) => v);
        uit.push({ naam: 'ETA-voorwaarden (dikte, randafstand)', status: ok ? STATUS.VOLDOET : STATUS.VOLDOET_NIET,
            toelichting: voorwaarden.map(([v, t]) => (v ? '✓ ' : '✗ ') + t).join('; ') + '.' });
    } else {
        uit.push({ naam: 'ETA-voorwaarden (dikte, randafstand)', status: STATUS.ONVOLDOENDE_GEGEVENS,
            toelichting: 'Vul hmin en cmin uit de ETA in.' });
    }
    uit.push({ naam: 'Betonrandbreuk, splijten, interactie trek/dwars', status: STATUS.CONSTRUCTEUR,
        toelichting: 'Niet berekend. Toets de ankergroep met de software van de ankerfabrikant '
            + 'en laat een constructeur het resultaat beoordelen.' });
    return uit;
}
