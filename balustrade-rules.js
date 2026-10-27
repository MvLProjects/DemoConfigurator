// Rekenregels voor een balustradeveld.
//
// De getallen staan NIET in dit bestand maar in regels.json, want
// onshape-ai/balustrade.py leest diezelfde getallen. Eén bron dus.
//
// De formule staat wel in beide talen - die valt niet te delen tussen
// JavaScript en Python. Het vangnet daarvoor zijn de 'ijkpunten' in
// regels.json: uitkomsten die allebei de implementaties moeten reproduceren.
// Beide testsuites controleren die. Verandert iemand een van de twee formules,
// dan valt die test om.
//
// De normwaarden zijn NIET gecontroleerd tegen het Bouwbesluit of een
// NEN-norm. Zie de lijst CONTROLEREN onderaan balustrade.py.

// Top-level await: het laden van dit bestand wacht op de regels. Wie deze
// module importeert merkt daar niets van, behalve dat het iets later klaar is.
const regels = await (await fetch(new URL('./regels.json', import.meta.url))).json();

export const STANDAARD = regels.standaard;
export const GRENZEN = regels.grenzen;
export const IJKPUNTEN = regels.ijkpunten;

// De maten van de voetplaat. Alleen de DIKTE staat in het paneel, want dat is
// de knop die ertoe doet: 0 betekent geen voetplaat. De rest zijn maten die
// zelden veranderen, en vijf extra invoervelden maken het paneel onleesbaar.
export const VOETPLAAT = regels.voetplaat;

// De maten van het vulraamwerk. Zelfde reden als bij de voetplaat: alleen de
// aan/uit-schakelaar staat in het paneel, de maten staan hier.
export const VULRAAMWERK = regels.vulraamwerk;

// Hoe diep de staanderkop wordt uitgeklonken om de handregel. Weer alleen een
// vinkje in het paneel; de diepte is een verhouding van de staanderbreedte en
// staat in regels.json, inclusief de reden waarom het 0,25 is.
export const UITKLINKEN = regels.uitklinken;

// Het plaatje bovenop de staander. Alleen de dikte staat in het paneel - 0 is
// geen kap - de oversteek staat hier. Zie regels.json voor waar die maten
// vandaan komen en waarom de kap er überhaupt is.
export const PAALKAP = regels.paalkap;

/**
 * De diepte van de uitsparing in een staander van deze breedte.
 *
 * Afgekapt op maxDiepteFactor. Zonder die afkap zou een grote factor twee
 * uitsparingen tegenover elkaar laten samenvallen en de staander doormidden
 * snijden - en dan valt hij in de export uiteen in twee solids, zonder dat er
 * ook maar iets een foutmelding geeft.
 */
export function uitklinkDiepte(staanderBreedte) {
    const factor = Math.min(UITKLINKEN.diepteFactor, UITKLINKEN.maxDiepteFactor);
    return staanderBreedte * factor;
}

// De schouder die een vulregel aan weerszijden vrijlaat op de staander, en de
// ondergrens voor de stripbreedte. Alleen een HANDMATIGE stripbreedte staat in
// het paneel - 0 betekent 'uit de staander afleiden' - de schouder staat hier.
export const STRIP = regels.strip;

// De eisen waaraan een AANSLUITING moet voldoen: hoeveel een dragend deel moet
// afdekken, hoeveel staal er op twee plekken mag zitten, en hoeveel ruimer een
// bed wordt gesneden dan wat erin valt. Zie regels.json voor waar elk getal
// vandaan komt en waarom het geen norm is.
export const CONTROLES = regels.controles;

// Waarmee de zaaglijst rekent: de stanglengte die je inkoopt en de dikte van een
// zaagsnede. Allebei aannames - zie regels.json voor waarom, en waarom er een
// snede per stuk gerekend wordt en niet per tussenruimte.
export const ZAAG = regels.zaag;

// Waar het veld tussen de staanders mee gevuld wordt: spijlen, horizontale
// regels, of niets. Zie regels.json voor waarom de maximale opening bij
// horizontale regels een EIGEN getal is en niet dezelfde 100 mm.
export const VULLING = regels.vulling;

// De ruit en de klemmen. Zie regels.json: de dikte 10,76 is GELAAGD glas, en
// alle getallen hier zijn aannames tot Marthijn ze bevestigt.
export const GLAS = regels.glas;

