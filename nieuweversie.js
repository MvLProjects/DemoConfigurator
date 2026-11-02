// Staat er een nieuwere versie van de app online dan die in de browser?
//
// GitHub Pages stuurt Cache-Control: max-age=600. Na een update krijgt wie de
// app binnen tien minuten opnieuw opent dus nog (een deel van) de oude
// bestanden - en een half oude, half nieuwe set modules geeft fouten die niet
// te verklaren zijn. Ctrl+Shift+R helpt, maar dat weet niemand.
//
// Daarom: van elk eigen bestand dat geladen is de vingerafdruk (ETag, anders
// Last-Modified) uit de browsercache naast die van de server leggen. Is er
// één anders, dan die bestanden opnieuw ophalen (cache: 'reload' schrijft de
// cache bij) en de gebruiker een knop geven om te herladen. Niet vanzelf
// herladen: dan verdwijnt wat hij aan het doen was.

/** De vingerafdruk van een antwoord, of '' als de server er geen geeft. */
export const vingerafdruk = (headers) => headers.get('ETag') || headers.get('Last-Modified') || '';

/** De eigen bestanden die deze pagina geladen heeft (modules, stijl, de pagina). */
export function eigenBestanden(win = window) {
    const eigen = new Set([win.location.origin + win.location.pathname]);
    for (const e of win.performance.getEntriesByType('resource')) {
        const u = new URL(e.name);
        if (u.origin === win.location.origin && /\.(?:js|css|json|html)$/.test(u.pathname) && !u.search) {
            eigen.add(u.origin + u.pathname);
        }
    }
    return [...eigen];
}

/**
 * Welke bestanden zijn op de server anders dan in de cache? Een bestand
 * zonder vingerafdruk (aan een van beide kanten) telt niet: dan weten we het
 * niet, en een melding die altijd komt is erger dan geen.
 */
export async function veranderdeBestanden(urls, haal = fetch) {
    const uit = [];
    await Promise.all(urls.map(async (url) => {
        try {
            const [oud, nieuw] = await Promise.all([
                haal(url, { cache: 'force-cache' }),
                haal(url, { method: 'HEAD', cache: 'no-store' }),
            ]);
            const a = vingerafdruk(oud.headers), b = vingerafdruk(nieuw.headers);
            if (oud.ok && nieuw.ok && a && b && a !== b) uit.push(url);
        } catch { /* offline of geweigerd: niets te melden */ }
    }));
    return uit;
}

/**
 * Eén keer kijken, en bij een nieuwe versie de cache bijwerken en de knop
 * tonen. Geeft de veranderde bestanden terug (voor de zelftest).
 */
export async function kijkOfErEenNieuweVersieIs({ win = window, haal = fetch, toon } = {}) {
    const veranderd = await veranderdeBestanden(eigenBestanden(win), haal);
    if (!veranderd.length) return veranderd;
    // Allemaal opnieuw, niet alleen de veranderde: een module die nu nog
    // gelijk is kan net zijn gewijzigd terwijl we keken.
    await Promise.all(eigenBestanden(win).map(u => haal(u, { cache: 'reload' }).catch(() => null)));
    if (toon) toon();
    return veranderd;
}
