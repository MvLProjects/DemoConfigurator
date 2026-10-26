// Waar een onderdeel VAN gemaakt is.
//
// Tot nu toe was alles staal, en stond er over materiaal alleen een staalsoort
// in de stuklijst - een tekstje dat verder niets deed. Een houten trede heeft
// meer nodig: hij moet in de stuklijst anders heten, en je moet in het beeld
// kunnen zien dat het geen staal is.
//
// WAAROM EEN EIGEN BESTAND. Drie plekken hebben dit nodig en ze mogen het niet
// elk apart gaan bedenken: de bouwer (welke kleur krijgt dit onderdeel), het
// paneel (wat kan ik kiezen) en de stuklijst (hoe heet het). Eén lijst dus.
//
// De kleuren zijn er om onderscheid te maken in het beeld, niet om een houtsoort
// natuurgetrouw na te doen. Daar is een textuur voor nodig en die hoort bij een
// presentatieplaatje, niet bij een configurator.

/**
 * De materialen die een onderdeel kan hebben.
 *
 * `kleur` is de kleur in het 3D-beeld. Staal houdt exact de grijstint die de app
 * altijd al had, zodat er aan een stalen model niets verandert.
 *
 * `soort` groepeert ze: 'metaal' of 'hout'. Daar hangt aan waar je ze mag
 * kiezen - hout komt op een plank, niet op een buis.
 */
export const MATERIALEN = {
    staal:  { naam: 'Staal',  soort: 'metaal', kleur: 0xc8ccd0, dichtheid: 7850 },
    // RVS EN ALUMINIUM in plaats van staal, voor het hele frame tegelijk; zie
    // FRAMEMETALEN. Dezelfde profielmaten, een ander metaal. RVS is lichter
    // van tint en blinkt meer, aluminium is matter en weegt een derde.
    //
    // `dichtheid` in kg per kubieke meter. Het gewicht komt uit het gemeten
    // volume, dus een aluminium staander weegt vanzelf een derde van een
    // stalen - zonder een tweede tabel met gewichten per meter.
    rvs:    { naam: 'RVS 316', soort: 'metaal', kleur: 0xe1e4e7, dichtheid: 8000 },
    aluminium: { naam: 'Aluminium', soort: 'metaal', kleur: 0xd2d5d8, dichtheid: 2700 },
    // GLAS is de eerste die niet massief in beeld hoort. Zonder doorzichtigheid
    // zie je een grijze plaat tussen de staanders en is er van de leuning niets
    // meer te zien - precies het tegenovergestelde van waarom iemand glas kiest.
    //
    // `doorzichtig` is de dekking: 0 is onzichtbaar, 1 is massief. 0,28 laat de
    // constructie erachter zien en houdt de ruit zelf nog zichtbaar. Het is een
    // keuze voor het BEELD en zegt niets over het glas zelf.
    glas:   { naam: 'Glas',   soort: 'glas',   kleur: 0xa8c6d0, doorzichtig: 0.28 },
    // STEEN is de derde die niet uit een stang komt. Een gedraaide baluster
    // wordt gegoten of gedraaid en per stuk besteld, niet uit zes meter
    // gezaagd - net als de glasklemmen en de sierpunten. De kleur is die van
    // ongeverfd gietsteen; wie het wit wil, coat het.
    steen:  { naam: 'Steen',  soort: 'steen',  kleur: 0xe6e2da },
    // De drie hieronder bestaan alleen als TREDE of bordes; zie `mag`.
    // Traanplaat is gewoon staal met ribbels erop, dus hij weegt mee als
    // staal. Een rooster en een betonnen trede koop je kant-en-klaar.
    traanplaat: { naam: 'Traanplaat', soort: 'metaal', kleur: 0xb3b8bd, dichtheid: 7850 },
    rooster: { naam: 'Rooster (verzinkt)', soort: 'metaal', kleur: 0x8f979c },
    beton:  { naam: 'Beton',  soort: 'steen',  kleur: 0xb1afa8 },
    eiken:  { naam: 'Eiken',  soort: 'hout',   kleur: 0xb5844a },
    beuken: { naam: 'Beuken', soort: 'hout',   kleur: 0xd3ab77 },
    vuren:  { naam: 'Vuren',  soort: 'hout',   kleur: 0xe2c89b },
    merbau: { naam: 'Merbau', soort: 'hout',   kleur: 0x8a4a2b },
};

