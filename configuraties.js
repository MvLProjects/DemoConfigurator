// Bewaarde profielconfiguraties: "zo maken wij onze standaard balustrade".
//
// Een configuratie is de combinatie die je telkens opnieuw zou moeten
// aanklikken: welk profiel voor de staander, de handregel en de spijl, waar de
// treden van zijn, en in welke kleur het gecoat wordt. Vijf keuzes die bij een
// werkplaats meestal vastliggen.
//
// WAAROM DIT WEL IN DE BROWSER WORDT BEWAARD, en de instellingen niet.
//
// Bij de instellingen staat uitgelegd waarom die naar een BESTAND gaan: een
// bestand kun je meesturen, bij een project in een map zetten of aan een
// collega geven. Dat geldt voor een ORDER.
//
// Een configuratie is iets anders. Het is geen order maar een gewoonte, en de
// opdracht vraagt letterlijk dat je hem "later opnieuw kunt selecteren". Dan
// moet hij er zijn zodra je de app opent, zonder dat je eerst een bestand gaat
// zoeken. Daarom hier wel browseropslag.
//
// Wat je daarvoor inlevert staat er eerlijk bij: wat in je browser zit is
// alleen van jou en verdwijnt als je je cache leegt. Wie een configuratie met
// een collega wil delen, slaat een ontwerp op als instellingenbestand - daar
// zitten dezelfde keuzes in.

const SLEUTEL = 'railing-configurator/profielconfiguraties/1';

/**
 * Alles lezen wat er bewaard is.
 *
 * Browseropslag kan ontbreken of weigeren: in een privévenster, met cookies
 * uit, of in een iframe met beperkingen. Dan is het antwoord een lege lijst en
 * werkt de rest van de app gewoon door. Een configuratie is gemak, geen
 * voorwaarde.
 */
export function lees() {
    try {
        const ruw = localStorage.getItem(SLEUTEL);
        if (!ruw) return {};
        const uit = JSON.parse(ruw);
        return (uit && typeof uit === 'object' && !Array.isArray(uit)) ? uit : {};
    } catch {
        return {};
    }
}

/** De namen, op alfabet, voor een keuzelijst. */
export function namen() {
    return Object.keys(lees()).sort((a, b) => a.localeCompare(b, 'nl'));
}

function schrijf(alles) {
    try {
        localStorage.setItem(SLEUTEL, JSON.stringify(alles));
        return true;
    } catch {
        return false;
    }
}

/**
 * Wat er van een profielverwijzing bewaard wordt.
 *
 * NIET het hele ding. Een verwijzing uit de kiezer draagt ook functies mee
 * (`doorsnede()`, `staaf()`) en die overleven JSON niet. Hier staat precies
 * wat de rest van de app nodig heeft om het profiel weer te gebruiken.
 *
 * `bestand` is het pad binnen de catalogus en is de echte sleutel; de `url`
 * wordt bij het terughalen opnieuw gemaakt, met het exportmoment van de
 * catalogus die er dán ligt. Een configuratie van vorige maand wijst zo
 * vanzelf naar de nieuwe levering.
 */
export function uitProfiel(ref) {
    if (!ref) return null;
    return {
        bestand: ref.bestand,
        table: ref.table,
        tableId: ref.tableId,
        items: ref.items,
        englishLabel: ref.englishLabel,
        standardLabel: ref.standardLabel,
        vorm: ref.vorm,
        categorie: ref.categorie,
        boxSize: ref.boxSize,
        catalogus: ref.catalogus,
    };
}

/** Een bewaard profiel weer bruikbaar maken: de url erbij, met de juiste versie. */
export function naarProfiel(bewaard, basis, versie) {
    if (!bewaard || !bewaard.bestand) return null;
    return {
        ...bewaard,
        url: basis + bewaard.bestand
            + (versie ? `?v=${encodeURIComponent(versie)}` : ''),
    };
}

/**
 * Een configuratie bewaren onder een naam. Dezelfde naam overschrijft.
 *
 * @returns {boolean} of het gelukt is; false als de browser niets wil bewaren.
 */
export function bewaar(naam, configuratie) {
    const schoon = String(naam || '').trim();
    if (!schoon) return false;
    const alles = lees();
    alles[schoon] = { ...configuratie, bewaard: new Date().toISOString() };
    return schrijf(alles);
}

export function verwijder(naam) {
    const alles = lees();
    if (!(naam in alles)) return false;
    delete alles[naam];
    return schrijf(alles);
}

/** Eén configuratie ophalen, of null. */
export function haal(naam) {
    return lees()[naam] || null;
}
