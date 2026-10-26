// Van een Nederlandse zin naar gestructureerde parameters.
//
// Dit is de plek in de keten waar straks een taalmodel kan komen:
//
//     "maak een blok van 300 bij 200 bij 150"
//              |
//              v   <-- DEZE functie
//     { actie: 'blok', params: { breedte: 300, diepte: 200, hoogte: 150 } }
//              |
//              v
//     validatie -> regels -> OCCT -> beeld
//
// Nu is het een patroonherkenner, geen taalmodel. Dat heeft twee kanten:
//   + voorspelbaar, gratis, werkt offline, altijd hetzelfde antwoord
//   - begrijpt alleen zinnen die op de patronen hieronder lijken
//
// Wil je er later een taalmodel voor in de plaats zetten, dan hoeft alleen
// `parseer` vervangen te worden door een aanroep die hetzelfde teruggeeft.
// De rest van de viewer merkt daar niets van. Dat is ook precies waarom het
// antwoord gestructureerd is en niet als tekst: de geometrie wordt gemaakt
// door OCCT, op basis van getallen, niet door wat er uit een model rolt.

import { STANDAARD } from './balustrade-rules.js';
import { STANDAARD as TRAP_STANDAARD, berekenTrap } from './trap-regels.js';
import { tredeSoortVan } from './treden.js';
// De sierpuntmodellen, om hun namen uit een zin te kunnen halen. Er komt GEEN
// tweede lijst met namen: de termen worden uit MODELLEN zelf afgeleid, zodat
// een nieuw model meteen te noemen is zonder dat iemand dit bestand kent.
import { MODELLEN } from './sierpunten.js';
// Gedraaide balusters en dekbanden. Zelfde gedachte: de namen komen uit de
// bibliotheken zelf, zodat een nieuw model meteen te noemen is.
import { MODELLEN as BALUSTERS } from './balusters.js';
import { MODELLEN as DEKBANDEN } from './dekbanden.js';
// Dezelfde vergelijking die de profielkiezer gebruikt als je in het zoekveld
// typt. Zo vindt "chs48,3" hier precies wat het daar ook zou vinden.
import { pastBijZoekterm, normLabel } from './profielen.js';
import { RAL } from './materialen.js';

// Hoe een eenheid zich verhoudt tot millimeter. Zonder eenheid gaan we uit van
// millimeter, want dat is wat CAD en de werkplaats gebruiken.
const EENHEDEN = {
    millimeter: 1, mm: 1,
    centimeter: 10, cm: 10,
    meter: 1000, m: 1000,
};

// Let op drie dingen:
//
//   1. 'meter' staat vóór 'm', anders matcht 'm' alvast op de eerste letter
//      van 'meter' en houd je 'eter' over.
//   2. (?!\d) achter het getal: zonder dat mag de regex terugvallen op minder
//      cijfers als de rest niet past. Bij "300x200" werd "300" dan stilletjes
//      "30", want na de 0 stond geen letter meer. Dat kost je een factor tien
//      in je model zonder dat er iets klaagt.
//   3. \b achter de eenheid, zodat "1 maal" niet als "1 meter" wordt gelezen.
const GETAL = /(\d+(?:[.,]\d+)?)(?!\d)\s*(?:(millimeter|centimeter|meter|mm|cm|m)\b)?/gi;

// De volgorde telt: 'trap' moet vóór 'balustrade' staan. Anders pakt
// "trap van 3 meter met leuning" het woord 'leuning' en bouw je een balustrade.
const VORMEN = [
    { actie: 'trap', woorden: ['trap', 'steektrap', 'stairs', 'wenteltrap', 'spiltrap',
                               'spiraaltrap', 'kwartslagtrap', 'halfslagtrap', 'bordestrap',
                               'hoektrap'] },
    { actie: 'kubus', woorden: ['kubus', 'cube', 'dobbelsteen'] },
    { actie: 'blok', woorden: ['blok', 'balk', 'doos', 'plaat', 'box'] },
    { actie: 'balustrade', woorden: ['balustrade', 'leuning', 'hekwerk', 'reling', 'railing'] },
];

// Woorden die aangeven wélke maat een getal is.
const MAATWOORDEN = {
    breed: 'breedte', breedte: 'breedte',
    diep: 'diepte', diepte: 'diepte', dik: 'diepte', dikte: 'diepte',
    hoog: 'hoogte', hoogte: 'hoogte',
    lang: 'lengte', lengte: 'lengte',
};

// --- de extra's: profiel, hoeken, overstek, sierpunt ------------------------
//
// WAAROM DIT APART STAAT EN EERST GEBEURT. De zin wordt in twee slagen gelezen.
// Hieronder worden eerst de stukken herkend die GEEN maat zijn - "CHS 48,3",
// "90 graden na 1500", "80 mm spijloverstek", "speerpunt op de spijlen" - en
// die stukken worden daarna UIT de zin gepoetst. Pas op wat er overblijft gaat
// de oude maatherkenning los.
//
// Die volgorde is geen netheid maar noodzaak. "CHS 48,3" bevat het getal 48,3
// en "90 graden na 1500" bevat er twee. Zonder poetsen pakt de maatlezer die
// op als lengte of hoogte: een profielnaam die stilletjes de hoogte van je
// leuning verandert is precies het soort fout waar deze app niet van houdt.
//
// WAT ER NIET GEBEURT: raden. Past een profielnaam op zeven profielen, dan
// wordt er geen van de zeven gekozen maar wordt er gevraagd om de wanddikte
// erbij. Staat er een woord dat de app niet kent - "tolerantie" bijvoorbeeld -
// dan wordt dat GEMELD en niet genegeerd. Een zin die half begrepen wordt en
// half wordt weggegooid is erger dan een zin die niet begrepen wordt.

/** Een stuk tekst wegpoetsen, mét behoud van de lengte en dus van alle posities. */
const poets = (tekst, begin, eind) =>
    tekst.slice(0, begin) + ' '.repeat(eind - begin) + tekst.slice(eind);

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Welk ONDERDEEL er bedoeld wordt. 'leuning' staat er bewust niet bij: dat is
// hierboven al een woord voor de hele balustrade, en dan zou "leuning van 2
// meter" ineens een handregelprofiel aanwijzen.
const ONDERDEELWOORDEN = [
    [/\b(staander|staanders|paal|palen|post|posten|stijl|stijlen)\b/i, 'staander'],
    [/\b(handregel|handregels|bovenregel|leuningregel)\b/i, 'handregel'],
    [/\b(spijl|spijlen|spijltje|spijltjes|staaf|staven|baluster|balusters)\b/i, 'spijl'],
    [/\b(trapbomen|trapboom|boom|bomen)\b/i, 'boom'],
];

/**
 * Welk onderdeel er het DICHTST bij een stuk tekst genoemd wordt.
 *
 * Het dichtstbijzijnde wint, vóór of ná. Eerst stond hier "kijk eerst vóór,
 * dan ná", en daar ging het mis op precies de zin waar het om begonnen was:
 *
 *     ...een speerpunt op de spijlen en een bol-rond op de palen
 *
 * Bij "bol-rond" staat het woord "spijlen" nog nét in het venster ervóór - van
 * de punt die erboven al toegewezen is - terwijl "palen" er direct achter
 * staat. Met "eerst vóór" kreeg de bol dus de spijlen, overschreef hij de
 * speerpunt, en bleef er voor de palen niets over. Twee keuzes die elkaar
 * opeten zonder dat er iets gemeld wordt.
 *
 * Met de afstand erbij wint "palen" op 7 tekens van "spijlen" op 8, en klopt
 * het weer. Bij gelijke afstand wint wat ervóór staat, want "staanders CHS
 * 48,3" is de gewone schrijfwijze.
 */
