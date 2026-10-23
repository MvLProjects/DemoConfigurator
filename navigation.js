// Navigatiehulpmiddelen voor de viewer:
//   - een assenkruis linksonder, dat laat zien hoe het model georienteerd staat
//   - een navigatiekubus rechtsboven om snel naar een standaardaanzicht te gaan
//
// Allebei worden ze in DEZELFDE canvas getekend, via setViewport/setScissor.
// Dat scheelt een tweede WebGL-context en ze blijven vanzelf scherp.
//
// Assenstelsel: Z-omhoog. Dat is de afspraak in HiCAD, Onshape en STEP, en de
// modellen die we inladen gaan daarvan uit. Three.js staat standaard op
// Y-omhoog, dus dat moet in main.js omgezet worden (camera.up).

import * as THREE from 'three';

const KUBUS_PX = 116;   // afmeting van de navigatiekubus op het scherm
const ASSEN_PX = 104;   // afmeting van het assenkruis
const MARGE_PX = 12;
// De knoppenbalk bovenin ligt over de canvas heen, dus de kubus moet daaronder
// beginnen; anders valt de bovenkant erachter weg.
const MARGE_BOVEN_PX = 56;

// Welke kant is wat, met Z omhoog.
const VLAKKEN = [
    { as: 'x', teken: +1, label: 'RECHTS' },
    { as: 'x', teken: -1, label: 'LINKS' },
    { as: 'y', teken: +1, label: 'ACHTER' },
    { as: 'y', teken: -1, label: 'VOOR' },
    { as: 'z', teken: +1, label: 'BOVEN' },
    { as: 'z', teken: -1, label: 'ONDER' },
];

// BoxGeometry levert zijn vlakken in deze volgorde: +X, -X, +Y, -Y, +Z, -Z.
// De tekst op een vlak moet meedraaien met de kijkrichting, anders staat hij
// op zijn kop zodra je van boven of van opzij kijkt.
const TEKST_ROTATIE = [
    -Math.PI / 2,  // +X rechts
    Math.PI / 2,   // -X links
    Math.PI,       // +Y achter
    0,             // -Y voor
    0,             // +Z boven
    0,             // -Z onder
];