// Glas zonder staanders: een ruit in een bodemprofiel. Zie regels.json en
// glasvrij.js; ook dit zijn aannames, geen berekening.
export const GLASVRIJ = regels.glasvrij;

// De staanderkop afronden naast een ronde handregel; zie regels.json.
export const AFRONDING = regels.afronding;

// De schoprand langs de vloer; zie regels.json.
export const SCHOPRAND = regels.schoprand;

// Sierpunten en paalkoppen. De modellen zelf staan in sierpunten.js; hier
// alleen wat de regels erover zeggen. Zie regels.json: de verhoudingen komen
// uit twee gemeten maten, de rest is een keuze.
export const SIERPUNT = regels.sierpunt;

// De dekband: een geprofileerde handregel in plaats van een stalen buis. De
// doorsnedes staan in dekbanden.js; hier alleen wat de regels erover zeggen.
export const DEKBAND = regels.dekband;

// De scherpste knik die nog te bouwen is. Onder deze hoek vouwt de leuning
// zover terug dat de twee velden elkaar raken en de staander in de deelhoek
// niet meer tussen beide past.
export const MIN_HOEK = 30;

/**
 * Ontleedt het vervolg van het pad: "90, 1500, -90, 800".
 *
 * WAT HET BETEKENT. De eerste zijde is altijd het veld `lengte`; hier staat
 * wat daarná komt, steeds als paar: draai zoveel graden, loop dan zoveel mm.
 * Een positieve hoek draait naar links, een negatieve naar rechts.
 *
 * WAAROM ZO EN NIET MET EEN LIJST VELDJES. De meetkunde voor hoeken zit er al
 * lang in - verstek, een staander in de deelhoek, gesloten rondes - alleen kon
 * je er alleen bij door randen in een ingeladen model aan te klikken. Dit is de
 * kortste weg naar diezelfde machinerie, en een leeg veld betekent precies wat
 * het altijd deed: een recht stuk.
 *
 * @returns [{ hoek, lengte }] - leeg bij een lege invoer
 * @throws  met een leesbare melding, niet met een rekenfout verderop
 */
export function ontleedVervolg(tekst, minLengte = GRENZEN.lengte[0],
                               maxLengte = GRENZEN.lengte[1]) {
    const schoon = String(tekst ?? '').trim();
    if (!schoon) return [];

    // DE KOMMA SCHEIDT DE PAREN, dus hij kan hier geen decimaalteken zijn. Een
    // punt kan dat wel: "90, 1500.5". Daarom staat er hieronder géén vervanging
    // van komma naar punt: na het splitsen zit er per definitie geen komma meer
    // in een stuk, dus die regel zou nooit iets te doen hebben. Wie toch een
    // komma als decimaalteken typt, krijgt een oneven aantal getallen - en de
    // melding zegt dan wat eraan te doen is.
    const stukken = schoon.split(/[,;]+/).map(s => s.trim()).filter(s => s !== '');
    if (stukken.length % 2 !== 0) {
        throw new Error('Hoeken: vul ze in paren in — eerst de hoek, dan de '
            + `lengte. Ik las ${stukken.length} getallen: ${stukken.join(', ')}. `
            + 'De komma scheidt de getallen, dus gebruik een punt voor '
            + 'decimalen: 90, 1500.5');
    }

    const uit = [];
    for (let i = 0; i < stukken.length; i += 2) {
        const hoek = Number(stukken[i]);
        const lengte = Number(stukken[i + 1]);
        if (!Number.isFinite(hoek) || !Number.isFinite(lengte)) {
            throw new Error(`Hoeken: "${stukken[i]}, ${stukken[i + 1]}" is geen `
                + 'hoek met een lengte.');
        }
        // ALLEEN RECHTE HOEKEN, en dat is een beperking met een reden.
        //
        // De hoekmachinerie zit er al lang in, maar hij is alleen op 90 graden
        // nagemeten. Bij andere hoeken staat er staal in staal: nagemeten op
        // een L-vorm van 2000 + 1500, met een staander van 40 en een vulregel
        // van 30, kwam er uit
        //
        //     135°  staander ∩ vulregel   682 mm3,  vulregel ∩ vulregel 1055
        //     120°  staander ∩ vulregel   495 mm3,  vulregel ∩ vulregel   58
        //      60°  staander ∩ vulregel   495 mm3
        //      45°  staander ∩ vulregel   682 mm3
        //      90°  schoon
        //
        // De oorzaak zit in de inzet van de staander: die wordt berekend voor
        // de HARTLIJN van het veld, terwijl een vulregel 30 mm breed is en zijn
        // buitenste hoek er dus eerder uit komt. Bij 90 graden valt dat toevallig
        // goed uit. Dat is een bestaande fout in staanderGegevens, niet in deze
        // invoer - maar zolang hij er zit laat ik er geen hoeken in die er
        // zichtbaar op stuklopen.
        if (Math.abs(Math.abs(hoek) - 90) > 1e-9) {
            throw new Error(`Hoeken: ${hoek}° gaat nog niet. Alleen 90 en -90 `
                + 'zijn nagemeten; bij andere hoeken komt er staal in staal te '
                + 'staan (gemeten: 682 mm³ bij 135°). Zie _vulling/hoeken in '
                + 'regels.json.');
        }
        if (lengte < minLengte || lengte > maxLengte) {
            throw new Error(`Hoeken: een zijde van ${lengte} mm valt buiten `
                + `${minLengte}–${maxLengte} mm.`);
        }
        uit.push({ hoek, lengte });
    }
    return uit;
}