function onderdeelBij(tekst, begin, eind, bereik = 30) {
    const voor = tekst.slice(Math.max(0, begin - bereik), begin);
    const na = tekst.slice(eind, eind + bereik);
    let beste = null;
    let besteAfstand = Infinity;

    // Vóór: het LAATSTE woord telt, dat staat er het dichtst bij.
    for (const [re, naam] of ONDERDEELWOORDEN) {
        const treffers = [...voor.matchAll(new RegExp(re.source, 'gi'))];
        if (!treffers.length) continue;
        const m = treffers[treffers.length - 1];
        const afstand = voor.length - (m.index + m[0].length);
        if (afstand < besteAfstand) { besteAfstand = afstand; beste = naam; }
    }
    // Ná: het EERSTE woord telt. Strikt kleiner, dus bij gelijke afstand
    // blijft staan wat ervóór gevonden is.
    for (const [re, naam] of ONDERDEELWOORDEN) {
        const m = na.match(new RegExp(re.source, 'i'));
        if (m && m.index < besteAfstand) { besteAfstand = m.index; beste = naam; }
    }
    return beste;
}

// Een profielnaam: een korte lettercode met maten erachter. CHS 48,3 /
// SHS 40x40x3 / FL 20x5 / UPN 220 / L 40x40x4. Of het ECHT een profiel is
// wordt niet aan dit patroon afgemeten maar aan de catalogus - "bij 200" past
// hier ook op en levert daar niets op, en dan blijft het gewoon een maat.
const PROFIELNAAM = /\b([A-Za-z]{1,4})[\s-]?(\d+(?:[.,]\d+)?(?:\s*[x×*]\s*\d+(?:[.,]\d+)?)*)\b/g;

// Nederlandse woordjes die toevallig op een profielcode lijken. Zonder deze
// lijst is "kubus van 300 mm" ook een kandidaat, en dan wordt er voor élke zin
// met een getal erin een catalogus van 2336 profielen ingelezen om vervolgens
// niets te vinden. Dat kost een seconde en levert nul op.
const GEEN_CODE = /^(van|bij|met|en|om|na|dan|tot|per|als|dat|die|der|een|het|de|op|in|is|te|of|aan|uit|tot|dus|nog|wel|zo|al|er|ze|hij|mm|cm|m|x)$/i;

// "90 graden na 1500 mm", "90 graden naar rechts en dan 1500".
const HOEKZIN = /(-?\d+(?:[.,]\d+)?)\s*graden?(?:\s+naar\s+(links|rechts))?[\s,]*(?:en\b)?[\s,]*(?:daarna|vervolgens|gevolgd\s+door|dan|na)?[\s,]*(\d+(?:[.,]\d+)?)\s*(millimeter|centimeter|meter|mm|cm|m)?\b/gi;

// Een maatafwijking of tolerantie: iets wat deze app niet kent. Het getal gaat
// mee in de match, want het moet samen met het woord uit de zin verdwijnen -
// anders wordt "een afwijking van 0,5 mm" alsnog een leuning van 0,5 hoog.
// In twee volgordes: "tolerantie 1 mm" en "0,5 mm speling".
const TOLERANTIE = /(?:(\d+(?:[.,]\d+)?)\s*(?:millimeter|centimeter|meter|mm|cm|m)?\s+)?\b(?:maatafwijking|maatafwijkingen|afwijking|afwijkingen|tolerantie|toleranties|speling)\b(?:\s*(?:van|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:millimeter|centimeter|meter|mm|cm|m)?)?/gi;

// VELDEN DIE BIJ NAAM GENOEMD WORDEN.
//
// Hier zat een gat dat pas opviel toen de balusters erbij kwamen. "spijlen van
// 100 breed" zette de spijlbreedte NIET: de maatlezer kent alleen lengte,
// hoogte en diepte, en "breed" is daar de BREEDTE - die bij een balustrade de
// lengte wordt. Het gevolg was een leuning van 90 mm lang en 2500 hoog uit de
// zin "balustrade van 2,5 meter met spijlen van 90 breed".
//
// Een veld dat in het paneel staat hoort dus ook bij zijn naam genoemd te
// kunnen worden. De sleutel is de veldnaam zoals regels.json hem kent.
const VELDNAMEN = [
    ['spijlBreedte', /spijl\s?breedte|baluster\s?breedte/,
                     /spijlen|balusters|staven/, /breed|dik/],
    ['maxDoorgang', /max(?:imale)?\.?\s*(?:vrije\s*)?doorgang|doorgang/, null, null],
    ['handregelHoogte', /handregel\s?hoogte|dekband\s?hoogte/, null, null],
    ['staanderBreedte', /staander\s?breedte|paal\s?breedte/, /staanders|palen/, /breed|dik/],
    ['maxStaanderAfstand', /max(?:imale)?\.?\s*staander\s?afstand|staander\s?afstand/,
                           null, null],
    ['voetplaatDikte', /voetplaat\s?dikte/, null, null],
];

/** "spijlbreedte 100", "spijlen van 100 breed", "100 mm brede spijlen". */
function veldPatronen(naam, direct, onderdeel, bijvoeglijk) {
    const getal = '(\\d+(?:[.,]\\d+)?)\\s*(millimeter|centimeter|meter|mm|cm|m)?';
    const uit = [new RegExp(`(?:${direct.source})\\s*(?:van|=|:)?\\s*${getal}`, 'gi')];
    if (onderdeel && bijvoeglijk) {
        uit.push(new RegExp(
            `(?:${onderdeel.source})\\s*(?:van)?\\s*${getal}\\s*(?:${bijvoeglijk.source})`,
            'gi'));
        uit.push(new RegExp(
            `${getal}\\s*(?:${bijvoeglijk.source})\\w*\\s*(?:${onderdeel.source})`,
            'gi'));
    }
    return uit;
}

// DE COATKLEUR. "RAL 7016", "in antraciet", "zwart gecoat", of "blank" voor
// geen coating. Het RAL-nummer moet er vroeg uit: anders wordt 7016 een maat.
// Alleen kleuren die het paneel ook kent; een onbekend nummer wordt gemeld.
const RALZIN = /\bRAL\s*-?\s*(\d{4})\b/gi;
const KLEURWOORDEN = [
    ...Object.entries(RAL).map(([nr, r]) => [r.naam.toLowerCase(), nr]),
    ['antraciet', '7016'], ['zwart', '9005'], ['wit', '9010'],
].sort((a, b) => b[0].length - a[0].length);
const ONGECOAT = /\b(?:blank|ongecoat|niet\s+gecoat|zonder\s+coating)\b/gi;

// HET METAAL van het frame. Staal staat er bewust niet bij: "stalen treden"
// gaat over de treden, en staal is toch al wat er staat als niets anders
// genoemd wordt.
const METAALZINNEN = [
    [/\b(?:rvs|inox|roestvrij(?:\s+staal)?|roestvast(?:\s+staal)?)\b/gi, 'rvs'],
    [/\b(?:aluminium|alu)\b/gi, 'aluminium'],
];
// "eiken handregel", "houten leuning". Niet "wandleuning": dat is iets anders.
const HOUTREGELZIN = /\b(houten|eiken|beuken|merbau)\s+(?:hand)?(?:regel|leuning)\b/gi;
const VERZINKZIN = /\b(?:(?:thermisch\s+)?verzinkte?|verzinken|duplex)\b/gi;

// DE VULLING van de leuning. Bewust alleen hele uitdrukkingen: "glazen treden"
// gaat over de treden en mag hier NIET als glazen vulling gelezen worden.
const VULLINGZINNEN = [
    // Glas zonder staanders EERST: "glazen balustrade zonder staanders" moet
    // in zijn geheel hier vallen, en niet als gewoon glas tussen staanders.
    [/\b(?:(?:glazen\s+(?:balustrade|panelen|ruiten)|glas)\s+)?(?:zonder\s+staanders|in\s+(?:een\s+)?bodemprofiel)\b|\bframeless\b/gi, 'glasvrij'],
    [/\b(?:glazen\s+(?:vulling|panelen|ruiten|balustrade)|(?:vulling|panelen|ruiten)\s+(?:van|in|uit)\s+glas|met\s+glas(?:\s+als\s+vulling)?)\b/gi, 'glas'],
    [/\b(?:liggende|horizontale)\s+(?:regels|spijlen|vulling|staven)\b/gi, 'horizontaal'],
    [/\b(?:verticale|staande)\s+(?:spijlen|staven|vulling)\b/gi, 'spijlen'],
    [/\bzonder\s+vulling\b/gi, 'geen'],
];

