// Een ZIP schrijven, zonder bibliotheek en zonder compressie.
//
// WAAROM. Een productiepakket is al gauw acht tot twintig bestanden: een STEP
// van het geheel, een STEP per uniek onderdeel, een DXF per plaatdeel, de PDF
// en de stuklijst. Die één voor één laten downloaden is geen aflevering maar
// een klusje voor de ontvanger.
//
// ZONDER COMPRESSIE (methode 0, "store"). Comprimeren vraagt een
// deflate-implementatie, en dat is honderden regels waar niets in dit project
// op leunt. Wat levert het op? STEP en DXF zijn tekst en zouden ruim 80 %
// slinken, maar de PDF zit al vol JPEG en comprimeert niet meer. Voor een
// pakket dat per e-mail of over het netwerk naar de werkplaats gaat is dat het
// verschil tussen een paar honderd kilobyte en een megabyte - niet genoeg om er
// code voor te schrijven die stuk kan.
//
// Een "store"-zip is een geldige zip: elk uitpakprogramma opent hem.
//
// WAT ER NIET IN ZIT: geen zip64 (dus geen bestanden boven 4 GB of meer dan
// 65535 bestanden), geen mappen als aparte ingangen (een schuine streep in de
// naam is genoeg), geen tijdzones. Voor dit doel is dat allemaal ruim genoeg;
// een pakket is zelden groter dan een paar megabyte.

// --- CRC32 -----------------------------------------------------------------
//
// Elke ingang in een zip draagt een controlegetal over zijn inhoud. Zonder dat
// weigert een uitpakker het bestand of meldt hij dat het beschadigd is.
//
// De tabel wordt één keer opgebouwd en daarna hergebruikt: 256 ingangen, elk de
// uitkomst van acht keer schuiven met de standaardveelterm 0xEDB88320.
let tabel = null;
function crcTabel() {
    if (tabel) return tabel;
    tabel = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        tabel[i] = c >>> 0;
    }
    return tabel;
}

export function crc32(bytes) {
    const t = crcTabel();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// --- bytes bij elkaar ------------------------------------------------------

class Uit {
    constructor() { this.stukken = []; this.lengte = 0; }
    rauw(b) { this.stukken.push(b); this.lengte += b.length; }
    u16(w) { this.rauw(new Uint8Array([w & 0xFF, (w >>> 8) & 0xFF])); }
    u32(w) {
        this.rauw(new Uint8Array([w & 0xFF, (w >>> 8) & 0xFF,
                                  (w >>> 16) & 0xFF, (w >>> 24) & 0xFF]));
    }
    klaar() {
        const uit = new Uint8Array(this.lengte);
        let op = 0;
        for (const s of this.stukken) { uit.set(s, op); op += s.length; }
        return uit;
    }
}

/**
 * Datum en tijd in het MS-DOS-formaat dat een zip gebruikt.
 *
 * Twee keer zestien bits, met een resolutie van twee seconden en een jaartal
 * vanaf 1980. Zonder dit staat elk bestand op 1 januari 1980, en dan ziet de
 * ontvanger niet wanneer het pakket gemaakt is.
 */
function dosTijd(d) {
    const jaar = Math.max(1980, d.getFullYear());
    return {
        tijd: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        datum: ((jaar - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}

/**
 * Maakt een zip.
 *
 * @param bestanden  [{ naam, data }] - data is een Uint8Array of een string.
 *                   Een schuine streep in de naam maakt een map.
 * @returns {Uint8Array}
 */
export function maakZip(bestanden, datum = new Date()) {
    const codeer = new TextEncoder();
    const { tijd, datum: dosDatum } = dosTijd(datum);

    const uit = new Uit();
    const ingangen = [];

    for (const b of bestanden) {
        const naam = codeer.encode(b.naam);
        const data = typeof b.data === 'string' ? codeer.encode(b.data) : b.data;
        const crc = crc32(data);
        const positie = uit.lengte;

        uit.u32(0x04034b50);        // kop van een lokale ingang
        uit.u16(20);                // versie die nodig is om uit te pakken: 2.0
        // Bit 11 aan: de naam staat in UTF-8. Zonder dat raden uitpakkers de
        // codering, en dan wordt een naam met een accent onleesbaar.
        uit.u16(0x0800);
        uit.u16(0);                 // methode 0 = opslaan, niet comprimeren
        uit.u16(tijd); uit.u16(dosDatum);
        uit.u32(crc);
        uit.u32(data.length);       // ingepakt - gelijk, want niet ingepakt
        uit.u32(data.length);       // uitgepakt
        uit.u16(naam.length);
        uit.u16(0);                 // geen extra veld
        uit.rauw(naam);
        uit.rauw(data);

        ingangen.push({ naam, crc, grootte: data.length, positie });
    }

    // De centrale map: dezelfde gegevens nog een keer, achter elkaar. Een
    // uitpakker leest DIE, niet de lokale ingangen - daarom moet de positie van
    // elke lokale ingang hier exact kloppen.
    const centraalBegin = uit.lengte;
    for (const e of ingangen) {
        uit.u32(0x02014b50);
        uit.u16(20);                // gemaakt door versie 2.0
        uit.u16(20);                // nodig om uit te pakken
        uit.u16(0x0800);
        uit.u16(0);
        uit.u16(tijd); uit.u16(dosDatum);
        uit.u32(e.crc);
        uit.u32(e.grootte);
        uit.u32(e.grootte);
        uit.u16(e.naam.length);
        uit.u16(0);                 // extra
        uit.u16(0);                 // commentaar
        uit.u16(0);                 // schijfnummer
        uit.u16(0);                 // interne eigenschappen
        uit.u32(0);                 // externe eigenschappen
        uit.u32(e.positie);
        uit.rauw(e.naam);
    }
    const centraalLengte = uit.lengte - centraalBegin;

    uit.u32(0x06054b50);            // einde van de centrale map
    uit.u16(0); uit.u16(0);         // schijfnummers
    uit.u16(ingangen.length);
    uit.u16(ingangen.length);
    uit.u32(centraalLengte);
    uit.u32(centraalBegin);
    uit.u16(0);                     // geen commentaar

    return uit.klaar();
}
