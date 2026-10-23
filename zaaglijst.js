// De zaaglijst: hoe de stukken uit ingekochte stangen gezaagd worden.
//
// WAAROM. De stuklijst zegt WAT je nodig hebt - 2× 785 mm, 14× 690 mm - maar
// niet HOE je dat uit staal haalt. Een werkplaats koopt geen stuk van 785 mm,
// die koopt een stang en zaagt hem op. De vragen die dan overblijven zijn:
// hoeveel stangen moet ik bestellen, wat ligt er in welke stang, en hoeveel
// blijft er over. Dat is de laatste stap voordat het productiepakket compleet
// is.
//
// WAT HIER WEL EN NIET BESLIST WORDT. Welke onderdelen hier thuishoren wordt
// NIET hier bepaald. `dxf.js` beslist al wat een plaatdeel is, en de kop van dat
// bestand zegt het zelf: een profiel wordt gezaagd, niet gesneden. Deze module
// is dus precies de tegenhanger van `maakDxf`. Daardoor is er één plek waar dat
// onderscheid staat, en geldt er een harde regel die de zelftest kan nameten:
// elk onderdeel zit in precies één van de twee lijsten - nooit in beide, nooit
// in geen van beide.
//
// HET IS GEEN OPTIMAAL SNIJPLAN, en het wordt hier ook niet zo genoemd. De
// beste indeling uitrekenen is een probleem waarvoor geen snelle oplossing
// bestaat. Wat hier staat is "first fit decreasing": stukken van lang naar kort,
// elk in de eerste stang waar hij nog bij past. Van die aanpak is bekend dat hij
// nooit meer dan 11/9 × het minimum + 6/9 stangen gebruikt. In de praktijk zit
// hij er bij een handvol lengtes meestal precies op, maar dat is geen belofte.
//
// DE TWEE GETALLEN WAARMEE GEREKEND WORDT - de stanglengte en de dikte van een
// zaagsnede - zijn AANNAMES en staan in `regels.json`, niet hier. Zie daar waar
// ze vandaan komen en waarom ze geen gemeten waarden zijn.

import { beschrijf, zaaghoekTekst } from './onderdelen.js';
import { plaatVorm } from './dxf.js';
import { ZAAG } from './balustrade-rules.js';
import { isGlas, materiaalVanDeel } from './materialen.js';

/**
 * Wordt dit onderdeel OP MAAT BESTELD in plaats van hier gemaakt?
 *
 * Een glazen ruit wordt niet gezaagd uit een stang en niet gesneden op de
 * snijtafel - die bestel je bij de glashandel op de maat die uit de tekening
 * komt. Zonder dit zou de app een ruit op een stalen stang gaan inplannen en
 * zijn oppervlak in de staalkilo's meetellen.
 */
export function wordtBesteld(deel) {
    // GLAS, en alles wat zichzelf als gekocht beslag aanmeldt. Dat laatste is
    // een vlaggetje op het onderdeel en geen lijst met soorten hier: wie een
    // nieuw beslagdeel toevoegt zet het daar neer, en hoeft dit bestand niet
    // te kennen. Een glasklem is het eerste; bouten zouden het volgende zijn.
    return deel.besteld === true || isGlas(materiaalVanDeel(deel));
}

/**
 * Wordt dit onderdeel uit een stang gezaagd?
 *
 * De tegenhanger van `maakDxf`: alles wat geen plaatdeel is. Bewust zo
 * geschreven en niet met een eigen vuistregel over lengte tegenover doorsnede -
 * zo'n regel zou een tweede, afwijkende mening worden over wat een plaat is.
 *
 * MET ÉÉN UITZONDERING ERVOOR: wat besteld wordt, wordt hier niet gemaakt.
 * Daarmee zijn het er drie in plaats van twee - gezaagd, gesneden, besteld - en
 * elk onderdeel valt in precies één ervan.
 */
export function wordtGezaagd(deel) {
    return !wordtBesteld(deel) && plaatVorm(deel) === null;
}

/**
 * Waarop twee stukken in dezelfde stang mogen liggen.
 *
 * Bij een profiel uit de catalogus is dat het BESTAND. Niet het label: twee
 * regels in het manifest kunnen hetzelfde heten, en het bestand is wat de
 * doorsnede vastlegt.
 *
 * MATERIAAL IS GEEN SCHEIDING. Hetzelfde profiel staat in het manifest vaak in
 * twee staalsoorten (de eerste regel al: S235JRH en X5CrNi18-10), maar de app
 * laat je er geen één van kiezen - `beschrijf` zet ze allebei in de
 * materiaalkolom. Op staalsoort groeperen zou dus twee groepen maken waar de
 * gebruiker één keuze heeft gemaakt.
 *
 * AFWERKING IS OOK GEEN SCHEIDING: poedercoaten gebeurt ná het zagen, dus twee
 * stukken met een andere RAL-kleur komen prima uit dezelfde stang.
 *
 * Zonder profiel valt het terug op de doorsnede zoals `beschrijf` die noemt -
 * de twee kleinste maten. Dat is hetzelfde getal dat in de stuklijst staat.
 */
