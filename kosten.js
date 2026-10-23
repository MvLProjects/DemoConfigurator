// Wat het ongeveer kost: hoeveelheid maal tarief, met een bandbreedte.
//
// WAAROM ER OVERAL EEN BEREIK STAAT EN GEEN BEDRAG. De hoeveelheden kent deze
// app precies - het staalgewicht komt uit het echte volume van elk onderdeel
// en het te coaten oppervlak uit het echte oppervlak, allebei door OCCT
// gemeten. De TARIEVEN kent hij niet. Die zijn op internet opgezocht, lopen
// per bron uiteen en veranderen per maand.
//
// Eén hard bedrag neerzetten zou die twee door elkaar halen: het zou er net zo
// zeker uitzien als het aantal spijlen, en dat is het niet. Daarom staat er
// een ondergrens en een bovengrens, met bij elke post de bron erbij. Vult
// iemand in tarieven.json zijn EIGEN prijs in, dan verdwijnt het bereik voor
// die post - dan is het geen schatting meer.
//
// WAT ER NIET IN ZIT: arbeid, transport, montage, keuring, tekenwerk en winst.
// Het arbeidstarief staat op nul omdat er geen getal voor gevonden is. Een
// totaal zonder arbeid is een MATERIAALBEGROTING en geen kostprijs, en dat
// zegt deze code er ook bij - zie `volledig`.

import { materiaalVanDeel, magCoaten, materiaalVan } from './materialen.js';
// DEZELFDE REGEL ALS DE ZAAGLIJST voor "wordt dit gekocht of gemaakt?". Hier
// stond eerst `deel.besteld`, en dat is net iets anders: een ruit draagt geen
// vlaggetje maar is besteld OMDAT hij van glas is. Het gevolg was dat de ruit
// uit de kostenraming viel terwijl zijn 24 klemmen er wel in stonden - een
// begroting met het duurste onderdeel eruit. Twee plekken die dezelfde vraag
// anders beantwoorden lopen altijd een keer uit de pas; nu is het één plek.
import { wordtBesteld } from './zaaglijst.js';

let TARIEVEN = null;

/** De tarieven inlezen. Eén keer; daarna uit het geheugen. */
export async function laadTarieven(url = './tarieven.json') {
    if (TARIEVEN) return TARIEVEN;
    const antwoord = await fetch(url);
    if (!antwoord.ok) {
        throw new Error(`tarieven.json niet te lezen (status ${antwoord.status})`);
    }
    TARIEVEN = await antwoord.json();
    return TARIEVEN;
}

/** Alleen voor de zelftest: tarieven injecteren zonder te hoeven ophalen. */
export function zetTarieven(t) {
    TARIEVEN = t;
}

/**
 * Het bereik van één post: [laag, hoog].
 *
 * Staat er een eigen prijs, dan is dat allebei hetzelfde getal - dan is het
 * geen schatting meer maar wat jullie betalen.
 */
export function bereikVan(post) {
    if (!post) return null;
    if (post.eigen !== null && post.eigen !== undefined && post.eigen !== '') {
        const v = Number(post.eigen);
        if (Number.isFinite(v)) return { laag: v, hoog: v, eigen: true };
    }
    const laag = Number(post.laag) || 0;
    const hoog = Number(post.hoog) || 0;
    if (laag === 0 && hoog === 0) return null;      // onbekend is niet nul
    return { laag, hoog, eigen: false };
}

/**
 * De hoeveelheden uit een gebouwd model.
 *
 * ALLES UIT DE GEMETEN GEOMETRIE. Het gewicht komt uit het volume maal de
 * dichtheid van staal, en niet uit de GEW-kolom van de catalogus - die kent
 * alleen profielen, en een voetplaat of een uitgeklonken staander staat er
 * niet in. Zo telt alles mee wat er echt staat.
 *
 * @param onderdelen  wat groepeerVormen teruggeeft: [{ deel, aantal, kenmerken }]
 * @returns { staalKg, coatM2, besteld: {soort: aantal}, m2: {soort: m2},
 *            glasM2, onbekend: [] }
 */
export function hoeveelheden(onderdelen, dichtheidStaal = 7850) {
    const uit = { staalKg: 0, coatM2: 0, besteld: {}, m2: {}, glasM2: 0, onbekend: [] };

    for (const o of onderdelen) {
        const aantal = o.aantal || 1;
        const k = o.kenmerken || {};
        const materiaal = materiaalVanDeel(o.deel);

        // Geen gemeten vorm, geen getal. Liever melden dat er iets buiten de
        // telling valt dan het stilletjes op nul zetten.
        if (!(k.volume > 0)) {
            uit.onbekend.push(o.deel.soort);
            continue;
        }

        if (wordtBesteld(o.deel)) {
            // Een trede heeft een eigen bestelsoort per materiaal: een glazen
            // en een stenen trede komen van een andere leverancier en hebben
            // een andere prijs. Zonder die sleutel stonden ze op één regel.
            const soort = o.deel.bestelSoort || o.deel.soort;
            uit.besteld[soort] = (uit.besteld[soort] || 0) + aantal;
            // Glas gaat per vierkante meter, niet per stuk. De ruit is plat,
            // dus de helft van zijn oppervlak is één kant. Bij een trede is
            // het het loopvlak: aantrede maal breedte.
            const m2 = o.deel.soort === 'ruit' ? (k.oppervlak / 2) / 1e6
                : (o.deel.dx * o.deel.dy) / 1e6;
            uit.m2[soort] = (uit.m2[soort] || 0) + m2 * aantal;
            if (o.deel.soort === 'ruit') uit.glasM2 += m2 * aantal;
            continue;           // gekocht werk weegt niet mee als eigen staal
        }

        // Traanplaat is ook staal; hij weegt gewoon mee.
        if (materiaalVan(materiaal).soort === 'metaal') {
            uit.staalKg += k.volume / 1e9 * dichtheidStaal * aantal;
        }
        // COATEN GEBEURT ALLEEN ALS ER EEN KLEUR GEKOZEN IS. Zonder afwerking
        // is er niets te coaten en hoort er ook niets voor gerekend te worden.
        if (o.deel.afwerking && magCoaten(o.deel)) {
            uit.coatM2 += k.oppervlak / 1e6 * aantal;
        }
    }
    return uit;
}

