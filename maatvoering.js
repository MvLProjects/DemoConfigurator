// Maatvoering in het 3D-beeld.
//
// Wat er getekend wordt: de buitenmaten van het hele werk, en de maten die zich
// HERHALEN - hart op hart tussen twee staanders, de vrije doorgang tussen twee
// spijlen, de optrede en de aantrede van een trap.
//
// WAAROM NIET ALLES. Een balustrade van 58 spijlen heeft 59 openingen. Die
// allemaal bematen levert een onleesbaar beeld op en vertelt 59 keer hetzelfde.
// Een tekenaar zet er één en schrijft "typ." erbij. Hier staat één maat van elk
// soort, op de eerste plek waar hij voorkomt.
//
// WAAR DE GETALLEN VANDAAN KOMEN: uit de ONDERDELEN zelf, dezelfde lijst waar
// de geometrie en de stuklijst uit komen. Niet uit een aparte berekening - die
// zou kunnen gaan afwijken van wat je in beeld ziet, en dan staat er een maat
// bij een model die er niet bij hoort. Verandert het model, dan verandert de
// maatvoering mee omdat hij opnieuw uit dezelfde lijst wordt opgebouwd.

import * as THREE from 'three';

const KLEUR = 0x0b63ce;
const KLEUR_TEKST = '#0b4e9e';

/**
 * Bouwt de maatvoering voor een model.
 *
 * @param delen  de onderdelen waaruit het model gebouwd is (mag leeg zijn)
 * @param doos   THREE.Box3 van het hele model
 * @param maat   de grootste afmeting, om tekst en pijlen op te schalen
 * @returns THREE.Group
 */
export function maakMaatvoering(delen, doos, maat) {
    const groep = new THREE.Group();
    groep.name = 'maatvoering';
    if (!doos || doos.isEmpty()) return groep;

    const h = maat / 60;          // tekstgrootte en pijllengte
    const weg = maat / 14;        // hoever de maatlijn naast het model ligt

    for (const m of maatDefinities(delen,
            [doos.min.x, doos.min.y, doos.min.z],
            [doos.max.x, doos.max.y, doos.max.z], weg)) {
        voegToe(groep, m.hoek
            ? hoekMaat(m.punt, m.tekst, h)
            : maatlijn(m.van, m.naar, m.richting, m.waarde, h, m.tekst));
    }

    return groep;
}

/**
 * Welke maten er bij dit model horen, als zuivere getallen in modelcoördinaten.
 *
 * APART VAN HET TEKENEN, zodat de 2D-werkplaatstekening dezelfde maten kan
 * zetten als het 3D-beeld. Stonden ze op twee plekken, dan zou het beeld op een
 * dag iets anders zeggen dan het papier, en dan weet niemand welke van de twee
 * klopt.
 *
 * @param delen   de onderdelen waaruit het model gebouwd is
 * @param min     [x, y, z] van de omhullende doos
 * @param max     [x, y, z] van de omhullende doos
 * @param weg     hoever de buitenmaten naast het model komen te liggen
 * @returns [{ van, naar, richting, waarde, tekst }] en eventueel { hoek, punt, tekst }
 */
export function maatDefinities(delen, min, max, weg = 0) {
    // De buitenmaten, elk langs een eigen rand en naar buiten geschoven zodat
    // ze niet door het model heen lopen.
    const uit = [
        { van: [min[0], min[1] - weg, min[2]], naar: [max[0], min[1] - weg, min[2]],
          richting: [0, -1, 0], waarde: max[0] - min[0], tekst: null },
        { van: [max[0] + weg, min[1], min[2]], naar: [max[0] + weg, max[1], min[2]],
          richting: [1, 0, 0], waarde: max[1] - min[1], tekst: null },
        { van: [min[0] - weg, min[1], min[2]], naar: [min[0] - weg, min[1], max[2]],
          richting: [-1, 0, 0], waarde: max[2] - min[2], tekst: null },
    ].filter((m) => m.waarde > 0);

    return [...uit, ...herhalendeMaten(delen)];
}