// "80 mm spijloverstek", "spijloverstek 80", "overstek van 100 mm".
const OVERSTEKZIN = /(?:(\d+(?:[.,]\d+)?)\s*(millimeter|centimeter|meter|mm|cm|m)?\s+)?(spijl\s?overstek|handregel\s?overstek|overstek)(?:\s*(?:van|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(millimeter|centimeter|meter|mm|cm|m)?)?/gi;

/**
 * Waar een sierpunt aan te herkennen is, afgeleid uit MODELLEN zelf.
 *
 * Per model drie manieren om het te noemen: zijn id ("bol-rond"), diezelfde id
 * met spaties ("bol rond") en zijn naam zonder de uitleg tussen haakjes
 * ("franse lelie"). De langste term eerst, zodat "gelepelde punt" wint van
 * "punt" en niet andersom.
 *
 * LOSSE WOORDEN ALS "bol" STAAN ER BEWUST NIET BIJ. Die passen op vier
 * modellen tegelijk, en dan zou er geraden worden welke. Wie "bol" typt krijgt
 * hieronder de lijst te zien in plaats van een willekeurige keuze.
 */
const PUNTTERMEN = MODELLEN
    .flatMap(m => [m.id, m.id.replace(/-/g, ' '),
                   m.naam.toLowerCase().replace(/\s*\([^)]*\)\s*/g, ' ').trim()]
        .map(term => ({ id: m.id, term })))
    .filter((v, i, a) => a.findIndex(x => x.term === v.term) === i)
    .sort((a, b) => b.term.length - a.term.length);

/** De termen waarop een model uit een bibliotheek te herkennen is. */
function termenVan(modellen) {
    return modellen
        .flatMap(m => [m.id, m.id.replace(/-/g, ' '),
                       m.naam.toLowerCase().replace(/\s*\([^)]*\)\s*/g, ' ').trim()]
            .map(term => ({ id: m.id, term })))
        .filter((v, i, a) => a.findIndex(x => x.term === v.term) === i)
        .sort((a, b) => b.term.length - a.term.length);
}

const BALUSTERTERMEN = termenVan(BALUSTERS);
const DEKBANDTERMEN = termenVan(DEKBANDEN);

// Waaraan je ziet of een modelnaam over de SPIJLEN of over de HANDREGEL gaat.
//
// DIT IS NODIG OMDAT DE NAMEN BOTSEN. Er is een baluster "klassiek" én een
// dekband "klassiek"; wie alleen dat woord typt bedoelt er één van, en raden
// welke zou de helft van de keren het verkeerde model opleveren. De volledige
// namen botsen niet - "klassieke vaasbaluster" naast "klassieke dekband" - dus
// meestal valt er niets op te lossen.
const BALUSTERWOORD = /\b(baluster|balusters|balustervorm|spijl|spijlen|staaf|staven)\b/i;
const DEKBANDWOORD = /\b(dekband|dekbanden|afdekband|handregel|leuningband)\b/i;

/**
 * Alle plekken waar een term uit een lijst voorkomt, de langste eerst.
 *
 * Een plek die al door een langere term is opgeslokt telt niet nog een keer:
 * "klassieke vaasbaluster" is één keus en niet twee.
 */
function zoekModellen(klein, termen) {
    const gezien = [];
    for (const { id, term } of termen) {
        const re = new RegExp(`\\b${esc(term)}\\b`, 'g');
        for (const m of [...klein.matchAll(re)]) {
            const eind = m.index + term.length;
            if (gezien.some(g => m.index < g.eind && g.begin < eind)) continue;
            gezien.push({ id, term, begin: m.index, eind });
        }
    }
    return gezien;
}

/**
 * Noemt deze zin iets dat op een profielnaam lijkt?
 *
 * main.js gebruikt dit om te besluiten of de catalogus ingelezen moet worden
 * vóór de zin gelezen wordt. Liever één keer te vaak laden dan een zin die de
 * eerste keer anders uitpakt dan de tweede.
 */
export function noemtProfiel(tekst) {
    for (const m of String(tekst || '').matchAll(PROFIELNAAM)) {
        if (!GEEN_CODE.test(m[1])) return true;
    }
    return false;
}

/**
 * Leest de niet-maat-dingen uit de zin en poetst ze eruit.
 *
 * @param tekst      de hele zin
 * @param voorraad   alle profielen uit de catalogus, of [] als die niet geladen is
 * @returns { rest, vervolg, spijlOverstek, handregelOverstek, profielen,
 *            sierpunt, spijlSierpunt, gevonden, genegeerd }
 */
