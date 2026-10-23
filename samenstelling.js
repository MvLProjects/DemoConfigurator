// Van een platte lijst onderdelen naar een samenstellingsboom.
//
// Verbeterpunt 1 uit VERBETERPUNTEN.md. In de HiCAD-voorbeeldbalustrade staat
// een echte boom, te zien aan de `_Baugruppe`-namen:
//
//     Main assembly
//     └── Railing
//         ├── Post      ×3
//         ├── Handrail
//         └── Infill    ×2
//             └── Segment
//
// Wij leverden een platte lijst losse stukken zonder onderling verband. Dat is
// niet alleen onnetjes: met een boom kun je zeggen "2× identiek vulveld" in
// plaats van twaalf losse spijlen op te sommen, en is een vulveld iets dat je
// als geheel plat op een bok last en daarna tussen de staanders hangt.
//
// WAT DIT WEL EN NIET IS. Dit is een GROEPERING van de onderdelen die er al
// zijn, geen tweede waarheid. De meetkunde, de stuklijst en de STEP-export
// veranderen er niet van. pad.js hangt alleen een etiket aan elk onderdeel -
// `groep` - en dit bestand leest die etiketten.
//
// WAAROM OP OBJECT-IDENTITEIT EN NIET OP EEN NUMMER. Een trap met een leuning
// aan twee kanten roept padDelen twee keer aan, en dan bestaat "staander 1"
// twee keer. Elke aanroep maakt verse groepsobjecten, dus de objecten zelf zijn
// uit elkaar te houden en nummers niet. Het nummer is er alleen om te tonen.

import { beschrijf } from './onderdelen.js';

// Hoeveel twee afstanden mogen schelen om nog "dezelfde samenstelling" te
// heten, in millimeter.
//
// Twee vulvelden die uit dezelfde formule komen scheppen hooguit afrondruis in
// de orde van 1e-12 mm; twee velden die echt verschillen schelen millimeters.
// Daar zit zo veel ruimte tussen dat de precieze waarde niet kritisch is.
export const TOLERANTIE_MM = 1e-6;

/** De namen zoals ze in de boom komen te staan. */
const NAMEN = {
    staander: 'Staander',
    vulveld: 'Vulveld',
};

const naamVanGroep = (soort) =>
    NAMEN[soort] || (soort.charAt(0).toUpperCase() + soort.slice(1));

/**
 * Bouwt de samenstellingsboom.
 *
 * @param delen       de platte lijst onderdelen, in bouwvolgorde
 * @param onderdelen  de unieke productieonderdelen uit groepeerVormen
 * @param wortel      hoe de bovenste knoop heet, bijvoorbeeld 'Balustrade'
 * @returns {{naam, kinderen, aantalKnopen, losseDelen}}
 *
 * Elke knoop is óf een deelsamenstelling (met `inhoud`) óf een los onderdeel.
 * Identieke deelsamenstellingen worden samengevoegd tot één knoop met `aantal`.
 */
export function maakBoom(delen, onderdelen, wortel = 'Samenstelling') {
    const nummerVan = nummerKaart(onderdelen);

    // De groepen in de volgorde waarin ze voor het eerst voorkomen, zodat de
    // boom dezelfde volgorde houdt als de bouw. Sleutel is het groepsobject
    // zelf; zie de kop van dit bestand.
    const groepen = new Map();
    const losseDelen = [];

    for (const d of delen) {
        if (!d.groep) { losseDelen.push(d); continue; }
        if (!groepen.has(d.groep)) groepen.set(d.groep, []);
        groepen.get(d.groep).push(d);
    }

    // Een groep met maar ÉÉN onderdeel is geen samenstelling. Dat komt voor:
    // zet de voetplaatdikte op 0 en er blijft van de staandergroep alleen de
    // staander over. Zo'n groep als tak tonen levert een niveau inspringen op
    // zonder dat er iets in zit. Die gaan dus gewoon bij de losse onderdelen.
    for (const [groep, groepDelen] of [...groepen]) {
        if (groepDelen.length === 1) {
            losseDelen.push(groepDelen[0]);
            groepen.delete(groep);
        }
    }

    // Nu één keer door de onderdelen heen in BOUWVOLGORDE, en de knopen in die
    // volgorde neerzetten. Eerst alle samenstellingen en dan alle losse
    // onderdelen zou de volgorde laten omslaan zodra er een groep wegvalt:
    // zonder voetplaat is een staander geen samenstelling meer en zou hij
    // ineens onder het vulveld komen te staan, terwijl hij er eerder boven
    // stond. De boom hoort niet van volgorde te wisselen door een vinkje.
    const losLijst = new Set(losseDelen);
    const kinderen = [];
    const gezien = new Set();

    for (const d of delen) {
        if (losLijst.has(d)) {
            // Losse onderdelen gaan per productieonderdeel bij elkaar.
            const nummer = nummerVan(d);
            const sleutel = 'los:' + nummer;
            const bestaand = kinderen.find(k => k.sleutel === sleutel);
            if (bestaand) { bestaand.aantal += 1; continue; }
            kinderen.push({
                type: 'onderdeel', sleutel,
                soort: d.soort, naam: naamVanGroep(d.soort),
                aantal: 1, nummer, lengte: beschrijf(d).lengte,
            });
            continue;
        }

        // Elke groep één keer, bij zijn eerste onderdeel.
        if (!d.groep || gezien.has(d.groep)) continue;
        gezien.add(d.groep);

        const groepDelen = groepen.get(d.groep);
        const vinger = vingerafdruk(groepDelen, nummerVan);
        const bestaand = kinderen.find(
            k => k.type === 'samenstelling' && zelfde(k.vinger, vinger));
        if (bestaand) {
            bestaand.aantal += 1;
            bestaand.groepen.push(d.groep);
            continue;
        }
        kinderen.push({
            type: 'samenstelling',
            soort: d.groep.soort,
            naam: naamVanGroep(d.groep.soort),
            aantal: 1,
            vinger,
            groepen: [d.groep],
            // Wat erin zit, opgeteld per productieonderdeel.
            inhoud: inhoudVan(groepDelen, nummerVan),
        });
    }
    return {
        naam: wortel,
        kinderen,
        losseDelen,
        // Hoeveel knopen er in totaal onder de wortel hangen, exemplaren
        // meegeteld. Handig om in één getal te laten zien dat het geen platte
        // lijst meer is.
        aantalKnopen: kinderen.reduce((s, k) => s + k.aantal, 0),
    };
}