const rond = (v) => Math.round(v * 100) / 100;

/**
 * De kostenraming.
 *
 * @param onderdelen  uit groepeerVormen
 * @param opties.stralen  wordt er apart gestraald? Sommige coaterijen hebben
 *                        het in hun prijs zitten; dan telt het dubbel.
 * @returns {{
 *   regels: Array, laag, hoog, volledig: boolean, ontbreekt: Array,
 *   controle: {laag, hoog}|null, hoeveelheden
 * }}
 */
export function berekenKosten(onderdelen, opties = {}) {
    if (!TARIEVEN) throw new Error('De tarieven zijn nog niet ingelezen.');
    const h = hoeveelheden(onderdelen, TARIEVEN.dichtheid.staal);
    const regels = [];
    const ontbreekt = [];

    /** Eén regel toevoegen; zonder tarief komt hij er WEL in, maar zonder bedrag. */
    const voeg = (sleutel, post, hoeveelheid, eenheid) => {
        if (!(hoeveelheid > 0)) return;
        const bereik = bereikVan(post);
        if (!bereik) {
            // GEEN STILLE NUL. Een post zonder tarief hoort zichtbaar te
            // blijven: hij kost wél iets, we weten alleen niet hoeveel. Hem
            // weglaten zou het totaal te laag maken zonder dat iemand het ziet.
            regels.push({ sleutel, naam: post ? post.naam : sleutel,
                          hoeveelheid: rond(hoeveelheid), eenheid,
                          laag: null, hoog: null, tarief: null });
            ontbreekt.push(post ? post.naam : sleutel);
            return;
        }
        regels.push({
            sleutel, naam: post.naam, hoeveelheid: rond(hoeveelheid), eenheid,
            laag: rond(hoeveelheid * bereik.laag),
            hoog: rond(hoeveelheid * bereik.hoog),
            tarief: bereik, bron: post.bron || '',
        });
    };

    const p = TARIEVEN.posten;
    voeg('staal', p.staal, h.staalKg, 'kg');
    voeg('coating', p.coating, h.coatM2, 'm2');
    if (opties.stralen) voeg('stralen', p.stralen, h.coatM2, 'm2');

    for (const [soort, aantal] of Object.entries(h.besteld)) {
        const post = TARIEVEN.besteld[soort];
        if (!post) { ontbreekt.push(soort); continue; }
        // Glas gaat per vierkante meter, de rest per stuk.
        const hoeveel = post.eenheid === 'm2' ? (h.m2[soort] || 0) : aantal;
        voeg('besteld:' + soort, post, hoeveel, post.eenheid);
    }

    // Arbeid staat altijd op de lijst, ook als hij nul is. Juist dan: een
    // totaal waar arbeid niet in zit moet dat láten zien.
    const arbeidUur = Number(opties.arbeidUur) || 0;
    if (arbeidUur > 0) voeg('arbeid', p.arbeid, arbeidUur, 'uur');

    const laag = regels.reduce((s, r) => s + (r.laag || 0), 0);
    const hoog = regels.reduce((s, r) => s + (r.hoog || 0), 0);

    // Het controlegetal: dezelfde kilo's tegen een prijs voor een AFGEWERKTE
    // constructie. Die twee horen niet gelijk uit te komen; zie tarieven.json.
    const cb = bereikVan(TARIEVEN.controle);
    const controle = cb && h.staalKg > 0
        ? { laag: rond(h.staalKg * cb.laag), hoog: rond(h.staalKg * cb.hoog),
            naam: TARIEVEN.controle.naam, bron: TARIEVEN.controle.bron || '' }
        : null;

    return {
        regels,
        laag: rond(laag),
        hoog: rond(hoog),
        // VOLLEDIG BETEKENT: elke post die er staat heeft een tarief, én er is
        // arbeid ingevuld. Zo niet, dan is dit een materiaalbegroting en geen
        // kostprijs, en hoort het scherm dat te zeggen.
        volledig: ontbreekt.length === 0 && arbeidUur > 0,
        ontbreekt: [...new Set(ontbreekt)],
        controle,
        hoeveelheden: {
            staalKg: rond(h.staalKg), coatM2: rond(h.coatM2),
            glasM2: rond(h.glasM2), besteld: h.besteld,
            onbekend: [...new Set(h.onbekend)],
        },
        gezien: TARIEVEN.gezien || '',
    };
}

/** Een bedrag zoals het op het scherm hoort: "€ 1.234,50". */
export function euro(v) {
    return '€ ' + Number(v).toLocaleString('nl-NL',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Een bereik als tekst: één bedrag als het vast is, anders "van - tot".
 *
 * Een vast bedrag en een geschat bedrag horen er VERSCHILLEND uit te zien.
 * Staat er "€ 142,50" waar een schatting bedoeld is, dan leest iemand dat als
 * een prijs.
 */
export function bereikTekst(laag, hoog) {
    if (laag === null || hoog === null) return 'tarief niet ingevuld';
    if (Math.abs(hoog - laag) < 0.005) return euro(laag);
    return `${euro(laag)} – ${euro(hoog)}`;
}
