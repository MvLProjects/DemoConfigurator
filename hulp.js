// Een hulpvraag die bruikbaar is: wat stond er, wat deed je, wat ging er mis.
//
// WAAROM DIT BESTAAT. De meeste hulpvragen zijn onbruikbaar omdat niemand
// opschrijft wat hij deed - "hij doet het niet" met een foto van een scherm.
// De app weet precies welke maten erin stonden, welke profielen gekozen waren
// en welke melding eruit kwam. Dat is wat iemand nodig heeft om te kunnen
// helpen, en het kost de gebruiker één klik in plaats van twintig minuten
// navragen.
//
// WAAROM ER NIETS VANZELF WEGGAAT. Deze app draait in de browser met een
// lokaal servertje ernaast; er is geen mailserver. Een maildienst erbij zou
// een sleutel in de JavaScript betekenen, en die kan iedereen lezen die de
// pagina opent. Daarom maakt dit bestand alleen TEKST. Hoe die verstuurd wordt
// kiest de gebruiker: klembord, bestand, of `mailto:` dat zijn eigen
// mailprogramma opent met alles al ingevuld.
//
// EN DE GEBRUIKER ZIET HET EERST. Een knop die stilletjes verstuurt wat de app
// over je weet is iets anders dan een knop die laat zien wat hij wil
// versturen. Het tweede hoort hier.

/** Wat er bewaard blijft tussen twee keer openen: alleen het mailadres. */
export const SLEUTEL = 'railing-configurator/hulpadres/1';

export function leesAdres() {
    try { return localStorage.getItem(SLEUTEL) || ''; } catch { return ''; }
}

export function schrijfAdres(adres) {
    try { localStorage.setItem(SLEUTEL, adres || ''); return true; }
    catch { return false; }
}

/** Een waarde leesbaar opschrijven, zonder er een JSON-brij van te maken. */
function waarde(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'ja' : 'nee';
    if (typeof v === 'object') return v.englishLabel || v.label || v.naam || '(object)';
    return String(v);
}

/**
 * Het rapport als platte tekst.
 *
 * ALLEEN WAT ERTOE DOET, en niets daarbuiten. Hier staat geen logo, geen
 * bedrijfsnaam en geen opdrachtnummer in: dat helpt niet bij een storing en
 * het hoort niet ongevraagd in een bericht aan een derde. Wat er wel in staat
 * zijn maten, keuzes en meldingen.
 *
 * @param gegevens.waarom     wat de gebruiker zelf zegt dat er misging
 * @param gegevens.maten      huidigeMaten() - de ingevulde velden
 * @param gegevens.profielen  { staander, handregel, spijl, boom }
 * @param gegevens.keuzes     { sierpunt, spijlSierpunt, ... }
 * @param gegevens.status     de statusregel onderin
 * @param gegevens.melding    de foutmelding uit het paneel, of leeg
 * @param gegevens.fouten     wat er in de console is langsgekomen
 */
export function maakRapport(gegevens = {}) {
    const r = [];
    const nu = new Date();
    r.push('HULPVRAAG — balustradeconfigurator');
    r.push(`Datum: ${nu.toLocaleString('nl-NL')}`);
    r.push('');

    r.push('WAT GING ER MIS');
    r.push(gegevens.waarom ? gegevens.waarom : '(niet ingevuld)');
    r.push('');

    if (gegevens.melding) {
        r.push('MELDING IN HET PANEEL');
        r.push(gegevens.melding);
        r.push('');
    }
    if (gegevens.status) {
        r.push('STATUSREGEL');
        r.push(gegevens.status);
        r.push('');
    }

    const maten = gegevens.maten || {};
    r.push('MATEN');
    for (const [naam, v] of Object.entries(maten)) {
        // De profielen staan hieronder apart; hier zouden ze een onleesbare
        // brok worden.
        if (/Profiel$/.test(naam)) continue;
        r.push(`  ${naam.padEnd(22)} ${waarde(v)}`);
    }
    r.push('');

    r.push('PROFIELEN');
    for (const [onderdeel, p] of Object.entries(gegevens.profielen || {})) {
        r.push(`  ${onderdeel.padEnd(22)} ${p ? (p.englishLabel || p.bestand)
            : '— geen (massief blok)'}`);
    }
    r.push('');

    const keuzes = gegevens.keuzes || {};
    if (Object.keys(keuzes).length) {
        r.push('KEUZES');
        for (const [naam, v] of Object.entries(keuzes)) {
            r.push(`  ${naam.padEnd(22)} ${waarde(v)}`);
        }
        r.push('');
    }

    const fouten = gegevens.fouten || [];
    if (fouten.length) {
        r.push('FOUTEN IN DE CONSOLE');
        // De laatste vijf: een lange lijst maakt het rapport onleesbaar en de
        // oudste zeggen zelden iets over wat er nu misgaat.
        for (const f of fouten.slice(-5)) r.push('  ' + f);
        r.push('');
    }

    r.push('BROWSER');
    r.push('  ' + (typeof navigator !== 'undefined' ? navigator.userAgent : '—'));
    if (typeof window !== 'undefined' && window.screen) {
        r.push(`  scherm ${window.screen.width} x ${window.screen.height}`);
    }
    return r.join('\n');
}

// Hoe lang een mailto-adres mag worden voordat mailprogramma's gaan afkappen.
//
// DIT IS GEEN NORM MAAR EEN VEILIGE ONDERGRENS. Browsers en mailprogramma's
// verschillen sterk; sommige slikken tienduizenden tekens, oude Outlook-versies
// kappen rond de tweeduizend af. Afkappen is hier het ergste wat er kan
// gebeuren - dan mist precies de melding waar het om ging - dus bij een lang
// rapport wordt er een korte mail gemaakt met het verzoek het volledige
// rapport erbij te plakken.
const MAILTO_GRENS = 1800;

/**
 * Het `mailto:`-adres voor deze hulpvraag.
 *
 * @returns {{ url, afgekapt }} - `afgekapt` zegt of het rapport te lang was
 *          voor in de mail; dan hoort het scherm te vragen het erbij te
 *          plakken in plaats van stil de helft weg te laten.
 */
export function maakMailto(adres, waarom, rapport) {
    const onderwerp = 'Hulpvraag balustradeconfigurator'
        + (waarom ? ' — ' + waarom.slice(0, 60) : '');
    const kort = 'Hieronder staat wat de app van de situatie weet.\n\n'
        + '(Lukt het niet om dit mee te sturen, plak dan het volledige '
        + 'rapport uit het hulpvenster erbij.)\n\n';
    const vol = kort + rapport;
    const afgekapt = vol.length > MAILTO_GRENS;
    const inhoud = afgekapt
        ? kort + rapport.slice(0, MAILTO_GRENS)
            + '\n\n[... afgekapt — plak het volledige rapport erbij]'
        : vol;
    return {
        url: `mailto:${encodeURIComponent(adres || '')}`
            + `?subject=${encodeURIComponent(onderwerp)}`
            + `&body=${encodeURIComponent(inhoud)}`,
        afgekapt,
    };
}