function voegToe(groep, kind) {
    if (kind) groep.add(kind);
}

/**
 * De maten die uit de onderdelenlijst te halen zijn.
 *
 * Alles wordt GEMETEN aan de onderdelen die er echt staan, niet uit een formule
 * opnieuw uitgerekend. Staan er twee staanders 850 uit elkaar, dan staat er 850
 * - ook als iemand de formule ooit verandert.
 */
function herhalendeMaten(delen) {
    const uit = [];
    if (!delen || !delen.length) return uit;

    const hartVan = (d) => [0, 1, 2].map(i =>
        d.oorsprong[i] + d.xAs[i] * d.dx / 2
                       + d.yAs[i] * d.dy / 2
                       + d.zAs[i] * d.dz / 2);

    // Hart op hart tussen de eerste twee staanders.
    const staanders = delen.filter(d => d.soort === 'staander');
    if (staanders.length >= 2) {
        const a = hartVan(staanders[0]), b = hartVan(staanders[1]);
        const hoogte = staanders[0].oorsprong[2] + staanders[0].dz;
        uit.push({
            van: [a[0], a[1], hoogte], naar: [b[0], b[1], hoogte],
            richting: [0, 0, 1], waarde: afstand(a, b),
            tekst: `h.o.h. ${rond(afstand(a, b))}`,
        });
    }

    // De vrije doorgang tussen de eerste twee spijlen: van de rechterkant van
    // de ene tot de linkerkant van de volgende. Dat is de maat waar de
    // veiligheidsregel over gaat, niet hart op hart.
    const spijlen = delen.filter(d => d.soort === 'spijl');
    if (spijlen.length >= 2) {
        const a = spijlen[0], b = spijlen[1];
        const ha = hartVan(a), hb = hartVan(b);
        const hoh = afstand(ha, hb);
        const doorgang = hoh - a.dx;
        if (doorgang > 0) {
            // Midden op de hoogte van de spijl, zodat de maatlijn in het
            // vulveld hangt en niet onder het model.
            const z = a.oorsprong[2] + a.dz * 0.5;
            const richting = [0, 1, 2].map(i => (hb[i] - ha[i]) / hoh);
            const van = [0, 1, 2].map(i => ha[i] + richting[i] * (a.dx / 2));
            const naar = [0, 1, 2].map(i => hb[i] - richting[i] * (b.dx / 2));
            van[2] = naar[2] = z;
            uit.push({
                van, naar, richting: [0, 0, 1], waarde: doorgang,
                tekst: `doorgang ${rond(doorgang)}`,
            });
        }
    }

    // Optrede en aantrede van een trap: gemeten aan de eerste twee treden.
    // Alleen bij treden die recht langs X lopen: bij een wenteltrap draait elke
    // trede een stuk verder, en dan is het verschil in x geen aantrede.
    const treden = delen.filter(d => d.soort === 'trede'
            && d.xAs && d.xAs[0] === 1 && d.xAs[1] === 0)
        .sort((p, q) => p.oorsprong[2] - q.oorsprong[2]);
    if (treden.length >= 2) {
        const t1 = treden[0], t2 = treden[1];
        const optrede = (t2.oorsprong[2] + t2.dz) - (t1.oorsprong[2] + t1.dz);
        const aantrede = t2.oorsprong[0] - t1.oorsprong[0];
        const y = t1.oorsprong[1];

        uit.push({
            van: [t2.oorsprong[0], y, t1.oorsprong[2] + t1.dz],
            naar: [t2.oorsprong[0], y, t2.oorsprong[2] + t2.dz],
            richting: [1, 0, 0], waarde: optrede,
            tekst: `optrede ${rond(optrede)}`,
        });
        uit.push({
            van: [t1.oorsprong[0], y, t2.oorsprong[2] + t2.dz],
            naar: [t2.oorsprong[0], y, t2.oorsprong[2] + t2.dz],
            richting: [0, 0, 1], waarde: aantrede,
            tekst: `aantrede ${rond(aantrede)}`,
        });

        // En de helling, als los getal bij de voet van de trap. Een echte
        // hoekboog zou hier niets toevoegen: de hoek zit tussen de trapboom en
        // de vloer, en die vloer staat niet in het model.
        const graden = Math.atan2(optrede, aantrede) * 180 / Math.PI;
        uit.push({
            hoek: true,
            punt: [t1.oorsprong[0], y, t1.oorsprong[2]],
            tekst: `${rond(graden, 1)}°`,
        });
    }

    return uit;
}