export function stangSleutel(deel) {
    if (deel.profiel && deel.profiel.bestand) return 'p:' + deel.profiel.bestand;
    return 'd:' + beschrijf(deel).profiel;
}

/** Het gewicht per meter uit de catalogus, of null als het er niet staat. */
function gewichtPerMeter(deel) {
    const g = deel.profiel && deel.profiel.catalogus
        ? deel.profiel.catalogus.GEW : 0;
    return g > 0 ? g : null;
}

const rond = (v) => Math.round(v * 100) / 100;

/**
 * Maakt de zaaglijst uit de lijst unieke productieonderdelen.
 *
 * @param unieken  wat `groepeerVormen` teruggeeft: [{ deel, aantal, nummer,
 *                 zaaghoeken }]
 * @param zaag     { stanglengte, snede } - standaard uit regels.json
 *
 * @returns {{
 *   stanglengte: number, snede: number,
 *   groepen: Array, teLang: Array, platen: Array, besteld: Array,
 *   aantalStangen: number, aantalStukken: number,
 *   netLengte: number, zaagverlies: number, restLengte: number,
 *   afvalDeel: number, gewicht: number|null, gewichtBesteld: number|null
 * }}
 */
export function maakZaaglijst(unieken, zaag = ZAAG) {
    const stanglengte = Number(zaag && zaag.stanglengte) || 0;
    const snede = Math.max(0, Number(zaag && zaag.snede) || 0);
    if (!(stanglengte > 0)) {
        throw new Error('zaaglijst: stanglengte moet groter dan nul zijn');
    }

    // --- 1. de stukken, en wat hier niet thuishoort ------------------------
    const platen = [];
    const besteld = [];
    const perGroep = new Map();

    for (const u of unieken || []) {
        const b = beschrijf(u.deel);
        // Op maat besteld: niet zagen, niet snijden, wel vermelden. Anders
        // verdwijnt een ruit uit het pakket zonder dat iemand het merkt.
        if (wordtBesteld(u.deel)) {
            besteld.push({
                positie: String(u.nummer).padStart(3, '0'),
                aantal: u.aantal, soort: b.soort, materiaal: b.materiaal,
                maat: `${rond(u.deel.dx)} × ${rond(u.deel.dz)} × `
                    + `${rond(u.deel.dy)} mm`,
            });
            continue;
        }
        if (!wordtGezaagd(u.deel)) {
            platen.push({
                positie: String(u.nummer).padStart(3, '0'),
                aantal: u.aantal, soort: b.soort, profiel: b.profiel,
            });
            continue;
        }

        const sleutel = stangSleutel(u.deel);
        if (!perGroep.has(sleutel)) {
            perGroep.set(sleutel, {
                sleutel, profiel: b.profiel, norm: b.norm,
                materiaal: b.materiaal,
                gewichtPerMeter: gewichtPerMeter(u.deel),
                stukken: [],
            });
        }
        // Eén regel per EXEMPLAAR: 14 spijlen zijn 14 stukken in de stang. Het
        // positienummer blijft eraan hangen, zodat in de stang te zien is welk
        // onderdeel waar ligt.
        const groep = perGroep.get(sleutel);
        for (let i = 0; i < u.aantal; i++) {
            groep.stukken.push({
                positie: String(u.nummer).padStart(3, '0'),
                lengte: b.lengte,
                hoeken: zaaghoekTekst(u.zaaghoeken),
            });
        }
    }

    // --- 2. per groep inpakken --------------------------------------------
    const groepen = [];
    const teLang = [];

    for (const groep of perGroep.values()) {
        // Lang naar kort. Bij gelijke lengte op positienummer, zodat dezelfde
        // invoer altijd dezelfde uitvoer geeft - anders is er in een test niets
        // vast te leggen.
        const stukken = groep.stukken.slice().sort((a, b) =>
            b.lengte - a.lengte || a.positie.localeCompare(b.positie));

        const stangen = [];
        const past = (stang, lengte) =>
            // ÉÉN ZAAGSNEDE PER TUSSENRUIMTE, niet per stuk. Zie de uitleg bij
            // `zaagverlies` hieronder: een stang heeft al een recht einde, dus
            // het eerste stuk kost geen snede.
            stang.net + lengte + stang.stukken.length * snede <= stanglengte;

        for (const stuk of stukken) {
            if (stuk.lengte > stanglengte) {
                // NIET STIL WEGLATEN. Een handregel van 6,5 m uit stangen van
                // 6 m kan niet, en dat is een echt antwoord: er moet een las in
                // of een langere stang besteld worden.
                teLang.push({ positie: stuk.positie, lengte: stuk.lengte,
                              profiel: groep.profiel });
                continue;
            }
            let stang = stangen.find((s) => past(s, stuk.lengte));
            if (!stang) { stang = { stukken: [], net: 0 }; stangen.push(stang); }
            stang.stukken.push(stuk);
            stang.net += stuk.lengte;
        }

        // EERST AFRONDEN, DAN DE REST ERUIT HALEN. Omgekeerd klopt de optelsom
        // niet meer: rond je `net` en `rest` los van elkaar af, dan komt
        // net + zaagverlies + rest op 6000,01 uit in plaats van op 6000, en dan
        // is er in de zelftest niets hards meer vast te leggen.
        for (const s of stangen) {
            s.net = rond(s.net);
            s.zaagverlies = rond(Math.max(0, s.stukken.length - 1) * snede);
            s.gebruikt = rond(s.net + s.zaagverlies);
            s.rest = rond(stanglengte - s.gebruikt);
        }

        const aantalStukken = stangen.reduce((n, s) => n + s.stukken.length, 0);
        const netLengte = stangen.reduce((n, s) => n + s.net, 0);
        const zaagverlies = stangen.reduce((n, s) => n + s.zaagverlies, 0);
        const restLengte = stangen.reduce((n, s) => n + s.rest, 0);
        const ingekocht = stangen.length * stanglengte;
        const gpm = groep.gewichtPerMeter;

        groepen.push({
            sleutel: groep.sleutel, profiel: groep.profiel, norm: groep.norm,
            materiaal: groep.materiaal, gewichtPerMeter: gpm,
            stangen,
            aantalStangen: stangen.length,
            aantalStukken,
            netLengte: rond(netLengte),
            zaagverlies: rond(zaagverlies),
            restLengte: rond(restLengte),
            ingekocht,
            afvalDeel: ingekocht > 0 ? (zaagverlies + restLengte) / ingekocht : 0,
            gewicht: gpm === null ? null : rond(netLengte / 1000 * gpm),
            gewichtBesteld: gpm === null ? null : rond(ingekocht / 1000 * gpm),
        });
    }

    // Grootste eerst: dat is waar het geld zit en waar winst te halen is.
    groepen.sort((a, b) => b.aantalStangen - a.aantalStangen
        || a.profiel.localeCompare(b.profiel));

    // --- 3. de totalen ----------------------------------------------------
    const tel = (veld) => groepen.reduce((n, g) => n + g[veld], 0);
    const aantalStangen = tel('aantalStangen');
    const ingekocht = aantalStangen * stanglengte;
    const zaagverlies = rond(tel('zaagverlies'));
    const restLengte = rond(tel('restLengte'));
    const metGewicht = groepen.filter((g) => g.gewicht !== null);

    return {
        stanglengte, snede,
        groepen, teLang, platen, besteld,
        aantalStangen,
        aantalStukken: tel('aantalStukken'),
        netLengte: rond(tel('netLengte')),
        zaagverlies,
        restLengte,
        ingekocht,
        afvalDeel: ingekocht > 0 ? (zaagverlies + restLengte) / ingekocht : 0,
        // Alleen optellen wat een gewicht HEEFT. Een blok zonder catalogusprofiel
        // heeft er geen, en dan is "het totaalgewicht" een halve waarheid; dat
        // zegt `gewichtVolledig` erbij.
        gewicht: metGewicht.length ? rond(metGewicht.reduce((n, g) => n + g.gewicht, 0)) : null,
        gewichtBesteld: metGewicht.length
            ? rond(metGewicht.reduce((n, g) => n + g.gewichtBesteld, 0)) : null,
        gewichtVolledig: metGewicht.length === groepen.length,
    };
}

