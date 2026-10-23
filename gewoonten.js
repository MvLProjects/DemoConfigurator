// Wat deze gebruiker het meest kiest: de app kijkt het af in plaats van het te
// vragen.
//
// HET VERSCHIL MET EEN CONFIGURATIE, en daarom is dit een apart bestand.
//
// Een configuratie (zie configuraties.js) is een keuze die je zelf een naam
// geeft en bewust opslaat: "zo maken wij onze standaard balustrade". Een
// GEWOONTE is iets wat de app van je afkijkt zonder dat je er iets voor doet.
// Wie veertig keer CHS 48,3x3,2 kiest en één keer iets anders, hoort dat eerste
// bovenaan te zien staan zonder het ooit te hebben opgeschreven.
//
// WAT ER BEWAARD WORDT IS EEN TELLING, GEEN GESCHIEDENIS. Per keuze staat er
// hoe vaak je hem gebruikte en wanneer voor het laatst. Dat is compact, het
// blijft leesbaar, en het zegt precies wat er nodig is. Een lijst van alles wat
// je ooit deed zou groeien tot de browseropslag vol is en daarna stilletjes
// stoppen met werken.
//
// ER WORDT PAS GETELD ALS ER ECHT GEBOUWD WORDT. Niet bij elke toetsaanslag:
// typ je 1100, dan komt het veld onderweg langs 1, 11 en 110, en die zijn geen
// van drieën een gewoonte. Het bouwen is het moment waarop je het meende.
//
// WAT JE ERVOOR INLEVERT, net als bij de configuraties: dit staat in de
// browseropslag van deze computer. Het is alleen van jou en het verdwijnt als
// je je cache leegt. Wie zijn keuzes met een collega wil delen, gebruikt een
// instellingenbestand of een configuratie - die bestaan daarvoor.

import { uitProfiel } from './configuraties.js';
import { STANDAARD } from './balustrade-rules.js';

// De zelftest leest en herstelt hiermee de opslag, zodat hij de gewoonten van
// een echte gebruiker niet wist. Daarom staat hij naar buiten toe open.
export const SLEUTEL = 'railing-configurator/gewoonten/1';

// VELDEN DIE GEEN GEWOONTE ZIJN maar bij één order horen.
//
// De lengte van een balustrade verschilt per opdracht; die honderd keer tellen
// levert honderd tellers van één op en zegt niets. De hoogte is wél een
// gewoonte - 1000 of 1100 - en net zo goed de spijlbreedte, de doorgang en het
// overstek. Het verschil is of je het per klus bepaalt of één keer voor je hele
// werkplaats.
const NIET_TELLEN = ['lengte', 'hoogteverschil', 'verschuiving'];

// Hoeveel verschillende waarden er per groep bewaard blijven. Met een grens
// groeit dit nooit onbeperkt; zonder zou één gebruiker met tweehonderd orders
// de opslag vullen en zou het bewaren daarna stilletjes mislukken.
const MAX_PER_GROEP = 12;

/**
 * Alles lezen wat er geteld is.
 *
 * Browseropslag kan ontbreken of weigeren: in een privévenster, met cookies uit,
 * of in een iframe met beperkingen. Dan is het antwoord leeg en werkt de rest
 * van de app gewoon door. Gewoonten zijn gemak, geen voorwaarde.
 */
export function lees() {
    try {
        const ruw = localStorage.getItem(SLEUTEL);
        if (!ruw) return leeg();
        const uit = JSON.parse(ruw);
        if (!uit || typeof uit !== 'object' || Array.isArray(uit)) return leeg();
        // Ontbrekende takken aanvullen: een opslag van een oudere versie mag
        // geen fout geven maar moet gewoon aanvullen wat hij kent.
        return { ...leeg(), ...uit,
            profiel: { ...leeg().profiel, ...(uit.profiel || {}) },
            punt: { ...leeg().punt, ...(uit.punt || {}) },
            hoek: uit.hoek || {},
            veld: uit.veld || {} };
    } catch {
        return leeg();
    }
}

function leeg() {
    return {
        versie: 1,
        profiel: { staander: {}, handregel: {}, spijl: {}, boom: {} },
        punt: { paal: {}, spijl: {} },
        hoek: {},
        veld: {},
    };
}

function schrijf(alles) {
    try {
        localStorage.setItem(SLEUTEL, JSON.stringify(alles));
        return true;
    } catch {
        // Vol, geweigerd of uitgezet. Niet klagen: de app moet hier niet van
        // afhangen.
        return false;
    }
}

/** Alles vergeten. Voor een knop "begin opnieuw" en voor de zelftest. */
export function vergeet() {
    try {
        localStorage.removeItem(SLEUTEL);
        return true;
    } catch {
        return false;
    }
}

/**
 * Eén keuze meetellen in een groepje.
 *
 * `extra` is wat er nodig is om de keuze later weer toe te passen - bij een
 * profiel het bewaarde profiel, bij een sierpunt niets. Het wordt bij elke
 * telling ververst, zodat een bewaard profiel meegaat met de catalogus die er
 * nu ligt.
 */
function tel(groepje, sleutel, nu, extra) {
    if (sleutel === null || sleutel === undefined || sleutel === '') return;
    const was = groepje[sleutel] || { aantal: 0 };
    groepje[sleutel] = { ...was, ...extra, aantal: was.aantal + 1, laatst: nu };
    snoei(groepje);
}

/**
 * Terug naar MAX_PER_GROEP: de minst gebruikte eruit, bij gelijk spel de oudste.
 *
 * Niet de oudste zonder meer. Een keuze die je vijftig keer maakte en een maand
 * niet, is nog steeds je gewoonte; een keuze die je gisteren één keer probeerde
 * niet. Daarom telt het aantal eerst.
 */