const afstand = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
// GEEN DUIZENDTALSCHEIDING. In het Nederlands is dat een punt, en "h.o.h.
// 1.700" op een maatvoering kan gelezen worden als één komma zeven. Bij een
// maat hoort een kaal getal; de eenheid staat elders.
const rond = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d)
    .toLocaleString('nl', { maximumFractionDigits: d, useGrouping: false });

/**
 * Eén maatlijn: de lijn zelf, twee hulplijnen aan de uiteinden, en het getal.
 *
 * `richting` is waar de hulplijnen heen steken; die staat loodrecht op de maat.
 */
function maatlijn(van, naar, richting, waarde, h, tekst = null) {
    if (!(waarde > 0)) return null;

    const groep = new THREE.Group();
    const a = new THREE.Vector3(...van);
    const b = new THREE.Vector3(...naar);
    const uit = new THREE.Vector3(...richting).normalize().multiplyScalar(h);

    const stof = new THREE.LineBasicMaterial({ color: KLEUR });
    const lijn = (punten) => new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(punten), stof);

    groep.add(lijn([a, b]));
    // Hulplijntjes: een streepje over de maatlijn heen aan elk uiteinde, zodat
    // je ziet waar de maat precies begint en eindigt.
    for (const p of [a, b]) {
        groep.add(lijn([p.clone().sub(uit), p.clone().add(uit)]));
    }

    const midden = a.clone().add(b).multiplyScalar(0.5).add(uit);
    groep.add(getal(tekst || rond(waarde), midden, h));
    return groep;
}

/** Alleen een getal op een plek, zonder lijn. Voor een hoek. */
function hoekMaat(punt, tekst, h) {
    const groep = new THREE.Group();
    groep.add(getal(tekst, new THREE.Vector3(...punt), h * 1.2));
    return groep;
}

/**
 * Het getal, als sprite met een canvas-textuur.
 *
 * Een sprite draait altijd naar de kijker toe, dus de maat blijft leesbaar hoe
 * je het model ook draait. Dezelfde aanpak als de letters op het assenkruis.
 *
 * `depthTest: false` zet hem vóór het model. Een maat die half achter een
 * staander verdwijnt is onleesbaar, en bij een bemating wil je het getal zien,
 * niet weten wat ervoor staat.
 */
function getal(tekst, plek, h) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: maakTekstTextuur(tekst),
        depthTest: false,
        transparent: true,
    }));
    sprite.position.copy(plek);
    // De textuur is vier keer zo breed als hoog; die verhouding moet terug in
    // de schaal, anders staat de tekst uitgerekt.
    sprite.scale.set(h * 8, h * 2, 1);
    sprite.renderOrder = 10;
    return sprite;
}

function maakTekstTextuur(tekst) {
    const breed = 256, hoog = 64;
    const canvas = document.createElement('canvas');
    canvas.width = breed;
    canvas.height = hoog;
    const ctx = canvas.getContext('2d');

    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Een lichte achtergrond onder de tekst: zonder dat valt een blauw getal
    // weg tegen een grijze staander.
    const breedte = ctx.measureText(tekst).width + 18;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect((breed - breedte) / 2, 6, breedte, hoog - 12);

    ctx.fillStyle = KLEUR_TEKST;
    ctx.fillText(tekst, breed / 2, hoog / 2);

    const textuur = new THREE.CanvasTexture(canvas);
    textuur.needsUpdate = true;
    return textuur;
}
