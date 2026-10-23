// De soorten trede.
//
// WAAROM EEN LIJST EN NIET ALLEEN EEN MATERIAAL. Een trede van traanplaat, een
// roostertrede en een glazen trede verschillen in meer dan hun kleur: ze zijn
// anders dik, de een zaag je zelf uit plaat en de ander bestel je op maat, en
// de een las je aan de boom terwijl de ander op steunhoeken ligt. Dat hoort op
// één plek te staan, zodat het paneel, de bouwer, de stuklijst en de
// kostenraming niet elk een eigen idee krijgen over wat een "glazen trede" is.
//
// De DIKTES zijn gangbare handelsmaten en een voorstel bij het kiezen; het
// veld trededikte blijft gewoon in te vullen. Ze zijn NIET getoetst aan een
// norm of een leverancier.
//
//   staalplaat   8 mm   zelf snijden, aan de boom gelast
//   traanplaat   5/7    5 mm plaat met 2 mm ribbels; zelf snijden
//   rooster     30 mm   draagstaven 30x3, op maat besteld met kopplaten
//   hout        40 mm   de gangbare dikte voor een vrijdragende houten trede
//   glas        32 mm   drie lagen van 10 mm gelaagd, met folie ertussen
//   steen       40 mm   natuursteen op een stalen boom
//   beton       60 mm   prefab

/**
 * @property materiaal  sleutel uit materialen.js
 * @property dikte      voorgestelde trededikte in mm
 * @property besteld    kant-en-klaar gekocht in plaats van zelf gesneden
 * @property opHoeken   ligt op steunhoeken in plaats van gelast aan de boom
 */
export const TREDESOORTEN = [
    { materiaal: 'staal',      naam: 'Staalplaat',           dikte: 8,  besteld: false, opHoeken: false },
    { materiaal: 'traanplaat', naam: 'Traanplaat 5/7',       dikte: 7,  besteld: false, opHoeken: false },
    { materiaal: 'rooster',    naam: 'Roostertrede 30x3',    dikte: 30, besteld: true,  opHoeken: true },
    { materiaal: 'eiken',      naam: 'Eiken',                dikte: 40, besteld: true,  opHoeken: true },
    { materiaal: 'beuken',     naam: 'Beuken',               dikte: 40, besteld: true,  opHoeken: true },
    { materiaal: 'vuren',      naam: 'Vuren',                dikte: 40, besteld: true,  opHoeken: true },
    { materiaal: 'merbau',     naam: 'Merbau',               dikte: 40, besteld: true,  opHoeken: true },
    { materiaal: 'glas',       naam: 'Gelaagd glas',         dikte: 32, besteld: true,  opHoeken: true },
    { materiaal: 'steen',      naam: 'Natuursteen',          dikte: 40, besteld: true,  opHoeken: true },
    { materiaal: 'beton',      naam: 'Beton (prefab)',       dikte: 60, besteld: true,  opHoeken: true },
];

/** De soort bij een materiaal; onbekend of leeg is staalplaat. */
export function tredeSoortVan(materiaal) {
    return TREDESOORTEN.find(s => s.materiaal === materiaal) || TREDESOORTEN[0];
}