function leesExtras(tekst, voorraad) {
    let rest = tekst;
    const gevonden = [];
    const genegeerd = [];
    const uit = {
        vervolg: undefined, spijlOverstek: undefined,
        spijlModel: undefined, handregelModel: undefined,
        handregelOverstek: undefined, profielen: {},
        sierpunt: undefined, spijlSierpunt: undefined,
    };

    // --- 0. metaal, verzinken, coatkleur en vulling ------------------------
    for (const [re, metaal] of METAALZINNEN) {
        for (const m of [...rest.matchAll(re)]) {
            if (!uit.metaal) {
                uit.metaal = metaal;
                gevonden.push(metaal === 'rvs' ? 'frame van RVS 316' : 'frame van aluminium');
            }
            rest = poets(rest, m.index, m.index + m[0].length);
        }
    }
    for (const m of [...rest.matchAll(VERZINKZIN)]) {
        if (uit.verzinken === undefined) gevonden.push('thermisch verzinkt');
        uit.verzinken = true;
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    for (const m of [...rest.matchAll(HOUTREGELZIN)]) {
        const hout = m[1].toLowerCase();
        uit.handregelHout = hout === 'houten' ? 'eiken' : hout;
        gevonden.push(`handregel van ${uit.handregelHout}`);
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    if (uit.verzinken && uit.metaal) {
        genegeerd.push('Verzinken kan alleen bij staal; RVS en aluminium roesten niet.');
        uit.verzinken = undefined;
    }
    for (const m of [...rest.matchAll(RALZIN)]) {
        if (RAL[m[1]]) {
            uit.afwerking = m[1];
            gevonden.push(`gecoat in RAL ${m[1]}`);
        } else {
            genegeerd.push(`RAL ${m[1]} staat niet in de kleurenlijst van de app. `
                + `Kies uit: ${Object.keys(RAL).join(', ')}.`);
        }
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    if (uit.afwerking === undefined) {
        const klein = rest.toLowerCase();
        for (const [woord, nr] of KLEURWOORDEN) {
            const i = klein.search(new RegExp(`\\b${esc(woord)}\\b`));
            if (i < 0) continue;
            uit.afwerking = nr;
            gevonden.push(`gecoat in RAL ${nr} (${RAL[nr].naam.toLowerCase()})`);
            rest = poets(rest, i, i + woord.length);
            break;
        }
    }
    for (const m of [...rest.matchAll(ONGECOAT)]) {
        uit.afwerking = '';
        gevonden.push('blank, niet gecoat');
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    for (const [re, soort] of VULLINGZINNEN) {
        for (const m of [...rest.matchAll(re)]) {
            uit.vulling = soort;
            rest = poets(rest, m.index, m.index + m[0].length);
        }
    }
    if (uit.vulling) gevonden.push(`vulling: ${uit.vulling}`);

    // --- 1. hoeken ---------------------------------------------------------
    const paren = [];
    for (const m of [...rest.matchAll(HOEKZIN)]) {
        let hoek = parseFloat(m[1].replace(',', '.'));
        // "naar rechts" draait de andere kant op; zo staat het ook in het veld.
        if (/rechts/i.test(m[2] || '') && hoek > 0) hoek = -hoek;
        const lengte = naarMillimeter(m[3], m[4]);
        paren.push(`${hoek}, ${lengte}`);
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    if (paren.length) {
        uit.vervolg = paren.join(', ');
        gevonden.push(`hoeken ${uit.vervolg}`);
    } else if (/\bgraden?\b/i.test(rest)) {
        genegeerd.push('Ik zie wel een hoek maar geen lengte erachter. '
            + 'Schrijf het als "90 graden na 1500 mm".');
    }

    // --- 2. overstek -------------------------------------------------------
    for (const m of [...rest.matchAll(OVERSTEKZIN)]) {
        const waarde = m[1] !== undefined ? naarMillimeter(m[1], m[2])
            : m[4] !== undefined ? naarMillimeter(m[4], m[5]) : undefined;
        if (waarde === undefined) continue;
        // Welke van de twee. Het woord zelf gaat vóór; staat er alleen
        // "overstek", dan telt wat er vlak omheen staat. Blijft het onduidelijk,
        // dan is het de HANDREGEL - zo heette dat veld altijd al in deze app,
        // en een nieuwe mogelijkheid hoort een oud woord niet te kapen.
        const woord = m[3].toLowerCase().replace(/\s+/g, '');
        const omheen = rest.slice(Math.max(0, m.index - 20),
                                  m.index + m[0].length + 20);
        const soort = woord.startsWith('spijl') ? 'spijl'
            : woord.startsWith('handregel') ? 'handregel'
            : /\bspijl/i.test(omheen) ? 'spijl'
            : 'handregel';
        if (soort === 'spijl') {
            uit.spijlOverstek = waarde;
            gevonden.push(`spijloverstek ${waarde} mm`);
        } else {
            uit.handregelOverstek = waarde;
            gevonden.push(`handregeloverstek ${waarde} mm`);
        }
        rest = poets(rest, m.index, m.index + m[0].length);
    }

    // --- 2b. velden die bij naam genoemd worden ----------------------------
    //
    // VÓÓR de profielen en vóór de maatlezer, en dat moet: het getal hoort bij
    // de naam die ernaast staat, en als het blijft liggen pakt de maatlezer
    // het straks op als lengte of hoogte. Zie VELDNAMEN voor wat er misging.
    uit.velden = {};
    for (const [naam, direct, onderdeel, bijvoeglijk] of VELDNAMEN) {
        for (const re of veldPatronen(naam, direct, onderdeel, bijvoeglijk)) {
            for (const m of [...rest.matchAll(re)]) {
                // Het eerste niet-lege getal uit de match; welke groep dat is
                // verschilt per patroon.
                const g = m.slice(1).findIndex(v => v !== undefined && /^\d/.test(v));
                if (g < 0) continue;
                const waarde = naarMillimeter(m[g + 1], m[g + 2]);
                if (!Number.isFinite(waarde)) continue;
                uit.velden[naam] = waarde;
                gevonden.push(`${naam} ${waarde}`);
                rest = poets(rest, m.index, m.index + m[0].length);
            }
        }
    }

    // --- 3. profielen ------------------------------------------------------
    //
    // Een naam wordt alleen overgenomen als er PRECIES ÉÉN profiel op past, of
    // als één label er letterlijk aan gelijk is. "CHS 48,3" bestaat in zeven
    // wanddiktes; daar kiezen we er niet zomaar een van.
    for (const m of [...rest.matchAll(PROFIELNAAM)]) {
        if (GEEN_CODE.test(m[1])) continue;        // "van 300" is geen profiel
        // "maak HEM 200 hoger" is geen HEM 200. Dat werd het wel: na een trap
        // kreeg de leuning er stilletjes een H-balk als staander bij. Het
        // kleine woordje "hem" met een getal en dan een bijstelwoord is een
        // voornaamwoord; "HEM 200" als profielnaam blijft gewoon werken.
        if (m[1] === 'hem' && BIJSTELWOORD.test(rest.slice(m.index + m[0].length))) continue;
        const termen = [...new Set([
            (m[1] + m[2]).replace(/\s+/g, ''),
            (m[1] + m[2]).replace(/\s+/g, '').replace(/,/g, '.'),
        ])];
        let treffers = [];
        for (const t of termen) {
            treffers = voorraad.filter(p => pastBijZoekterm(p.label, t));
            if (treffers.length) break;
        }
        if (treffers.length === 0) continue;       // gewoon geen profiel

        const geschreven = m[0].trim();
        const plat = (s) => String(s).toLowerCase().replace(/\s+/g, '')
            .replace(/,/g, '.');
        const precies = treffers.filter(p => plat(p.label) === plat(geschreven));
        const keuze = precies.length === 1 ? precies[0]
            : treffers.length === 1 ? treffers[0] : null;

        if (!keuze) {
            // TWEE VERSCHILLENDE REDENEN om er geen te kiezen, en ze vragen om
            // verschillende hulp. Staat de naam maar half ("CHS 48,3"), dan
            // mist de wanddikte. Staat hij er helemaal ("SHS 20x20x2") en zijn
            // het er toch meerdere, dan bestaat diezelfde maat in meerdere
            // NORMEN - warm- en koudgevormd - en dat is niet hetzelfde
            // profiel. "Noem de wanddikte erbij" is dan onzin: die staat er.
            genegeerd.push(precies.length > 1
                ? `"${geschreven}" bestaat in ${precies.length} normen `
                    + `(${[...new Set(precies.map(p => normLabel(p.table)))].join(', ')}). `
                    + 'Kies hem in het profielvenster.'
                : `"${geschreven}" past op ${treffers.length} profielen `
                    + `(${treffers.slice(0, 3).map(p => p.label).join(', ')}…). `
                    + 'Noem de wanddikte erbij.');
            rest = poets(rest, m.index, m.index + m[0].length);
            continue;
        }

        // De norm hangt aan het profiel, net zoals de profielkiezer dat doet:
        // `alleProfielen` levert ze plat af, zonder de norm waar ze onder
        // hangen, en het scherm moet die wél kunnen tonen.
        const gekozen = { ...keuze, normLabel: normLabel(keuze.table) };
        const onderdeel = onderdeelBij(rest, m.index, m.index + m[0].length);
        if (onderdeel === null) {
            // NIET STIL KIEZEN, maar ook niet weggooien: de staander is het
            // profiel waar een leuning mee staat of valt, dus die wordt het -
            // en dat wordt er hardop bij gezegd.
            uit.profielen.staander = gekozen;
            gevonden.push(`${keuze.label} als staanderprofiel `
                + '(noem "spijl" of "handregel" als je iets anders bedoelt)');
        } else {
            uit.profielen[onderdeel] = gekozen;
            gevonden.push(`${keuze.label} als ${onderdeel}profiel`);
        }
        rest = poets(rest, m.index, m.index + m[0].length);
    }

    // --- 4. sierpunten -----------------------------------------------------
    const klein = rest.toLowerCase();
    const gezien = [];
    for (const { id, term } of PUNTTERMEN) {
        const re = new RegExp(`\\b${esc(term)}\\b`, 'g');
        for (const m of [...klein.matchAll(re)]) {
            // Een plek die al door een langere term is opgeslokt telt niet
            // nog een keer: "gelepelde punt" is één keus, geen twee.
            if (gezien.some(g => m.index < g.eind && g.begin < m.index + term.length)) {
                continue;
            }
            gezien.push({ id, begin: m.index, eind: m.index + term.length });
        }
    }
    for (const g of gezien) {
        const waar = onderdeelBij(rest, g.begin, g.eind);
        if (waar === 'spijl') {
            uit.spijlSierpunt = g.id;
            gevonden.push(`${g.id} op de spijlen`);
        } else {
            uit.sierpunt = g.id;
            gevonden.push(`${g.id} op de staanders`
                + (waar === null ? ' (noem "spijl" als je ze op de staven wilt)' : ''));
        }
        rest = poets(rest, g.begin, g.eind);
    }
    // Wel over een punt beginnen, maar geen model noemen dat bestaat.
    if (gezien.length === 0
        && /\b(sierpunt|sierpunten|paalkop|paalkoppen|ornament|punt op)\b/i.test(rest)) {
        genegeerd.push('Ik ken dat sierpunt niet. Kies uit: '
            + MODELLEN.map(m => m.id).join(', ') + '.');
    }
    // EEN PUNT OP DE SPIJLEN ZONDER OVERSTEK BOUWT NIETS, want dan zou hij in
    // de handregel staan. Dezelfde melding als in het paneel.
    if (uit.spijlSierpunt && !(uit.spijlOverstek > 0)) {
        genegeerd.push('Een punt op de spijlen heeft een spijloverstek nodig, '
            + 'anders staat hij in de handregel. Bijvoorbeeld "80 mm spijloverstek".');
    }

    // --- 4b. gedraaide balusters en dekbanden ------------------------------
    //
    // Deze twee staan bij elkaar omdat hun namen kunnen botsen: er is een
    // baluster "klassiek" én een dekband "klassiek". Wie de volledige naam
    // typt heeft geen probleem; wie alleen "klassiek" typt krijgt de vraag
    // terug in plaats van een gok.
    const klein2 = rest.toLowerCase();
    const balGezien = zoekModellen(klein2, BALUSTERTERMEN);
    const dekGezien = zoekModellen(klein2, DEKBANDTERMEN);
    const botst = (a, b) => a.begin < b.eind && b.begin < a.eind;

    for (const g of [...balGezien, ...dekGezien]) {
        const dubbel = balGezien.includes(g)
            ? dekGezien.find(d => botst(d, g))
            : balGezien.find(b => botst(b, g));
        const omheen = rest.slice(Math.max(0, g.begin - 30), g.eind + 30);
        const isBaluster = balGezien.includes(g);

        if (dubbel) {
            // Allebei de bibliotheken kennen dit woord. Dan telt wat eromheen
            // staat; staat daar niets, dan wordt er NIET geraden.
            const wil = BALUSTERWOORD.test(omheen) ? 'baluster'
                : DEKBANDWOORD.test(omheen) ? 'dekband' : null;
            if (!wil) {
                if (isBaluster) {           // één keer melden, niet twee
                    genegeerd.push(`"${g.term}" is zowel een baluster als een `
                        + 'dekband. Zeg erbij welke je bedoelt, bijvoorbeeld '
                        + '"klassieke vaasbaluster" of "klassieke dekband".');
                }
                continue;
            }
            if ((wil === 'baluster') !== isBaluster) continue;   // de andere doet het
        }

        if (isBaluster) {
            uit.spijlModel = g.id;
            gevonden.push(`${g.id} als balustervorm`);
        } else {
            uit.handregelModel = g.id;
            gevonden.push(`${g.id} als dekband`);
        }
        rest = poets(rest, g.begin, g.eind);
    }

    // EEN BALUSTER OP DE STANDAARDBREEDTE WORDT EEN BREINAALD. Met 20 mm komt
    // een klassieke vaasbaluster op 1 op 33 uit. Dat bouwt prima en is dus
    // geen fout, maar wie het niet weet krijgt iets anders dan hij bedoelde -
    // en in een getypte zin is er geen paneel dat het ernaast kan zeggen.
    if (uit.spijlModel && uit.velden.spijlBreedte === undefined) {
        genegeerd.push('Een gedraaide baluster wil een spijlbreedte van 80 à '
            + '120 mm; zonder die maat blijft hij op de standaard staan en '
            + 'wordt hij een breinaald. Noem er een, bijvoorbeeld '
            + '"spijlen van 100 breed".');
    }

    // --- 5. wat deze app niet kent -----------------------------------------
    //
    // MELDEN IS NIET GENOEG: HET GETAL MOET ER OOK UIT.
    //
    // Hier stond alleen een melding. Het getal bleef gewoon in de zin staan en
    // werd daarna door de maatlezer opgepikt: "balustrade van 2 meter met een
    // afwijking van 0,5 mm" leverde een leuning van 2000 lang en 0,5 hoog op.
    // De zelftest ving het - "en hij vervuilt de maten niet -> 2000 x 0.5" -
    // en dat is precies de stille vervuiling waar het wegpoetsen voor bestaat.
    // Een woord melden en zijn getal laten liggen is het slechtste van twee.
    let toleranties = 0;
    for (const m of [...rest.matchAll(TOLERANTIE)]) {
        toleranties++;
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    if (toleranties) {
        genegeerd.push('Een maatafwijking of tolerantie is geen instelling in '
            + 'deze app: de geometrie wordt op de nominale maat gebouwd.');
    }

    return { ...uit, rest, gevonden, genegeerd };
}

// --- de trap: bordes, treden, stootborden, platen, wandleuning ---------------
//
// Zelfde aanpak als leesExtras: eerst herkennen en wegpoetsen, dan pas maten
// lezen. "Een bordes van 1200 na stap 8" bevat twee getallen die anders de
// breedte van de trap en nog iets worden.

const NUM = '(\\d+(?:[.,]\\d+)?)\\s*(millimeter|centimeter|meter|mm|cm|m)?\\b';

// Wat er voor de treden genoemd kan worden, en welke tredesoort dat is. "Hout"
// zonder houtsoort staat erbij om het te kunnen VRAGEN in plaats van te raden.
const TREDEWOORDEN = [
    [/^traanplaat/, 'traanplaat'],
    [/^(rooster|grating)/, 'rooster'],
    [/^gla[sz]/, 'glas'],                  // glas, glazen
    [/^(natuursteen|natuurstenen|steen|stenen|marmer|graniet)/, 'steen'],
    [/^beton/, 'beton'],
    [/^eiken/, 'eiken'], [/^beuken/, 'beuken'], [/^vuren/, 'vuren'], [/^merbau/, 'merbau'],
    [/^(staalplaat|stalen|staal)/, 'staal'],
    [/^hout/, null],
];
const MATERIAAL = '(traanplaat|roosters?|grating|glazen|glas|natuurstenen|natuursteen|'
    + 'stenen|steen|marmer|graniet|betonnen|beton|eikenhouten|eikenhout|eiken|'
    + 'beukenhouten|beukenhout|beuken|vurenhouten|vurenhout|vuren|merbau|'
    + 'staalplaat|stalen|staal|houten|hout)';
// "eiken treden", "roostertreden", "glazen treden van 32 mm dik".
const TREDE_VOOR = new RegExp(`\\b${MATERIAAL}\\s?-?\\s?(?:trede|treden)\\b`
    + `(?:\\s+(?:van\\s+)?${NUM}\\s*dik\\w*)?`, 'gi');
// "treden van eiken", "treden uit beton".
// "houten trapbomen", "eiken bomen", "trapbomen van hout". Alleen met het
// woord boom of wang erbij: "eiken treden" gaat over de treden.
const BOOMHOUT = /\b(?:(houten|eiken|beuken|vuren|merbau)\s+(?:trap)?(?:bomen|boom|wangen)|(?:trap)?(?:bomen|boom|wangen)\s+(?:van|in|uit)\s+(hout|eiken|beuken|vuren|merbau))\b/gi;
const TREDE_NA = new RegExp(`\\b(?:trede|treden)\\s+(?:van|in|uit)\\s+(?:een\\s+|het\\s+)?`
    + `${MATERIAAL}\\b`, 'gi');
const TREDEDIKTE = [
    new RegExp(`\\btrede\\s?dikte\\s*(?:van|=|:)?\\s*${NUM}`, 'gi'),
    new RegExp(`\\btreden\\s+(?:van\\s+)?${NUM}\\s*dik\\w*`, 'gi'),
    new RegExp(`${NUM}\\s*dikke\\s+treden\\b`, 'gi'),
];

const BORDES_LENGTE = new RegExp(`\\bbordes(?:\\s?lengte)?\\s+(?:van\\s+)?${NUM}`
    + `(?:\\s+(?:lang|diep))?`, 'gi');
// De bovenvloer, voor het trapgat: "vloer van 300 mm dik", "vloerdikte 250",
// "een vloer van 30 cm".
const VLOERDIKTE = new RegExp(`\\b(?:vloer\\s?dikte|vloer)\\s+(?:van\\s+)?${NUM}(?:\\s+dik)?`, 'gi');
const BORDES_NA = /\bbordes\s+(?:na|bij|op)\s+(?:de\s+)?(?:stap|trede|optrede)?\s*(\d+)(?:e|de|ste)?(?:\s+(?:stap|stappen|trede|treden|optreden))?\b/gi;

// De soort trap, de draairichting en de diameter van een wenteltrap.
const SOORTZINNEN = [
    [/\b(?:wentel|spil|spiraal)trap(?:pen)?\b/gi, 'wentel'],
    [/\b(?:kwartslag\w*|hoektrap|l-trap|l-vormige?)\b/gi, 'kwartslag'],
    [/\b(?:halfslag\w*|u-trap|u-vormige?)\b/gi, 'halfslag'],
];
const DRAAIZIN = /\b(linksom|rechtsom|linksdraaiend|rechtsdraaiend)\b|\bdraai\w*\s+(?:naar\s+)?(links|rechts)\b|\b(?:naar\s+)?(links|rechts)\s+draai\w*\b/gi;
const DIAMETERZINNEN = [
    new RegExp(`(?:\\bdiameter|\\bdoorsnede|Ø)\\s*(?:van\\s+)?${NUM}`, 'gi'),
    new RegExp(`${NUM}\\s*(?:diameter|doorsnede)\\b`, 'gi'),
];

const STOOTBORDEN = /\b(?:zonder\s+stootborden?|met\s+stootborden?|stootborden?|gesloten\s+trap|dichte\s+trap|open\s+trap)\b/gi;
const PLATEN = /\b(?:voet-?\s*en\s*kop\s?platen|voet\s?platen|voet\s?plaat|kop\s?platen|kop\s?plaat|anker\s?platen)\b/gi;
const WANDLEUNING = /\b(?:(links|rechts)\s+(?:een\s+)?(?:wand|muur)\s?leuning|(?:wand|muur)\s?leuning(?:\s+(?:aan\s+de\s+|op\s+de\s+)?(links|rechts)(?:kant)?)?)\b/gi;

/**
 * Leest wat een trap méér kan dan hoogte, breedte en leuning.
 *
 * @returns { rest, maten, keuzes, wandKant, gevonden, genegeerd }
 *   maten   velden van het trappaneel (tredeDikte, bordesNa, bordesLengte)
 *   keuzes  tredeMateriaal, stootborden, platen
 *   wandKant 'links', 'rechts', '?' (wel genoemd, kant onbekend) of undefined
 */
function leesTrapExtras(tekst) {
    // Een tussenbordes is een bordes; zelfde lengte, zodat alle posities kloppen.
    let rest = tekst.replace(/tussen(bordes)/gi, '      $1');
    const maten = {}, keuzes = {}, gevonden = [], genegeerd = [];
    let wandKant;

    // De soort trap en de draairichting.
    for (const [re, soort] of SOORTZINNEN) {
        for (const m of [...rest.matchAll(re)]) {
            keuzes.soort = soort;
            rest = poets(rest, m.index, m.index + m[0].length);
        }
    }
    for (const m of [...rest.matchAll(DRAAIZIN)]) {
        keuzes.draai = /links/i.test(m[0]) ? 'links' : 'rechts';
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    for (const re of DIAMETERZINNEN) {
        for (const m of [...rest.matchAll(re)]) {
            maten.diameter = naarMillimeter(m[1], m[2]);
            rest = poets(rest, m.index, m.index + m[0].length);
        }
    }
    if (keuzes.soort) {
        gevonden.push({ wentel: 'wenteltrap', kwartslag: 'kwartslag (L)',
                        halfslag: 'halfslag (U)' }[keuzes.soort]
            + (keuzes.draai ? `, draait naar ${keuzes.draai}` : ''));
    }
    if (maten.diameter !== undefined) gevonden.push(`diameter ${maten.diameter} mm`);

    // De trapbomen van hout. VOOR de treden, zodat "eiken trapbomen" niet als
    // eiken treden gelezen wordt.
    let boomWoord;
    for (const m of [...rest.matchAll(BOOMHOUT)]) {
        boomWoord = (m[1] || m[2]).toLowerCase();
        rest = poets(rest, m.index, m.index + m[0].length);
    }

    // De treden.
    let materiaalWoord, dikte;
    for (const re of [TREDE_VOOR, TREDE_NA]) {
        for (const m of [...rest.matchAll(re)]) {
            materiaalWoord = m[1].toLowerCase();
            if (m[2] !== undefined && re === TREDE_VOOR) dikte = naarMillimeter(m[2], m[3]);
            rest = poets(rest, m.index, m.index + m[0].length);
        }
    }
    for (const re of TREDEDIKTE) {
        for (const m of [...rest.matchAll(re)]) {
            dikte = naarMillimeter(m[1], m[2]);
            rest = poets(rest, m.index, m.index + m[0].length);
        }
    }
    if (materiaalWoord !== undefined) {
        const [, soort] = TREDEWOORDEN.find(([re]) => re.test(materiaalWoord)) || [];
        if (soort === null || soort === undefined) {
            genegeerd.push('Welk hout voor de treden? Kies eiken, beuken, vuren of merbau.');
        } else {
            keuzes.tredeMateriaal = soort;
            gevonden.push(`treden: ${tredeSoortVan(soort).naam}`);
            // Een soort brengt zijn eigen dikte mee, net als in het paneel.
            if (dikte === undefined) maten.tredeDikte = tredeSoortVan(soort).dikte;
        }
    }
    if (dikte !== undefined) {
        maten.tredeDikte = dikte;
        gevonden.push(`trededikte ${dikte} mm`);
    }
    // "Houten" zonder soort: dan dezelfde houtsoort als de treden, en anders
    // eiken.
    if (boomWoord !== undefined) {
        const houtTrede = ['eiken', 'beuken', 'vuren', 'merbau'].includes(keuzes.tredeMateriaal)
            ? keuzes.tredeMateriaal : 'eiken';
        keuzes.boomMateriaal = /^hout/.test(boomWoord) ? houtTrede : boomWoord;
        gevonden.push(`trapbomen van ${keuzes.boomMateriaal}`);
    }

    // Het bordes. EERST de lengte, en daarbij blijft het woord "bordes" staan:
    // "een bordes van 1200 na stap 8" heeft het nog nodig voor de stap.
    for (const m of [...rest.matchAll(VLOERDIKTE)]) {
        maten.vloerdikte = naarMillimeter(m[1], m[2]);
        gevonden.push(`vloer ${maten.vloerdikte} mm dik`);
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    for (const m of [...rest.matchAll(BORDES_LENGTE)]) {
        maten.bordesLengte = naarMillimeter(m[1], m[2]);
        gevonden.push(`bordes ${maten.bordesLengte} mm lang`);
        rest = rest.slice(0, m.index) + 'bordes'.padEnd(m[0].length)
            + rest.slice(m.index + m[0].length);
    }
    for (const m of [...rest.matchAll(BORDES_NA)]) {
        maten.bordesNa = parseInt(m[1], 10);
        gevonden.push(`bordes na stap ${maten.bordesNa}`);
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    if (/\bbordes\b/i.test(rest) && maten.bordesNa === undefined) {
        maten.bordesNa = 'midden';          // wordt hieronder uitgerekend
    }
    rest = rest.replace(/\bbordes\b/gi, (w) => ' '.repeat(w.length));

    // Stootborden.
    for (const m of [...rest.matchAll(STOOTBORDEN)]) {
        keuzes.stootborden = !/zonder|open/i.test(m[0]);
        gevonden.push(keuzes.stootborden ? 'met stootborden' : 'zonder stootborden');
        rest = poets(rest, m.index, m.index + m[0].length);
    }

    // Voet- en kopplaten. Altijd allebei: zo staat het ook in het paneel.
    for (const m of [...rest.matchAll(PLATEN)]) {
        keuzes.platen = true;
        rest = poets(rest, m.index, m.index + m[0].length);
    }
    if (keuzes.platen) gevonden.push('voet- en kopplaten');

    // De wandleuning, VÓÓR de gewone leuning gezocht wordt: "leuning rechts en
    // een wandleuning links" mag de rechterkant niet aan de muur hangen.
    for (const m of [...rest.matchAll(WANDLEUNING)]) {
        wandKant = (m[1] || m[2] || '?').toLowerCase();
        rest = poets(rest, m.index, m.index + m[0].length);
    }

    return { rest, maten, keuzes, wandKant, gevonden, genegeerd };
}

/** Zet "2,5 m" om naar 2500 (millimeter). */
function naarMillimeter(getal, eenheid) {
    const waarde = parseFloat(getal.replace(',', '.'));
    const factor = eenheid ? EENHEDEN[eenheid.toLowerCase()] : 1;
    return waarde * factor;
}

/** Alle getallen in de zin, op volgorde, met hun positie. */
function vindGetallen(tekst) {
    const gevonden = [];
    for (const m of tekst.matchAll(GETAL)) {
        gevonden.push({
            mm: naarMillimeter(m[1], m[2]),
            begin: m.index,
            eind: m.index + m[0].length,
        });
    }
    return gevonden;
}

/**
 * Koppelt getallen aan maatwoorden, bijvoorbeeld "2 meter lang" of
 * "hoogte 1000". We kijken in beide richtingen, want allebei komt voor.
 */
function koppelMaten(tekst, getallen) {
    const maten = {};
    const gebruikt = new Set();

    for (const [woord, maat] of Object.entries(MAATWOORDEN)) {
        // het woord als los woord zoeken, niet als deel van een ander woord
        const re = new RegExp(`\\b${woord}\\b`, 'gi');
        for (const m of tekst.matchAll(re)) {
            const positie = m.index;

            // het dichtstbijzijnde nog ongebruikte getal, binnen redelijke afstand
            let beste = null;
            let besteAfstand = Infinity;
            for (let i = 0; i < getallen.length; i++) {
                if (gebruikt.has(i)) continue;
                const g = getallen[i];
                // afstand tot het woord, of het getal er nu voor of na staat
                const afstand = g.eind <= positie ? positie - g.eind : g.begin - (positie + woord.length);
                if (afstand >= 0 && afstand < besteAfstand && afstand <= 12) {
                    besteAfstand = afstand;
                    beste = i;
                }
            }
            if (beste !== null && maten[maat] === undefined) {
                maten[maat] = getallen[beste].mm;
                gebruikt.add(beste);
            }
        }
    }

    const vrij = getallen.filter((_, i) => !gebruikt.has(i)).map(g => g.mm);
    return { maten, vrij };
}

function vindVorm(tekst) {
    for (const vorm of VORMEN) {
        for (const woord of vorm.woorden) {
            if (new RegExp(`\\b${woord}`, 'i').test(tekst)) return vorm.actie;
        }
    }
    return null;
}

// Bijstelwoorden voor een vervolgopdracht: "maak hem 200 hoger". Per soort
// staat hier welke maat eraan moet en of hij omhoog of omlaag gaat.
const BIJSTELLEN = {
    hoger: ['hoogte', +1], lager: ['hoogte', -1],
    hoogher: ['hoogte', +1],                       // veelgemaakte typefout
    breder: ['breedte', +1], smaller: ['breedte', -1],
    dieper: ['diepte', +1], ondieper: ['diepte', -1],
    langer: ['lengte', +1], korter: ['lengte', -1],
    dikker: ['dikte', +1], dunner: ['dikte', -1],
};

// Welke maat een bijstelwoord raakt, per soort. Bij een balustrade is 'langer'
// de lengte; bij een blok is er geen lengte, dus valt dat op de breedte.
const BIJSTEL_DOEL = {
    blok: { hoogte: 'hoogte', breedte: 'breedte', diepte: 'diepte', lengte: 'breedte' },
    balustrade: { hoogte: 'hoogte', lengte: 'lengte', breedte: 'lengte' },
    trap: { hoogte: 'hoogte', breedte: 'breedte', lengte: 'hoogte' },
};

const STANDAARD_STAP = 100; // als er geen maat bij staat

// Staat er direct een bijstelwoord achter? Zie "maak hem 200 hoger" bij de
// profielen.
const BIJSTELWOORD = new RegExp(`^\\s*(?:mm|cm|m|millimeter|centimeter|meter)?\\s*`
    + `(?:${Object.keys(BIJSTELLEN).join('|')})\\b`, 'i');

/**
 * Ontleedt een zin.
 *
 * @param invoer  de getypte zin
 * @param vorige  de vorige gelukte opdracht, voor zinnen als "maak hem hoger"
 * @returns {{actie, params, uitleg}} bij succes,
 *          {{fout, tip}} als de zin niet te begrijpen is.
 */
export function parseer(invoer, vorige = null, opties = {}) {
    const ruw = (invoer || '').trim();
    if (!ruw) return { fout: 'Lege opdracht.' };

    // EERST de extra's eruit halen en wegpoetsen; zie leesExtras hierboven.
    // Wat overblijft gaat naar de maatherkenning die er altijd al was.
    const extra = leesExtras(ruw, opties.profielen || []);
    let tekst = extra.rest;

    /** Wat er in de maten van een balustrade terechtkomt. */
    const extraMaten = {};
    if (extra.vervolg !== undefined) extraMaten.vervolg = extra.vervolg;
    if (extra.spijlOverstek !== undefined) extraMaten.spijlOverstek = extra.spijlOverstek;
    if (extra.handregelOverstek !== undefined) {
        extraMaten.handregelOverstek = extra.handregelOverstek;
    }
    if (extra.spijlModel !== undefined) extraMaten.spijlModel = extra.spijlModel;
    if (extra.vulling !== undefined) extraMaten.vulling = extra.vulling;
    if (extra.handregelModel !== undefined) {
        extraMaten.handregelModel = extra.handregelModel;
    }
    if (extra.handregelHout !== undefined) extraMaten.handregelHout = extra.handregelHout;
    // Velden die bij naam genoemd zijn gaan er zo in; ze hebben hun eigen naam
    // dus er valt niets te raden.
    Object.assign(extraMaten, extra.velden || {});

    /** De extra's aan een geslaagd antwoord hangen, inclusief wat er niet kon. */
    const metExtras = (r) => ({
        ...r,
        profielen: extra.profielen,
        // De coatkleur geldt voor het hele werk, net als in het paneel:
        // undefined = niet genoemd, '' = blank, anders een RAL-nummer.
        afwerking: extra.afwerking,
        // Het metaal en verzinken, ook voor het hele werk. undefined = niet
        // genoemd.
        metaal: extra.metaal,
        verzinken: extra.verzinken,
        sierpunt: extra.sierpunt,
        spijlSierpunt: extra.spijlSierpunt,
        genegeerd: extra.genegeerd,
        uitleg: extra.gevonden.length
            ? `${r.uitleg}; ${extra.gevonden.join('; ')}` : r.uitleg,
    });

    // De vorm uit de ONGEPOETSTE zin: vormwoorden bevatten geen getallen, dus
    // daar kan het poetsen niets aan veranderd hebben - en als een profielnaam
    // toevallig over "blok" heen zou vallen, zou de zin ineens niets meer zijn.
    const vorm = vindVorm(ruw);

    // Geen vorm genoemd? Dan kan het een vervolgopdracht zijn op wat er al staat.
    if (!vorm) {
        const bijgesteld = probeerBijstellen(ruw, vorige);
        if (bijgesteld) return metExtras(bijgesteld);
        // Geen vormwoord en geen bijstelwoord, maar wel iets begrepen: dan gaat
        // het over wat er al staat. "zet er een speerpunt op de spijlen op."
        if (vorige && vorige.actie && vorige.params && extra.gevonden.length) {
            return metExtras({
                actie: vorige.actie,
                params: vorige.actie === 'balustrade'
                    ? { ...vorige.params, ...extraMaten } : { ...vorige.params },
                leuning: vorige.leuning,
                uitleg: `${vorige.actie} blijft zoals hij was`,
            });
        }
    }

    if (!vorm) {
        return {
            fout: 'Ik herken geen vorm in die zin.',
            tip: vorige
                ? 'Noem een kubus, blok, balustrade of trap. Of stel de vorige bij, '
                    + 'bijvoorbeeld "maak hem 200 hoger".'
                : 'Noem een kubus, blok, balustrade of trap. Bijvoorbeeld: '
                    + '"maak een blok van 300 bij 200 bij 150".',
        };
    }

    // Bij een trap eerst wat een trap méér kan, zodat die getallen er al uit
    // zijn voor de maatlezer begint. Zie leesTrapExtras.
    const trapExtra = vorm === 'trap' ? leesTrapExtras(tekst) : null;
    if (trapExtra) tekst = trapExtra.rest;

    const getallen = vindGetallen(tekst);
    // Geen maat meer over, maar wel iets anders begrepen? Dan is de zin niet
    // onbegrepen. Een balustrade valt terug op de standaardmaten uit
    // regels.json; voor een blok of een trap is er geen zinnige standaard, dus
    // daar blijft het wél een fout.
    if (getallen.length === 0
        && !(vorm === 'balustrade' && extra.gevonden.length > 0)) {
        return {
            fout: 'Ik zie geen maten in die zin.',
            tip: 'Geef er getallen bij, bijvoorbeeld "kubus van 300 mm".',
        };
    }

    const { maten, vrij } = koppelMaten(tekst, getallen);

    if (vorm === 'trap') {
        const rest = [...vrij];
        const hoogte = maten.hoogte ?? rest.shift();
        const breedte = maten.breedte ?? rest.shift() ?? TRAP_STANDAARD.breedte;

        if (hoogte === undefined) {
            return {
                fout: 'Ik heb de hoogte nodig voor een trap.',
                tip: 'Bijvoorbeeld "trap van 3 meter hoog".',
            };
        }

        // "met leuning" mag erbij, en dan links, rechts of beide.
        let leuning = 'geen';
        if (/\bleuning|\bbalustrade|\breling/i.test(tekst)) {
            if (/\blinks\b/i.test(tekst)) leuning = 'links';
            else if (/\brechts\b/i.test(tekst)) leuning = 'rechts';
            else leuning = 'beide';
        }

        const { maten: trapMaten, keuzes, gevonden, genegeerd } = trapExtra;

        // "met een bordes" zonder stap: halverwege. Dat is een keuze, dus hij
        // staat er in de uitleg bij.
        if (trapMaten.bordesNa === 'midden') {
            trapMaten.bordesNa = Math.round(berekenTrap({ hoogte }).optreden / 2);
            gevonden.push(`bordes halverwege, na stap ${trapMaten.bordesNa}`);
        }
        if (trapMaten.bordesNa && trapMaten.bordesLengte === undefined) {
            trapMaten.bordesLengte = TRAP_STANDAARD.bordesLengte;
        }

        // De wandleuning hoort aan de kant ZONDER leuning. Wordt de kant niet
        // genoemd, dan volgt hij uit de leuning - maar alleen als dat eenduidig
        // is. Anders vragen, niet raden.
        let wandleuning = 'geen';
        const vrijeKant = { links: 'rechts', rechts: 'links' }[leuning];
        if (trapExtra.wandKant === '?') {
            if (vrijeKant) {
                wandleuning = vrijeKant;
            } else {
                genegeerd.push(leuning === 'beide'
                    ? 'Er staat aan beide kanten al een leuning; voor een wandleuning is geen plek.'
                    : 'Aan welke kant hangt de wandleuning? Zeg "wandleuning links" of "rechts".');
            }
        } else if (trapExtra.wandKant) {
            wandleuning = trapExtra.wandKant;
        }
        if (wandleuning !== 'geen') gevonden.push(`wandleuning ${wandleuning}`);

        // WAT ER VOOR DE LEUNING GEZEGD IS gaat mee naar het balustradepaneel:
        // die leuning wordt met de balustradematen gebouwd. Zonder dit verdween
        // "80 mm spijloverstek" in een trapzin zonder dat iemand het zag.
        return {
            ...metExtras({
                actie: 'trap',
                params: {
                    ...TRAP_STANDAARD, hoogte, breedte, ...trapMaten,
                    soort: keuzes.soort || 'recht',
                    draai: keuzes.draai || 'rechts',
                    tredeMateriaal: keuzes.tredeMateriaal || 'staal',
                    boomMateriaal: keuzes.boomMateriaal || 'staal',
                    stootborden: Boolean(keuzes.stootborden),
                    platen: Boolean(keuzes.platen),
                    wandleuning,
                },
                leuning,
                uitleg: `trap ${fmt(hoogte)} hoog, ${fmt(breedte)} breed`
                    + (leuning === 'geen' ? '' : `, leuning ${leuning}`)
                    + (gevonden.length ? `; ${gevonden.join('; ')}` : ''),
            }),
            leuningMaten: extraMaten,
            genegeerd: [...extra.genegeerd, ...genegeerd],
        };
    }

    if (vorm === 'kubus') {
        // Een kubus heeft maar één maat nodig.
        const zijde = maten.breedte ?? maten.hoogte ?? maten.diepte ?? maten.lengte ?? vrij[0];
        return metExtras({
            actie: 'blok',
            params: { breedte: zijde, diepte: zijde, hoogte: zijde },
            uitleg: `kubus met ribbe ${fmt(zijde)}`,
        });
    }

    if (vorm === 'blok') {
        // "een balk van 1 meter lang": voor een blok is 'lang' gewoon de eerste
        // maat. Het onderscheid tussen lengte en breedte heeft hier geen zin.
        if (maten.breedte === undefined && maten.lengte !== undefined) {
            maten.breedte = maten.lengte;
        }

        // Eerst de maten die met een woord benoemd zijn, de rest op volgorde:
        // breedte, diepte, hoogte. Bij één getal wordt het een kubus.
        const rest = [...vrij];
        const pak = (naam) => maten[naam] ?? rest.shift();
        let breedte = pak('breedte');
        let diepte = pak('diepte');
        let hoogte = pak('hoogte');

        if (breedte !== undefined && diepte === undefined && hoogte === undefined) {
            diepte = hoogte = breedte; // "blok van 300" -> kubus
        }
        if ([breedte, diepte, hoogte].some(v => v === undefined)) {
            return {
                fout: 'Ik heb drie maten nodig voor een blok.',
                tip: 'Bijvoorbeeld "blok van 300 bij 200 bij 150", of '
                    + '"blok van 300 breed, 200 diep en 150 hoog".',
            };
        }
        return metExtras({
            actie: 'blok',
            params: { breedte, diepte, hoogte },
            uitleg: `blok ${fmt(breedte)} × ${fmt(diepte)} × ${fmt(hoogte)}`,
        });
    }

    // balustrade
    const rest = [...vrij];
    const lengte = maten.lengte ?? maten.breedte ?? rest.shift() ?? STANDAARD.lengte;
    const hoogte = maten.hoogte ?? rest.shift() ?? STANDAARD.hoogte;

    const params = { ...STANDAARD, lengte, hoogte, ...extraMaten };
    if (maten.diepte !== undefined) params.spijlBreedte = maten.diepte;

    return metExtras({
        actie: 'balustrade',
        params,
        uitleg: `balustrade ${fmt(lengte)} lang, ${fmt(hoogte)} hoog`,
    });
}

/**
 * Een vervolgopdracht: "maak hem 200 hoger", "breder", "iets korter".
 *
 * Werkt alleen als er al iets gemaakt is. Zonder maat erbij wordt er
 * 100 mm gebruikt - en dat wordt er wel bij gezegd, zodat je niet hoeft te
 * raden wat er gebeurd is.
 *
 * Dit is precies het soort zin waar een taalmodel goed in zou zijn. Deze versie
 * kent alleen de woorden uit de lijst hierboven; "maak hem wat gedrongener"
 * begrijpt hij niet.
 */
function probeerBijstellen(tekst, vorige) {
    if (!vorige || !vorige.actie || !vorige.params) return null;

    for (const [woord, [maat, teken]] of Object.entries(BIJSTELLEN)) {
        if (!new RegExp(`\\b${woord}\\b`, 'i').test(tekst)) continue;

        const doel = (BIJSTEL_DOEL[vorige.actie] || {})[maat];
        if (!doel || vorige.params[doel] === undefined) {
            return {
                fout: `Een ${vorige.actie} heeft geen ${maat} om bij te stellen.`,
                tip: 'Probeer bijvoorbeeld "maak hem 200 hoger".',
            };
        }

        const getallen = vindGetallen(tekst);
        const stap = getallen.length ? getallen[0].mm : STANDAARD_STAP;
        const nieuw = vorige.params[doel] + teken * stap;

        if (nieuw <= 0) {
            return {
                fout: `Dat zou de ${doel} op ${fmt(nieuw)} brengen.`,
                tip: 'Kies een kleinere stap.',
            };
        }

        return {
            actie: vorige.actie,
            params: { ...vorige.params, [doel]: nieuw },
            leuning: vorige.leuning,
            uitleg: `${doel} van ${fmt(vorige.params[doel])} naar ${fmt(nieuw)}`
                + (getallen.length ? '' : ` (${STANDAARD_STAP} mm, want je noemde geen maat)`),
        };
    }

    return null;
}

function fmt(mm) {
    if (mm === undefined) return '?';
    return Number.isInteger(mm) ? `${mm} mm` : `${mm.toFixed(1)} mm`;
}