/** Is dit een vullingssoort die de app kent? Zo niet: terug naar spijlen. */
export function vullingSoort(waarde) {
    return VULLING.soorten.includes(waarde) ? waarde : 'spijlen';
}

/**
 * De breedte die bij een staander van deze breedte past.
 *
 *     strip = staanderbreedte - 2 x schouder
 *
 * Punt 2 van de tweede opdracht: de app stelt een passende stripbreedte voor
 * bij het gekozen staanderprofiel, in plaats van er een vast getal van te
 * maken. Stond hij vast op 30, dan werd de schouder bij een staander van 50
 * ineens 10 mm per kant in plaats van 5, en bij een staander van 25 zou de
 * strip breder zijn dan de paal.
 *
 * SCHOUDER 5 past op de twee bekende datapunten en niet op één: staander 50
 * geeft 40 (het voorbeeld uit de opdracht) en staander 40 geeft 30 (de waarde
 * die er al stond). Een verhouding van 0,8 past op het eerste maar niet op het
 * tweede. Zie regels.json voor de volledige verantwoording en voor de rangorde
 * profiel > handmatig > deze regel.
 *
 * Afgerond op hele millimeters, want zo koop je plat staal, en afgekapt op een
 * minimum: een strip van 5 mm breed is geen onderdeel meer.
 */
export function stripBreedte(staanderBreedte) {
    const uitRegel = staanderBreedte - 2 * STRIP.schouder;
    return Math.round(Math.max(STRIP.minimum, uitRegel));
}

const OMSCHRIJVING = {
    lengte: 'lengte',
    hoogte: 'hoogte',
    spijlBreedte: 'spijlbreedte',
    maxDoorgang: 'max. doorgang',
    staanderBreedte: 'staanderbreedte',
    handregelHoogte: 'handregelhoogte',
    maxStaanderAfstand: 'max. staanderafstand',
    handregelOverstek: 'handregeloverstek',
    voetplaatDikte: 'voetplaatdikte',
    vulraamwerk: 'vulraamwerk',
    uitklinken: 'uitklinken',
    paalkapDikte: 'paalkapdikte',
    stripBreedte: 'stripbreedte',
};

/**
 * De buitenmaten van de doorsnede van een profiel, of null als er geen is.
 *
 * Werkt zowel op een profielverwijzing uit de kiezer als op een profiel uit de
 * boom. Leest alleen het manifest; er gaat geen STEP-bestand voor open.
 *
 * Staat hier en niet in pad.js omdat valideer() het ook nodig heeft, en pad.js
 * leunt op dit bestand - andersom zou een kringetje opleveren.
 */
export function profielDoos(profiel) {
    if (!profiel) return null;
    return profiel.boxSize || (profiel.bron && profiel.bron.boxSize) || null;
}