/**
 * De zaaglijst als CSV: één regel per stang.
 *
 * Puntkomma als scheidingsteken en een komma als decimaalteken, zoals de andere
 * uitvoer van de app - dat is wat Excel in het Nederlands verwacht.
 */
export function zaaglijstAlsCsv(lijst) {
    const komma = (v) => String(v).replace('.', ',');
    const regels = [['profiel', 'norm', 'stang', 'stuk', 'positie',
                     'lengte', 'zaaghoeken', 'rest in stang'].join(';')];

    for (const g of lijst.groepen) {
        g.stangen.forEach((s, i) => {
            s.stukken.forEach((stuk, k) => {
                regels.push([
                    g.profiel, g.norm, i + 1, k + 1, stuk.positie,
                    komma(stuk.lengte), stuk.hoeken, komma(s.rest),
                ].join(';'));
            });
        });
    }

    for (const t of lijst.teLang) {
        regels.push([t.profiel, '', 'PAST NIET', '', t.positie,
                     komma(t.lengte), '', ''].join(';'));
    }

    regels.push('');
    regels.push(`gerekend met stanglengte;${komma(lijst.stanglengte)};mm`);
    regels.push(`gerekend met zaagsnede;${komma(lijst.snede)};mm`);
    regels.push(`stangen;${lijst.aantalStangen}`);
    regels.push(`netto staal;${komma(lijst.netLengte)};mm`);
    regels.push(`zaagverlies;${komma(lijst.zaagverlies)};mm`);
    regels.push(`rest;${komma(lijst.restLengte)};mm`);
    regels.push(`afval;${komma(rond(lijst.afvalDeel * 100))};%`);
    return regels.join('\n');
}