/** Het materiaal dat bij een sleutel hoort; onbekend of leeg wordt staal. */
export function materiaalVan(sleutel) {
    return MATERIALEN[sleutel] || MATERIALEN.staal;
}

/** De naam zoals hij in de stuklijst hoort te staan. */
export function materiaalNaam(sleutel) {
    return materiaalVan(sleutel).naam;
}

export const isHout = (sleutel) => materiaalVan(sleutel).soort === 'hout';

/**
 * Waar het frame van gemaakt kan worden: staanders, regels, spijlen, bomen,
 * platen. EEN keuze voor het hele werk, net als de coatkleur - een leuning
 * waarvan de staanders RVS zijn en de handregel staal bestaat niet, want die
 * twee las je niet aan elkaar.
 *
 * LET OP: de app rekent geen sterkte. Aluminium is ongeveer drie keer zo slap
 * als staal; hetzelfde profiel buigt dus drie keer zo ver door. Dat staat bij
 * de keuze in het paneel.
 */
export const FRAMEMETALEN = ['staal', 'rvs', 'aluminium'];

/**
 * Het frame van een gekozen metaal maken, en de afwerking erop zetten.
 *
 * Alleen wat nu STAAL is gaat mee: een houten trede, een glazen ruit, een
 * gietstenen baluster en traanplaat blijven wat ze zijn. Eén plek voor alle
 * bouwers, zodat er geen onderdeel vergeten wordt.
 *
 * @param p  { afwerking, metaal, verzinken }
 */
export function stempelWerk(delen, p) {
    const metaal = p.metaal && p.metaal !== 'staal' && MATERIALEN[p.metaal] ? p.metaal : null;
    for (const d of delen) {
        if (p.afwerking) d.afwerking = p.afwerking;
        if (metaal && (!d.materiaal || d.materiaal === 'staal')) d.materiaal = metaal;
        if (p.verzinken) d.verzinkt = true;
    }
    return delen;
}

/** De dichtheid in kg/m³; null voor wat niet gewogen wordt (glas, hout, steen). */
export function dichtheidVan(sleutel) {
    return materiaalVan(sleutel).dichtheid || null;
}

/** De sleutels van één soort, voor een keuzelijst. */
export function materiaalSleutels(soort = null) {
    return Object.keys(MATERIALEN)
        .filter((k) => !soort || MATERIALEN[k].soort === soort);
}

// --- afwerking -------------------------------------------------------------
//
// Een afwerking is iets ANDERS dan een materiaal. Een staander is van staal én
// gepoedercoat in RAL 7016; dat zijn twee gegevens en in een stuklijst twee
// kolommen. Daarom staan ze hier naast elkaar en niet door elkaar.
//
// LET OP WAT DEZE KLEUREN WEL EN NIET ZIJN. Het RAL-NUMMER is wat de
// poedercoater nodig heeft, en dat is het enige dat hard is. De kleurwaarden
// hieronder zijn benaderingen om het op een beeldscherm te kunnen laten zien.
// Ze zijn NIET kleurecht: RAL is een eigen kleursysteem met fysieke stalen, en
// hoe het eruitziet hangt af van je scherm, van glans en van de structuur van
// de coating. Kies nooit een kleur op dit scherm - kies op een RAL-waaier en
// geef het nummer door.
//
// Dit is bewust een KORTE lijst met wat er in de leuningbouw veel gebruikt
// wordt, geen volledige RAL Classic van 213 kleuren. Een lange lijst uit het
// hoofd overschrijven levert fouten op die niemand opmerkt. Uitbreiden is één
// regel per kleur.
export const RAL = {
    '1021': { naam: 'Koolzaadgeel',               kleur: 0xf3ba0b },
    '3000': { naam: 'Vuurrood',                   kleur: 0xa72920 },
    '5010': { naam: 'Gentiaanblauw',              kleur: 0x10456e },
    '6005': { naam: 'Mosgroen',                   kleur: 0x114232 },
    '7016': { naam: 'Antracietgrijs',             kleur: 0x383e42 },
    '7021': { naam: 'Zwartgrijs',                 kleur: 0x2f3234 },
    '7035': { naam: 'Lichtgrijs',                 kleur: 0xcbd0cc },
    '7039': { naam: 'Kwartsgrijs',                kleur: 0x6b665e },
    '8017': { naam: 'Chocoladebruin',             kleur: 0x44322d },
    '9001': { naam: 'Crèmewit',                   kleur: 0xe9e0d2 },
    '9005': { naam: 'Gitzwart',                   kleur: 0x0e0e10 },
    '9006': { naam: 'Blank aluminiumkleurig',     kleur: 0xa1a1a0 },
    '9007': { naam: 'Grijs aluminiumkleurig',     kleur: 0x878581 },
    '9010': { naam: 'Zuiver wit',                 kleur: 0xf1ece1 },
    '9016': { naam: 'Verkeerswit',                kleur: 0xf1f0ea },
};

