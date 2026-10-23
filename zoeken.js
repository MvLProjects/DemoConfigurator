// Zoeken in het paneel: waar staat dat ene veld ook alweer?
//
// WAAROM. De app heeft zeven tabbladen, een stuk of twintig invulvelden, een
// handvol vinkjes, knoppen in drie groepen en een profielcatalogus van 2337
// regels. "Waar is de zaaglijst", "waar kan ik glas vinden", "waar is
// automatisch corrigeren" - dat zijn echte vragen geweest, en elke keer was het
// antwoord: het staat er wel, maar drie tabbladen verderop.
//
// DE INDEX WORDT UIT HET PANEEL ZELF GELEZEN, bij elke zoekopdracht opnieuw.
// Er is dus GEEN tweede lijst met veldnamen die bijgehouden moet worden. Dat is
// dezelfde keuze als bij de tabbalk, en om dezelfde reden: twee lijsten die
// allebei de namen kennen lopen vroeg of laat uit de pas. Zet iemand er morgen
// een veld bij, dan is het meteen te vinden zonder dat hij dit bestand kent.
//
// WAT ER MEEGEZOCHT WORDT: het label, de uitleg eronder, de keuzes in een
// keuzelijst, en de id van het veld. Juist die uitleg maakt het verschil - daar
// staan de woorden in die iemand intypt. Wie "beklimbaar" zoekt komt bij de
// vulling uit, en wie "gelaagd" zoekt ook, zonder dat er ergens een lijst met
// synoniemen ligt die kan verouderen.

/**
 * Tekst klaarmaken om te vergelijken: kleine letters, zonder accenten.
 *
 * Zonder dat vindt "doorgang" de "vrije doorgang" wel, maar "prive" niet
 * "privé" en "Glas" niet "glas".
 */
export function normaliseer(tekst) {
    return String(tekst ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** De naam van het tabblad waar dit element in staat. */
function groepVan(el) {
    const groep = el.closest('details.groep');
    const kop = groep && groep.querySelector('summary');
    return kop ? kop.textContent.trim() : '';
}

/**
 * De uitleg die bij een veld hoort: de eerstvolgende hint eronder.
 *
 * HIJ MAG NIET OVER EEN ANDER VELD HEEN KIJKEN, en dat ging eerst mis. De
 * zoeker mocht één element overslaan, zogenaamd voor twee velden op één rij.
 * Daardoor pikte "hoogte" de uitleg van "vulling" op - die twee staan direct
 * onder elkaar - en stond bij het zoeken op "glas" of "gelaagd" ineens
 * "hoogte" bovenaan, omdat beide 20 punten kregen en "hoogte" het kortere
 * label heeft. Een uitleg hoort bij het veld er direct boven, punt.
 *
 * Een LEGE hint wordt wel overgeslagen: `#vullingLet` staat er altijd en is
 * leeg tot er iets te melden valt. Die mag de echte uitleg niet afschermen.
 */
function uitlegBij(rij) {
    let n = rij.nextElementSibling;
    for (let i = 0; n && i < 3; i++, n = n.nextElementSibling) {
        if (!n.classList || !n.classList.contains('hint')) break;
        const tekst = n.textContent.trim();
        if (tekst) return tekst;
    }
    return '';
}

/**
 * Bouwt de index uit het paneel.
 *
 * @param wortel  meestal document; apart meegegeven zodat de zelftest hem in
 *                het iframe kan aanroepen.
 * @returns [{ soort, titel, tekst, groep, element, focus }]
 */
export function maakIndex(wortel = document) {
    const uit = [];
    const paneel = wortel.getElementById('panel');
    if (!paneel) return uit;

    // 1. de invulvelden, vinkjes en keuzelijsten
    for (const rij of paneel.querySelectorAll('.veld')) {
        const label = rij.querySelector('label');
        const bediening = rij.querySelector('input, select, textarea');
        if (!label || !bediening) continue;
        // De keuzes uit een keuzelijst tellen mee: wie "horizontale regels"
        // zoekt hoort bij het veld "vulling" uit te komen.
        const keuzes = [...rij.querySelectorAll('option')]
            .map(o => o.textContent).join(' ');
        uit.push({
            soort: 'veld',
            titel: label.textContent.trim(),
            tekst: [uitlegBij(rij), keuzes, bediening.id].join(' '),
            groep: groepVan(rij),
            element: rij,
            focus: bediening,
        });
    }

    // 2. de knoppen
    for (const knop of paneel.querySelectorAll('button')) {
        const naam = knop.textContent.trim();
        // Knopjes zonder woorden (het kruisje bij een profiel) zijn niet te
        // zoeken en zouden alleen ruis geven.
        if (!naam || naam.length < 3) continue;
        uit.push({
            soort: 'knop', titel: naam,
            tekst: [uitlegBij(knop), knop.id].join(' '),
            groep: groepVan(knop), element: knop, focus: knop,
        });
    }

    // 3. de kopjes binnen een tabblad - Stuklijst, Zaaglijst, Samenstelling
    for (const kop of paneel.querySelectorAll('h3, h4')) {
        const naam = kop.textContent.trim();
        if (!naam) continue;
        uit.push({
            soort: 'onderdeel', titel: naam,
            tekst: uitlegBij(kop.parentElement) || '',
            groep: groepVan(kop), element: kop, focus: null,
        });
    }

    // 4. de tabbladen zelf
    for (const groep of paneel.querySelectorAll('details.groep')) {
        const kop = groep.querySelector('summary');
        if (!kop) continue;
        uit.push({
            soort: 'tabblad', titel: kop.textContent.trim(), tekst: '',
            groep: kop.textContent.trim(), element: groep, focus: null,
        });
    }

    return uit;
}

/**
 * Zoekt in de index. Geeft de beste treffers eerst.
 *
 * DE VOLGORDE IS DE HELE TRUC. Zoek je "glas", dan hoort het veld dat zo heet
 * boven een uitleg te staan waarin het woord toevallig voorkomt. Daarom:
 *
 *   100  de titel is precies wat je zocht
 *    70  de titel begint ermee
 *    50  de titel bevat het
 *    20  de uitleg bevat het
 *
 * Met meerdere woorden tellen de punten per woord op, en een regel die niet
 * alle woorden heeft valt af - anders geeft "max doorgang" alles terug waar
 * "max" in staat.
 */
export function zoek(index, term, maximaal = 8) {
    const woorden = normaliseer(term).split(' ').filter(Boolean);
    if (woorden.length === 0) return [];

    const uit = [];
    for (const regel of index) {
        const titel = normaliseer(regel.titel);
        const tekst = normaliseer(regel.tekst + ' ' + regel.groep);
        let punten = 0;
        let alles = true;
        for (const w of woorden) {
            if (titel === w) punten += 100;
            else if (titel.startsWith(w)) punten += 70;
            else if (titel.includes(w)) punten += 50;
            else if (tekst.includes(w)) punten += 20;
            else { alles = false; break; }
        }
        if (alles && punten > 0) uit.push({ ...regel, punten });
    }

    // Bij gelijke punten het kortste label eerst: "vulling" boven
    // "vulraamwerk" als je "vul" typt.
    uit.sort((a, b) => b.punten - a.punten || a.titel.length - b.titel.length);
    return uit.slice(0, maximaal);
}