export function valideer(p) {
    const fouten = [];
    for (const [naam, [min, max]] of Object.entries(GRENZEN)) {
        const waarde = p[naam];
        if (typeof waarde !== 'number' || !Number.isFinite(waarde)) {
            fouten.push(`${OMSCHRIJVING[naam]}: geen geldig getal`);
        } else if (waarde < min || waarde > max) {
            fouten.push(`${OMSCHRIJVING[naam]}: ${waarde} mm valt buiten ${min}–${max} mm`);
        }
    }
    // De handregel moet in de hoogte passen, anders houden de spijlen geen
    // lengte over.
    //
    // LET OP welke hoogte. Is er een profiel gekozen, dan telt de hoogte van
    // dat profiel en niet het invulveld. Zonder dit kwam je er met een HEB 1000
    // als handregel zo doorheen: de validatie keek naar de 40 uit het veld, en
    // daarna liep de bouw vast op een spijl van 0 mm lang. Dat gaf een kaal
    // getal als foutmelding - een OCCT-code, waar niemand iets aan heeft.
    if (fouten.length === 0) {
        const doos = profielDoos(p.handregelProfiel);
        const hoogte = doos ? doos[1] : p.handregelHoogte;

        // Op een helling staat de handregel schuin, dus hij neemt meer
        // verticale ruimte in: hoogte / cos. Een profiel dat vlak nog net past,
        // past schuin niet meer.
        const horizontaal = Number(p.lengte) || 0;
        const stijging = Number(p.hoogteverschil) || 0;
        const cos = stijging === 0 || horizontaal === 0
            ? 1 : horizontaal / Math.hypot(horizontaal, stijging);
        const nodig = hoogte / cos;

        if (nodig >= p.hoogte) {
            const naam = doos ? (p.handregelProfiel.englishLabel || 'het profiel') : null;
            const schuin = cos < 1
                ? ` (schuin ${Math.round(nodig)} mm, want hij loopt niet vlak)` : '';
            fouten.push(naam
                ? `de handregel ${naam} is ${hoogte} mm hoog${schuin} en past niet `
                  + `in een leuning van ${p.hoogte} mm; er blijft geen spijl over`
                : 'handregelhoogte moet kleiner zijn dan de totale hoogte');
        }
    }

    // De voetplaat gaat van de staanderlengte af; bij een dikke plaat en een
    // lage leuning zou er niets overblijven.
    if (fouten.length === 0 && p.voetplaatDikte >= p.hoogte) {
        fouten.push('voetplaatdikte moet kleiner zijn dan de totale hoogte');
    }

    // De gaten moeten op de plaat passen. Vallen ze over de rand, dan levert de
    // uitsnede geen gesloten vorm meer op en is er niets aan te zien - het
    // onderdeel ziet er gewoon raar uit. Beter er hier op stuiten.
    const vp = { ...VOETPLAAT, ...(p.voetplaat || {}) };
    if (fouten.length === 0 && p.voetplaatDikte > 0 && vp.gat > 0) {
        const rand = vp.lengte / 2 - vp.gatAfstand / 2 - vp.gat / 2;
        if (rand < 0) {
            fouten.push('de gaten vallen over de rand van de voetplaat');
        }
        if (vp.gat >= vp.breedte) {
            fouten.push('het gat is breder dan de voetplaat');
        }
    }
    return fouten;
}

/**
 * Het kleinste aantal spijlen waarbij de vrije doorgang onder het maximum blijft.
 *
 * n spijlen tussen twee staanders geven n+1 openingen:
 *     doorgang = (lengte - n * spijlbreedte) / (n + 1)
 * Uitwerken van doorgang <= max geeft:
 *     n >= (lengte - max) / (max + spijlbreedte)
 *
 * Naar boven afronden. Naar beneden zou een te grote opening geven, en dat is
 * precies de fout die je bij een kinderveiligheidseis niet wilt maken.
 *
 * We ronden hier NIET af op decimalen: zet je 50 spijlen uit met een afgeronde
 * steek, dan telt die fout 50 keer op.
 */
export function berekenSpijlen({ lengte, maxDoorgang, spijlBreedte }) {
    const aantal = Math.max(0, Math.ceil((lengte - maxDoorgang) / (maxDoorgang + spijlBreedte)));
    const doorgang = (lengte - aantal * spijlBreedte) / (aantal + 1);

    return {
        aantal,
        doorgang,
        steek: doorgang + spijlBreedte,            // hart op hart
        eersteHart: doorgang + spijlBreedte / 2,   // vanaf het begin van het veld
    };
}

/** De hartposities van alle spijlen, gemeten vanaf het begin van het veld. */
export function spijlPosities(p) {
    const r = berekenSpijlen(p);
    return Array.from({ length: r.aantal }, (_, i) => r.eersteHart + i * r.steek);
}