/** De RAL-nummers, op volgorde, voor een keuzelijst. */
export const ralNummers = () => Object.keys(RAL);

/** "RAL 7016 — Antracietgrijs", zoals het in een stuklijst hoort te staan. */
export function ralNaam(nummer) {
    const r = RAL[nummer];
    return r ? `RAL ${nummer} — ${r.naam}` : '';
}

/**
 * Mag dit onderdeel gepoedercoat worden?
 *
 * Poedercoaten is een laag die je inbrandt bij 180 à 200 °C. Dat kan op metaal
 * en niet op hout: dat verbrandt. Een houten trede in een verder gepoedercoate
 * trap blijft dus hout.
 */
export function magCoaten(deel) {
    // Ook glas en beton niet. Een gecoate ruit kwam in beeld als een dichte
    // antraciete plaat, en dat is het omgekeerde van waarom je glas kiest.
    // Gietsteen blijft wél te coaten: een stenen baluster wordt geverfd. Een
    // stenen TREDE is natuursteen, en die coat je net zo min als een rooster
    // dat verzinkt van de leverancier komt.
    const m = materiaalVanDeel(deel);
    if (m === 'steen') return !PLANKEN.has(deel.soort);
    return !isHout(m) && m !== 'glas' && m !== 'beton' && m !== 'rooster';
}

/**
 * Mag dit onderdeel thermisch verzinkt worden?
 *
 * Alleen gewoon staal - ook traanplaat, dat is staal met ribbels. RVS en
 * aluminium roesten niet en worden niet verzinkt; een rooster komt al verzinkt
 * van de leverancier.
 */
export function magVerzinken(deel) {
    const m = materiaalVanDeel(deel);
    return m === 'staal' || m === 'traanplaat';
}

/** Of een onderdeel verzinkt wordt: gevraagd én mogelijk. */
export const isVerzinkt = (deel) => Boolean(deel && deel.verzinkt) && magVerzinken(deel);

/**
 * De afwerking zoals de werkplaats hem leest, met verzinken erbij:
 * "thermisch verzinkt", "RAL 7016 — Antracietgrijs", of allebei als duplex.
 * Leeg betekent blank.
 */
export function afwerkingTekst(deel) {
    const nummer = afwerkingVanDeel(deel);
    const ral = nummer ? ralNaam(nummer) : '';
    if (!isVerzinkt(deel)) return ral;
    return ral ? `duplex: verzinkt + ${ral}` : 'thermisch verzinkt';
}

/**
 * De afwerking van een onderdeel: een RAL-nummer, of null voor blank.
 *
 * Staat er een afwerking op iets dat niet gecoat kan worden, dan is het
 * antwoord null. Net als bij hout op een buis: stil het verstandige doen, geen
 * foutmelding over een combinatie die de gebruiker niet zelf heeft gemaakt.
 */
export function afwerkingVanDeel(deel) {
    const nummer = deel && deel.afwerking;
    if (!nummer || !RAL[nummer]) return null;
    return magCoaten(deel) ? nummer : null;
}

/**
 * De kleur waarmee een onderdeel in beeld komt.
 *
 * Gepoedercoat? Dan zie je de coating, want die zit eroverheen. Anders zie je
 * het materiaal zelf.
 */