/**
 * Van een onderdeel naar het nummer van zijn productieonderdeel.
 *
 * groepeerVormen bewaart in `exemplaren` de onderdelen die bij elk uniek
 * productieonderdeel horen, dus die lijst is precies de omgekeerde koppeling.
 * Een Map op het onderdeel-object zelf: twee onderdelen kunnen alles gelijk
 * hebben behalve waar ze staan.
 */
function nummerKaart(onderdelen) {
    const kaart = new Map();
    for (const u of onderdelen || []) {
        for (const deel of u.exemplaren || []) kaart.set(deel, u.nummer);
    }
    return (deel) => kaart.get(deel) ?? 0;
}

/** Wat er in een groep zit, opgeteld per productieonderdeel. */
function inhoudVan(groepDelen, nummerVan) {
    const per = new Map();
    for (const d of groepDelen) {
        const nummer = nummerVan(d);
        const bestaand = per.get(nummer);
        if (bestaand) { bestaand.aantal += 1; continue; }
        per.set(nummer, {
            nummer,
            soort: d.soort,
            aantal: 1,
            lengte: beschrijf(d).lengte,
        });
    }
    return [...per.values()].sort((a, b) => a.nummer - b.nummer);
}

/**
 * Het kenmerk waarop twee deelsamenstellingen vergeleken worden.
 *
 * Per onderdeel: het nummer van zijn productieonderdeel, en de afstand van zijn
 * oorsprong tot het zwaartepunt van de groep. Allebei blijven ze gelijk als je
 * de hele groep verplaatst of draait - precies wat je wilt, want twee vulvelden
 * aan weerszijden van een hoek staan anders maar zijn hetzelfde paneel.
 *
 * Het zwaartepunt is hier dat van de OORSPRONGEN, niet van het materiaal. Dat
 * is genoeg om de groepen uit elkaar te houden en het kost geen enkele meting
 * aan de vorm; die metingen zijn bij het groeperen van de onderdelen al gedaan.
 *
 * BEPERKING, bewust opgeschreven: dit is een noodzakelijke voorwaarde, geen
 * sluitend bewijs. Twee groepen met dezelfde onderdelen op dezelfde afstanden
 * van hun zwaartepunt maar anders om dat punt heen gedraaid zouden hier gelijk
 * uit komen. Bij de velden en staanders die padDelen bouwt kan dat niet
 * voorkomen - die volgen allemaal dezelfde formule - maar wie hier een andere
 * soort groep bij zet, moet dit nalopen.
 */
function vingerafdruk(groepDelen, nummerVan) {
    const n = groepDelen.length;
    const zwaartepunt = [0, 1, 2].map(as =>
        groepDelen.reduce((som, d) => som + d.oorsprong[as], 0) / n);

    return groepDelen
        .map(d => ({
            nummer: nummerVan(d),
            straal: Math.hypot(d.oorsprong[0] - zwaartepunt[0],
                               d.oorsprong[1] - zwaartepunt[1],
                               d.oorsprong[2] - zwaartepunt[2]),
        }))
        .sort((a, b) => a.nummer - b.nummer || a.straal - b.straal);
}

/**
 * Zijn dit twee exemplaren van dezelfde deelsamenstelling?
 *
 * Met een TOLERANTIE vergeleken en niet op een afgeronde sleutel. Dat is
 * dezelfde keuze als in onderdelen.js, en om dezelfde reden: met afronden
 * kunnen twee waarden die 1e-11 schelen tóch aan weerszijden van een
 * afrondgrens vallen en uit elkaar getrokken worden.
 */
export function zelfde(a, b, tol = TOLERANTIE_MM) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].nummer !== b[i].nummer) return false;
        if (Math.abs(a[i].straal - b[i].straal) > tol) return false;
    }
    return true;
}

/**
 * De boom als ingesprongen regels, voor een tekstweergave of een test.
 *
 * Bijvoorbeeld:
 *
 *     Balustrade
 *       3x Staander
 *            1x voetplaat  (nr 4)
 *            1x staander   (nr 1)
 *       2x Vulveld
 *            2x vulregel   (nr 3)
 *            6x spijl      (nr 5)
 *       2x Handregel       (nr 2)
 */
export function alsTekst(boom) {
    const regels = [boom.naam];
    for (const k of boom.kinderen) {
        if (k.type === 'onderdeel') {
            regels.push(`  ${k.aantal}x ${k.naam} (nr ${k.nummer})`);
            continue;
        }
        regels.push(`  ${k.aantal}x ${k.naam}`);
        for (const r of k.inhoud) {
            regels.push(`       ${r.aantal}x ${r.soort} (nr ${r.nummer})`);
        }
    }
    return regels.join('\n');
}
