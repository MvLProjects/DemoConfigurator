// Het voorbeeld in 3D, zonder OCCT.
//
// WAT DIT IS. De onderdelenlijst die padDelen en trapDelen opleveren bevat al
// alles wat een beeld nodig heeft: een oorsprong, drie assen en een doosje van
// dx bij dy bij dz. Deze module tekent die lijst rechtstreeks, zonder dat er een
// solid gebouwd of getessellleerd wordt. Zie PLAN-SNELHEID.md, fase 1.
//
// WAT DIT NIET IS. Een verstek, een zadel, een uitklinking of een gat wordt
// hier NIET gesneden. Een buis is een volle cilinder op zijn buitenmaat, een
// U-profiel is een doosje om zijn omtrek. Dat is een bewuste versimpeling: de
// echte vorm komt van OCCT, bij "Genereer". Wie hier sneden gaat namaken bouwt
// een tweede meetkundeketen, en die gaat vroeg of laat afwijken van de eerste.
//
// EÉN BRON. Er wordt hier niets uitgerekend. Elke maat komt uit dezelfde
// `delen` waar maakDeel op draait, en de plaatsing is dezelfde als die van
// plaatsing() in build-balustrade.js: de assen zijn de kolommen, de oorsprong
// is de verschuiving, en het doosje loopt vanuit zijn HOEK.

import * as THREE from 'three';
import { uiterlijkVanDeel } from './materialen.js';
import { isRond } from './profielen.js';

/**
 * Tekent een onderdelenlijst als three.js-groep.
 *
 * Alle doosjes van één materiaal worden samen één InstancedMesh, alle
 * cilinders ook: de maat zit in de matrix, niet in de geometrie. Een trap met
 * dertien treden en twee bomen wordt zo een handvol tekenopdrachten.
 *
 * @param delen  onderdelen zoals trapDelen of padDelen ze opleveren
 * @returns THREE.Group, met userData.voorbeeld = true
 */
export function maakVoorbeeld(delen) {
    const groep = new THREE.Group();
    groep.name = 'voorbeeld';
    groep.userData.voorbeeld = true;

    // Per vorm per materiaal: de matrices die erbij horen.
    const bakken = new Map();
    const materialen = new Map();
    const stofVoor = (uit) => {
        if (!materialen.has(uit.sleutel)) materialen.set(uit.sleutel, maakStof(uit));
        return materialen.get(uit.sleutel);
    };

    for (const d of delen || []) {
        const uit = uiterlijkVanDeel(d);

        if (d.omtrek) {
            // Een trapboom als plaat: zijn omtrek staat al in wereldcoördinaten
            // in het XZ-vlak. Dat is een eigen vorm, geen doosje.
            const mesh = new THREE.Mesh(plaatGeometrie(d), stofVoor(uit));
            mesh.userData.deel = d;
            groep.add(mesh);
            continue;
        }

        const vorm = vormVan(d);
        const sleutel = vorm + '|' + uit.sleutel;
        if (!bakken.has(sleutel)) bakken.set(sleutel, { vorm, uit, matrices: [] });
        bakken.get(sleutel).matrices.push(matrixVan(d));
    }

    for (const { vorm, uit, matrices } of bakken.values()) {
        const mesh = new THREE.InstancedMesh(eenheidsvorm(vorm), stofVoor(uit),
            matrices.length);
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        // Zonder dit rekent three.js de omhullende uit de eenheidsvorm, en
        // valt het model buiten beeld zodra de camera hem niet meer ziet.
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        groep.add(mesh);
    }

    return groep;
}

/** Ruimt de geometrie en de materialen van een voorbeeld op. */
export function ruimVoorbeeldOp(groep) {
    if (!groep || !groep.userData.voorbeeld) return;
    groep.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
        if (o.isInstancedMesh) o.dispose();
    });
}

/**
 * Welke vorm een onderdeel in het voorbeeld krijgt.
 *
 * Rond als OCCT er ook een cilinder van maakt: rondDeel (d.rond) loopt langs
 * zijn eigen z, een rond profiel langs zijn lengteAs. De rest is een doosje.
 */
function vormVan(d) {
    if (d.rond) return 'cilinder-z';
    if (d.profiel && isRond(d.profiel)) return 'cilinder-' + (d.lengteAs || 'z');
    return 'doos';
}

/**
 * De plaatsing van een onderdeel: dezelfde matrix als plaatsing() in
 * build-balustrade.js, met de maat van het doosje erin.
 *
 * Een profiel wordt in OCCT op zijn hart gezet en een blok op zijn hoek, maar
 * het OMHULLENDE doosje is in beide gevallen hetzelfde: vanaf de oorsprong dx
 * langs xAs, dy langs yAs, dz langs zAs. Daar tekenen we.
 */
function matrixVan(d) {
    const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...d.xAs).multiplyScalar(d.dx),
        new THREE.Vector3(...d.yAs).multiplyScalar(d.dy),
        new THREE.Vector3(...d.zAs).multiplyScalar(d.dz));
    m.setPosition(...d.oorsprong);
    return m;
}

/** Een eenheidsvorm die het doosje [0,1]³ vult; de matrix geeft de maat. */
function eenheidsvorm(vorm) {
    if (vorm === 'doos') {
        return new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    }
    // CylinderGeometry staat langs Y. Draai hem naar de as die het onderdeel
    // vraagt en zet hem in het midden van het doosje.
    const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    const as = vorm.slice(-1);
    if (as === 'z') g.rotateX(Math.PI / 2);
    if (as === 'x') g.rotateZ(-Math.PI / 2);
    return g.translate(0.5, 0.5, 0.5);
}

/**
 * Een plaat op maat, zoals maakPlaat in build-trap.js hem bouwt: de omtrek in
 * het XZ-vlak, dik gemaakt over d.dikte vanaf y = d.y.
 *
 * three.js extrudeert een vorm in het XY-vlak langs +Z. Het stelsel hieronder
 * legt die vorm-x op wereld-x, vorm-y op wereld-z en de extrusie op wereld -y.
 * Dat is rechtsdraaiend, dus de vlakken houden hun goede kant naar buiten; de
 * extrusie gaat daarom vanaf y = d.y + dikte terug naar d.y.
 */
function plaatGeometrie(d) {
    const vorm = new THREE.Shape(d.omtrek.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(vorm, { depth: d.dikte, bevelEnabled: false });
    g.applyMatrix4(new THREE.Matrix4().set(
        1, 0, 0, 0,
        0, 0, -1, d.y + d.dikte,
        0, 1, 0, 0,
        0, 0, 0, 1));
    return g;
}

/** Hetzelfde materiaal als buildMesh in main.js voor dit uiterlijk maakt. */
function maakStof(uit) {
    return new THREE.MeshStandardMaterial({
        color: uit.kleur, roughness: uit.ruwheid, metalness: 0.0,
        ...(uit.doorzichtig !== undefined ? {
            transparent: true,
            opacity: uit.doorzichtig,
            side: THREE.DoubleSide,
            depthWrite: false,
        } : {}),
    });
}