export function uiterlijkVanDeel(deel) {
    const afwerking = afwerkingVanDeel(deel);
    if (afwerking) {
        return {
            sleutel: `ral:${afwerking}`,
            kleur: RAL[afwerking].kleur,
            // Poedercoat is matter dan blank staal, maar minder mat dan hout.
            ruwheid: 0.8,
        };
    }
    // Verzinkt en niet gecoat: dan zie je het zink, doffer en grijzer dan
    // blank staal.
    if (isVerzinkt(deel)) return { sleutel: 'verzinkt', kleur: 0x9fa7ac, ruwheid: 0.9 };
    const m = materiaalVan(materiaalVanDeel(deel));
    return {
        sleutel: materiaalVanDeel(deel),
        kleur: m.kleur,
        // Glas is glad, hout en steen zijn mat, staal zit ertussenin.
        ruwheid: m.soort === 'hout' || m.soort === 'steen' ? 0.95
            : m.soort === 'glas' ? 0.1 : 0.85,
        // Alleen glas heeft dit; bij de rest blijft het undefined en verandert
        // er niets aan hoe het getekend wordt.
        doorzichtig: m.doorzichtig,
    };
}

export const isGlas = (sleutel) => materiaalVan(sleutel).soort === 'glas';

/**
 * De materialen die voor een onderdeel gekozen mogen worden.
 *
 * Hout alleen op een PLANK: een trede of een bordes. Een profiel uit de
 * catalogus is een stalen doorsnede - daar hout van maken zou een houten buis
 * opleveren, en dat bestaat niet.
 *
 * Deze regel staat hier en niet in het paneel, zodat hij ook geldt als een
 * materiaal langs een andere weg wordt gezet.
 */
const PLANKEN = new Set(['trede', 'bordes']);

// Waar steen op mag: een gedraaide baluster en een dekband. Zie `mag`.
const STEENDELEN = new Set(['spijl', 'handregel']);

export function mag(soortOnderdeel, materiaalSleutel) {
    // STEEN HOORT OP EEN GEDRAAIDE BALUSTER OF EEN DEKBAND EN NERGENS ANDERS.
    // Een stenen voetplaat of vulregel bestaat in deze app niet, en zou in de
    // stuklijst een onderdeel beloven dat niemand kan leveren. Dezelfde
    // gedachte als bij hout op een buis: beperk het tot waar het voorkomt.
    //
    // De handregel staat er pas bij sinds de dekband er is. Dat het hier een
    // LIJST is en geen los geval, is omdat deze regel nu twee keer uitgebreid
    // is: een derde keer hoeft dan geen herschrijving te zijn.
    //
    // Een stenen TREDE bestaat wel: natuursteen op een stalen boom. Die stond
    // in de keuzelijst bij Trap en viel hier stil terug op staal.
    if (materiaalSleutel === 'steen') {
        return STEENDELEN.has(soortOnderdeel) || PLANKEN.has(soortOnderdeel);
    }
    // Wat alleen als trede bestaat. Een roosterspijl of een betonnen
    // handregel kan deze app niet maken en hoort dus ook niet te kunnen.
    if (ALLEEN_TREDE.has(materiaalSleutel)) return PLANKEN.has(soortOnderdeel);
    if (!isHout(materiaalSleutel)) return true;
    return PLANKEN.has(soortOnderdeel) || HOUTDELEN.has(soortOnderdeel);
}

// Wat er verder van hout kan zijn: de trapbomen van een houten trap, het
// stootbord tussen houten treden en een houten handregel. Geen buis of
// profiel - dat blijft staal.
const HOUTDELEN = new Set(['trapboom', 'bordesboom', 'stootbord', 'handregel']);

const ALLEEN_TREDE = new Set(['traanplaat', 'rooster', 'beton']);

/**
 * Het materiaal van een onderdeel, met de regel hierboven erop toegepast.
 *
 * Staat er een materiaal op het onderdeel dat daar niet mag, dan wordt het
 * staal. Niet een foutmelding: dit is geen invoer van de gebruiker maar een
 * combinatie die in de code ontstaat, en stil terugvallen op staal is daar het
 * veilige antwoord.
 */
export function materiaalVanDeel(deel) {
    const sleutel = deel && deel.materiaal;
    if (!sleutel || !mag(deel.soort, sleutel)) return 'staal';
    return MATERIALEN[sleutel] ? sleutel : 'staal';
}