export function maakNavigatie({ renderer, camera, controls, viewportEl }) {
    // --- assenkruis ---------------------------------------------------------
    const assenScene = new THREE.Scene();
    const assenCamera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 100);
    const assenGroep = new THREE.Group();
    assenScene.add(assenGroep);

    assenGroep.add(maakPijl(new THREE.Vector3(1, 0, 0), 0xd64545, 'X'));
    assenGroep.add(maakPijl(new THREE.Vector3(0, 1, 0), 0x3d9a50, 'Y'));
    assenGroep.add(maakPijl(new THREE.Vector3(0, 0, 1), 0x3b6fd4, 'Z'));

    // --- navigatiekubus -----------------------------------------------------
    const kubusScene = new THREE.Scene();
    const kubusCamera = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 100);
    kubusScene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const kubusLicht = new THREE.DirectionalLight(0xffffff, 0.5);
    kubusLicht.position.set(2, 3, 4);
    kubusScene.add(kubusLicht);

    const kubus = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        VLAKKEN.map((vlak, i) => new THREE.MeshBasicMaterial({
            map: maakTekstTextuur(vlak.label, TEKST_ROTATIE[i]),
        }))
    );
    kubusScene.add(kubus);

    // Randen erop, anders is de kubus tegen een lichte achtergrond niet te zien.
    kubusScene.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(kubus.geometry),
        new THREE.LineBasicMaterial({ color: 0x8b969f })
    ));

    // Markering van het gebied waar de muis boven hangt.
    const markering = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff8a2b, transparent: true, opacity: 0.85 })
    );
    markering.visible = false;
    kubusScene.add(markering);

    const tip = document.createElement('div');
    tip.className = 'navTip';
    tip.style.display = 'none';
    viewportEl.appendChild(tip);

    // --- gedeelde staat -----------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const muis = new THREE.Vector2();
    let animatie = null; // lopende camerabeweging

    function kubusVak() {
        // Waar staat de kubus op het scherm? (CSS-pixels, oorsprong linksboven)
        const b = renderer.domElement.getBoundingClientRect();
        return {
            links: b.width - MARGE_PX - KUBUS_PX,
            boven: MARGE_BOVEN_PX,
            maat: KUBUS_PX,
            rect: b,
        };
    }

    /** Ligt de muis boven de navigatiekubus? main.js gebruikt dit om te
     *  voorkomen dat een klik op de kubus ook het model selecteert. */
    function boveKubus(event) {
        const v = kubusVak();
        const x = event.clientX - v.rect.left;
        const y = event.clientY - v.rect.top;
        return x >= v.links && x <= v.links + v.maat
            && y >= v.boven && y <= v.boven + v.maat;
    }

    function raakpunt(event) {
        const v = kubusVak();
        const x = event.clientX - v.rect.left - v.links;
        const y = event.clientY - v.rect.top - v.boven;
        muis.x = (x / v.maat) * 2 - 1;
        muis.y = -(y / v.maat) * 2 + 1;

        raycaster.setFromCamera(muis, kubusCamera);
        const treffers = raycaster.intersectObject(kubus, false);
        if (treffers.length === 0) return null;

        // Het raakpunt omzetten naar een kijkrichting. Elk assendeel dat ver
        // genoeg van het midden ligt telt mee. Zo krijg je met een gewone kubus
        // niet alleen de 6 vlakken, maar ook de 12 ribben en de 8 hoeken:
        //   midden van een vlak -> vooraanzicht
        //   bij een ribbe       -> aanzicht schuin tussen twee vlakken
        //   bij een hoek        -> isometrisch aanzicht
        const lokaal = kubus.worldToLocal(treffers[0].point.clone());
        const richting = new THREE.Vector3(
            snap(lokaal.x), snap(lokaal.y), snap(lokaal.z));

        if (richting.lengthSq() === 0) return null;
        return richting;
    }

    function snap(waarde) {
        // Half zo groot als de kubus (1.0) betekent: precies op het vlak.
        if (waarde > 0.62) return 1;
        if (waarde < -0.62) return -1;
        return 0;
    }

    function naamVan(richting) {
        const delen = [];
        if (richting.z > 0) delen.push('boven');
        if (richting.z < 0) delen.push('onder');
        if (richting.y < 0) delen.push('voor');
        if (richting.y > 0) delen.push('achter');
        if (richting.x > 0) delen.push('rechts');
        if (richting.x < 0) delen.push('links');
        return delen.join('-');
    }

    // --- muisafhandeling ----------------------------------------------------
    renderer.domElement.addEventListener('pointermove', (event) => {
        if (!boveKubus(event)) {
            markering.visible = false;
            tip.style.display = 'none';
            return;
        }
        const richting = raakpunt(event);
        if (!richting) {
            markering.visible = false;
            tip.style.display = 'none';
            return;
        }
        // De markering op het oppervlak zetten: bij een vlak in het midden,
        // bij een hoek op de hoek.
        markering.position.copy(richting);
        markering.visible = true;

        tip.textContent = naamVan(richting);
        tip.style.display = 'block';
    });

    renderer.domElement.addEventListener('pointerleave', () => {
        markering.visible = false;
        tip.style.display = 'none';
    });

    /** Wordt door main.js aangeroepen bij een klik. Geeft true als de klik
     *  door de kubus is afgehandeld. */
    function verwerkKlik(event) {
        if (!boveKubus(event)) return false;
        const richting = raakpunt(event);
        if (richting) gaNaar(richting);
        return true;
    }

    /** Zet de camera in de gevraagde richting, met een vloeiende beweging. */
    function gaNaar(richting) {
        const doel = controls.target.clone();
        const afstand = camera.position.distanceTo(doel);
        const eind = doel.clone().addScaledVector(richting.clone().normalize(), afstand);

        // Kijk je recht van boven of van onder, dan valt de kijkrichting samen
        // met de 'omhoog'-richting en weet de camera niet meer wat boven is.
        //
        // In een bovenaanzicht hoort X naar rechts te wijzen en Y naar boven;
        // dat is de afspraak in elk CAD-pakket. Dat krijg je met +Y als
        // omhoog-richting. Voor het onderaanzicht is het -Y, want dan kijk je
        // van de andere kant en moet X nog steeds naar rechts wijzen.
        const recht = richting.x === 0 && richting.y === 0;
        const omhoog = recht ? new THREE.Vector3(0, Math.sign(richting.z), 0)
                             : new THREE.Vector3(0, 0, 1);

        animatie = {
            van: camera.position.clone(),
            naar: eind,
            vanOp: camera.up.clone(),
            naarOp: omhoog,
            start: performance.now(),
            duur: 420,
        };
    }

    /** Elke frame aanroepen, vlak voor het renderen. */
    function update() {
        if (animatie) {
            const t = Math.min(1, (performance.now() - animatie.start) / animatie.duur);
            const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
            camera.position.lerpVectors(animatie.van, animatie.naar, e);
            camera.up.copy(animatie.vanOp).lerp(animatie.naarOp, e).normalize();
            camera.lookAt(controls.target);
            if (t >= 1) animatie = null;
        }

        // Kubus en assenkruis meedraaien met de hoofdcamera. We zetten de
        // hulpcamera op vaste afstand in dezelfde kijkrichting; dan laat het
        // hulpje precies zien hoe het model erbij staat.
        const richting = camera.position.clone().sub(controls.target).normalize();

        kubusCamera.position.copy(richting).multiplyScalar(10);
        kubusCamera.up.copy(camera.up);
        kubusCamera.lookAt(0, 0, 0);

        assenCamera.position.copy(richting).multiplyScalar(10);
        assenCamera.up.copy(camera.up);
        assenCamera.lookAt(0, 0, 0);

        // Tekstballonnetje onder de kubus plaatsen.
        const v = kubusVak();
        tip.style.left = `${v.links}px`;
        tip.style.top = `${v.boven + v.maat + 4}px`;
        tip.style.width = `${v.maat}px`;
    }

    /** Na het renderen van de hoofdscene aanroepen. */
    function teken() {
        const canvas = renderer.domElement;
        const b = canvas.getBoundingClientRect();

        renderer.autoClear = false;
        renderer.setScissorTest(true);

        // WebGL rekent vanaf LINKSONDER, de CSS-plaatsing vanaf linksboven.
        tekenHoek(renderer, kubusScene, kubusCamera,
            b.width - MARGE_PX - KUBUS_PX, b.height - MARGE_BOVEN_PX - KUBUS_PX,
            KUBUS_PX, b.height);
        tekenHoek(renderer, assenScene, assenCamera,
            MARGE_PX, MARGE_PX, ASSEN_PX, b.height);

        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, b.width, b.height);
        renderer.autoClear = true;
    }

    function tekenHoek(renderer, scene, cam, links, onder, maat) {
        renderer.setViewport(links, onder, maat, maat);
        renderer.setScissor(links, onder, maat, maat);
        renderer.clearDepth();
        renderer.render(scene, cam);
    }

    /** Breekt een lopende camerabeweging af.
     *
     *  Nodig zodra iets anders de camera verzet - bijvoorbeeld het laden van
     *  een nieuw model. Zonder dit schrijft de nog lopende beweging de nieuwe
     *  camerastand weer over, met de afstand van het vorige model, en kijk je
     *  ineens van binnenuit tegen je model aan.
     */
    function stopAnimatie() {
        animatie = null;
    }

    return { update, teken, verwerkKlik, boveKubus, gaNaar, stopAnimatie };
}