function snoei(groepje) {
    const sleutels = Object.keys(groepje);
    if (sleutels.length <= MAX_PER_GROEP) return;
    sleutels
        .sort((a, b) => (groepje[a].aantal - groepje[b].aantal)
                     || ((groepje[a].laatst || 0) - (groepje[b].laatst || 0)))
        .slice(0, sleutels.length - MAX_PER_GROEP)
        .forEach(s => delete groepje[s]);
}

/**
 * Eén gebouwd model meetellen.
 *
 * @param keuzes.profielen  { staander, handregel, spijl, boom } - verwijzingen
 *                          uit de profielkiezer, of null
 * @param keuzes.sierpunt      het model op de palen, of null/'geen'
 * @param keuzes.spijlSierpunt het model op de spijlen, of null/'geen'
 * @param keuzes.maten         de maten zoals er gebouwd is
 * @returns of het bewaren lukte
 */
export function onthoud(keuzes = {}) {
    const alles = lees();
    const nu = Date.now();

    for (const onderdeel of ['staander', 'handregel', 'spijl', 'boom']) {
        const ref = (keuzes.profielen || {})[onderdeel];
        if (!ref || !ref.bestand) continue;
        // Op het BESTAND geteld en niet op het label: dat is de echte sleutel,
        // dezelfde die configuraties.js gebruikt. Twee normen kunnen hetzelfde
        // label dragen en zijn dan toch verschillende profielen.
        tel(alles.profiel[onderdeel], ref.bestand, nu, {
            label: ref.englishLabel || ref.label || ref.bestand,
            norm: ref.standardLabel || ref.normLabel || '',
            bewaard: uitProfiel(ref),
        });
    }

    const punt = (v) => (v && v !== 'geen') ? v : null;
    tel(alles.punt.paal, punt(keuzes.sierpunt), nu);
    tel(alles.punt.spijl, punt(keuzes.spijlSierpunt), nu);

    const maten = keuzes.maten || {};
    const hoeken = String(maten.vervolg || '').trim();
    if (hoeken) tel(alles.hoek, hoeken, nu);

    // DE AFWIJKINGEN: elk veld waarin deze bouw van de standaard afwijkt. Dat
    // is wat "mijn standaard" straks kan invullen - precies de velden die jij
    // elke keer weer zit te veranderen.
    for (const [naam, standaard] of Object.entries(STANDAARD)) {
        if (NIET_TELLEN.includes(naam)) continue;
        const waarde = maten[naam];
        if (waarde === undefined || waarde === null) continue;
        if (String(waarde) === String(standaard)) continue;
        alles.veld[naam] = alles.veld[naam] || {};
        tel(alles.veld[naam], String(waarde), nu);
    }

    return schrijf(alles);
}

/**
 * De meest gebruikte keuzes uit een groepje, de drukste eerst.
 *
 * @param groepje  een tak uit `lees()`, bijvoorbeeld lees().profiel.staander
 * @returns [{ sleutel, aantal, laatst, ...wat er verder bij bewaard is }]
 */
export function top(groepje, maximaal = 5) {
    if (!groepje) return [];
    return Object.entries(groepje)
        .map(([sleutel, v]) => ({ sleutel, ...v }))
        // Aantal eerst, dan wat je het laatst gebruikte. Bij twee keuzes die je
        // even vaak maakte is de verste in het verleden niet meer je gewoonte.
        .sort((a, b) => (b.aantal - a.aantal) || ((b.laatst || 0) - (a.laatst || 0)))
        .slice(0, maximaal);
}

/**
 * Wat deze gebruiker het meest kiest, als één setje om toe te passen.
 *
 * Alleen waar er iets te kiezen valt: een veld dat je nog nooit anders hebt
 * gezet staat er NIET in, zodat de standaard uit regels.json blijft gelden.
 * Zo kan dit setje gewoon over de standaard heen zonder iets stilletjes te
 * veranderen waar je nooit om gevraagd hebt.
 */
export function mijnStandaard() {
    const alles = lees();
    const beste = (groepje) => top(groepje, 1)[0] || null;

    const maten = {};
    for (const [naam, waarden] of Object.entries(alles.veld)) {
        const b = beste(waarden);
        if (!b) continue;
        // Terug naar een getal waar het een getal was, anders blijft het tekst
        // (vulling is een keuzelijst, vervolg is tekst).
        const standaard = STANDAARD[naam];
        maten[naam] = typeof standaard === 'number' ? Number(b.sleutel) : b.sleutel;
    }

    const hoek = beste(alles.hoek);
    if (hoek) maten.vervolg = hoek.sleutel;

    const profielen = {};
    for (const onderdeel of ['staander', 'handregel', 'spijl', 'boom']) {
        const b = beste(alles.profiel[onderdeel]);
        profielen[onderdeel] = b ? (b.bewaard || null) : null;
    }

    const paal = beste(alles.punt.paal);
    const spijl = beste(alles.punt.spijl);

    return {
        maten,
        profielen,
        sierpunt: paal ? paal.sleutel : null,
        spijlSierpunt: spijl ? spijl.sleutel : null,
        // Waar het op gebaseerd is, zodat een scherm kan zeggen "uit 12 keer
        // bouwen" in plaats van te doen alsof dit een gegeven is.
        gebaseerdOp: Math.max(0, ...Object.values(alles.profiel)
            .flatMap(g => Object.values(g).map(v => v.aantal)),
            ...Object.values(alles.veld)
            .flatMap(g => Object.values(g).map(v => v.aantal))),
    };
}
