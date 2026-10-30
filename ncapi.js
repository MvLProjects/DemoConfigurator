// DSTV-NC via de API van MvL Progress (cadapi.mvlprogress.nl).
//
// De API zet een STEP-bestand van één onderdeel om naar een DSTV-NC-bestand,
// en herkent daarbij zelf het profiel, de verstekken, zadels en gaten uit de
// echte 3D-vorm. Dat lost op wat nc1.js bewust niet doet: het teken en het
// vlak van een schuine snede. Zie de Swagger op
// https://cadapi.mvlprogress.nl/swagger/index.html.
//
// DE SLEUTEL is van de gebruiker en blijft in zijn browser (localStorage). Hij
// gaat nooit mee in een gedeelde link, een ontwerpbestand of het pakket, en
// staat nooit in de repo - die is openbaar.
//
// WAT ER NAAR BUITEN GAAT: per onderdeel zijn STEP, het materiaal, het aantal
// en de profielnaam als hint. Dat staat ook in het paneel.

export const NC_API = 'https://cadapi.mvlprogress.nl';

/**
 * Eén onderdeel omzetten.
 *
 * @param o  { step: Uint8Array, naam, materiaal, profielNaam, aantal }
 * @param sleutel   de API-sleutel (X-Api-Key)
 * @param haal      fetch, of een vervanger voor de zelftest
 * @returns de ConvertResponse van de API (ncContent, profile, length,
 *          reliability, warning, ...)
 * @throws Error met een leesbare melding (geen sleutel, 401, 422, netwerk)
 */
export async function zetOmNaarNc(o, sleutel, haal = fetch) {
    if (!sleutel) throw new Error('Geen API-sleutel ingesteld (Instellingen).');
    const form = new FormData();
    form.append('File', new Blob([o.step], { type: 'application/step' }), o.naam);
    if (o.materiaal) form.append('Material', o.materiaal);
    if (o.profielNaam) form.append('ProfileHint', o.profielNaam);
    if (o.aantal) form.append('Quantity', String(o.aantal));
    form.append('ProfileStandard', 'DIN_EN');
    let antwoord;
    try {
        antwoord = await haal(`${NC_API}/api/v1/convert`, {
            method: 'POST', headers: { 'X-Api-Key': sleutel }, body: form,
        });
    } catch (err) {
        throw new Error(`De NC-dienst is niet bereikbaar (${err.message}).`);
    }
    let lijf = null;
    try { lijf = await antwoord.json(); } catch { /* geen JSON */ }
    if (!antwoord.ok) {
        const uitleg = { 401: 'API-sleutel ontbreekt of is ongeldig', 400: 'het STEP-bestand werd niet geaccepteerd',
                         422: 'de omzetting is mislukt' }[antwoord.status] || `fout ${antwoord.status}`;
        throw new Error(`${uitleg}${lijf && lijf.message ? ': ' + String(lijf.message).replace(/\.+$/, '') : ''}.`);
    }
    if (!lijf || typeof lijf.ncContent !== 'string' || !lijf.ncContent) {
        throw new Error('De NC-dienst gaf geen NC-inhoud terug.');
    }
    return lijf;
}

/**
 * Alle gezaagde onderdelen omzetten, twee tegelijk.
 *
 * @param onderdelen  [{ nummer, naam, step, materiaal, profielNaam, aantal, zaaglengte }]
 * @returns { bestanden: [{ naam, data }], verslag: [regels] }
 */
export async function ncVoorOnderdelen(onderdelen, sleutel, meld = () => {}, haal = fetch) {
    const bestanden = [];
    const verslag = [];
    let klaar = 0;
    // Een sleutelfout geldt voor alles: dan stopt ook de andere werker, en
    // overschrijft zijn voortgang de foutmelding niet meer.
    let gestopt = null;
    const doe = async (o) => {
        if (gestopt) return;
        try {
            const r = await zetOmNaarNc(o, sleutel, haal);
            bestanden.push({ naam: `nc/${o.naam.replace(/\.stp$/i, '.nc')}`, data: r.ncContent, nummer: o.nummer });
            const betrouwbaar = r.reliability ? r.reliability.reliable : null;
            const zorgen = [
                ...(r.reliability && r.reliability.issues || []).map(i => i.message || i.code),
                ...(r.warning ? [r.warning] : []),
                ...(r.profileRecognized === false ? ['profiel niet herkend'] : []),
                ...(Number.isFinite(r.length) && o.zaaglengte && Math.abs(r.length - o.zaaglengte) > 1
                    ? [`lengte ${r.length} mm tegenover zaaglengte ${Math.round(o.zaaglengte)} mm`] : []),
            ];
            verslag.push(`${o.positie}  ${o.soort}: ${r.profile || '?'} (${r.codeProfile || '?'}), `
                + `${Math.round(r.length || 0)} mm, ${r.holeCount || 0} gaten - `
                + (betrouwbaar === false || zorgen.length
                    ? `CONTROLEREN: ${zorgen.join('; ') || 'niet betrouwbaar volgens de dienst'}`
                    : 'betrouwbaar volgens de dienst')
                + (r.ncUrl ? ` [${r.ncUrl}]` : ''));
        } catch (err) {
            verslag.push(`${o.positie}  ${o.soort}: GEEN NC - ${err.message}`);
            if (/sleutel/i.test(err.message)) gestopt = err;   // dan heeft de rest ook geen zin
        } finally {
            if (!gestopt) meld(`NC via MvL Progress: ${++klaar} van ${onderdelen.length}...`);
        }
    };
    const rij = [...onderdelen];
    const werkers = Array.from({ length: Math.min(2, rij.length) }, async () => {
        while (rij.length && !gestopt) await doe(rij.shift());
    });
    await Promise.all(werkers);
    if (gestopt) throw gestopt;
    bestanden.sort((a, b) => a.nummer - b.nummer);
    verslag.sort();
    return { bestanden: bestanden.map(({ naam, data }) => ({ naam, data })), verslag };
}