// --- bouwstenen ------------------------------------------------------------

function maakPijl(richting, kleur, letter) {
    const groep = new THREE.Group();
    const lengte = 0.95;

    groep.add(new THREE.ArrowHelper(
        richting, new THREE.Vector3(0, 0, 0), lengte, kleur, 0.26, 0.16));

    const label = new THREE.Sprite(new THREE.SpriteMaterial({
        map: maakLetterTextuur(letter, kleur),
        depthTest: false,
    }));
    label.position.copy(richting).multiplyScalar(lengte + 0.28);
    label.scale.setScalar(0.52);
    groep.add(label);

    return groep;
}

function maakLetterTextuur(letter, kleur) {
    const maat = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = maat;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + kleur.toString(16).padStart(6, '0');
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, maat / 2, maat / 2);

    const textuur = new THREE.CanvasTexture(canvas);
    textuur.colorSpace = THREE.SRGBColorSpace;
    return textuur;
}

function maakTekstTextuur(tekst, rotatie) {
    const maat = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = maat;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#eef1f4';
    ctx.fillRect(0, 0, maat, maat);

    ctx.translate(maat / 2, maat / 2);
    ctx.rotate(rotatie);

    ctx.fillStyle = '#3c4650';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tekst, 0, 0);

    const textuur = new THREE.CanvasTexture(canvas);
    textuur.colorSpace = THREE.SRGBColorSpace;
    return textuur;
}
