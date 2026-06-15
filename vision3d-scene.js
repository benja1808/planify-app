// vision3d-scene.js — Módulo Three.js de la escena del portaescobillas.
// Cargado dinámicamente desde vision3d.js. Exporta createScene(host) que
// retorna { destroy } para liberar GPU/CPU cuando se cierre el visor.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export async function createScene(host, options = {}) {
    const onBrushClick = typeof options.onBrushClick === 'function' ? options.onBrushClick : null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x23262c);
    scene.fog = new THREE.Fog(0x23262c, 14, 30);

    const w0 = host.clientWidth || 800;
    const h0 = host.clientHeight || 500;

    const camera = new THREE.PerspectiveCamera(50, w0 / h0, 0.1, 100);
    camera.position.set(3.4, 2.8, 4.4);
    camera.lookAt(0, 0.6, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w0, h0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.6;
    host.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(w0, h0);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    host.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.5;
    controls.maxDistance = 12;
    controls.target.set(0, 0.6, 0);

    // ── Iluminación ──
    scene.add(new THREE.AmbientLight(0xffb070, 0.9));
    scene.add(new THREE.HemisphereLight(0x9db4d8, 0x553311, 1.1));

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3, 7, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -5; keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 5;  keyLight.shadow.camera.bottom = -5;
    scene.add(keyLight);

    const thermalLight = new THREE.PointLight(0xff4500, 40, 20, 2);
    thermalLight.position.set(-4, 1.5, -2);
    scene.add(thermalLight);
    const backFill = new THREE.DirectionalLight(0xaabbdd, 1.2);
    backFill.position.set(-3, 4, -5);
    scene.add(backFill);
    const fill = new THREE.PointLight(0xff8c42, 15, 12, 2);
    fill.position.set(0, -1, 2);
    scene.add(fill);
    const ringGlow = new THREE.PointLight(0xffa050, 25, 6, 2);
    ringGlow.position.set(0, 0.6, 0);
    scene.add(ringGlow);

    // ── Piso ──
    const grid = new THREE.GridHelper(14, 28, 0x4a5160, 0x32363f);
    grid.position.y = -1.05;
    scene.add(grid);
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(7, 48),
        new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.2, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.06;
    floor.receiveShadow = true;
    scene.add(floor);
    const dust = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 2.3, 48),
        new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    dust.rotation.x = -Math.PI / 2;
    dust.position.y = -1.045;
    scene.add(dust);

    // ── Textura del colector ──
    function makeCollectorTexture() {
        const cv = document.createElement('canvas');
        cv.width = 1024; cv.height = 256;
        const g = cv.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, '#8a5524'); grad.addColorStop(0.5, '#c08040'); grad.addColorStop(1, '#7a4a1e');
        g.fillStyle = grad; g.fillRect(0, 0, 1024, 256);
        for (let i = 0; i < 90; i++) {
            const y = Math.random() * 256;
            g.strokeStyle = `rgba(${40 + Math.random()*40|0},${20 + Math.random()*20|0},5,${0.06 + Math.random()*0.1})`;
            g.lineWidth = 0.6 + Math.random() * 1.2;
            g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke();
        }
        [0.1, 0.5, 0.9].forEach(v => {
            const y = v * 256;
            const band = g.createLinearGradient(0, y - 16, 0, y + 16);
            band.addColorStop(0, 'rgba(255,210,150,0)');
            band.addColorStop(0.5, 'rgba(255,215,160,0.55)');
            band.addColorStop(1, 'rgba(255,210,150,0)');
            g.fillStyle = band; g.fillRect(0, y - 16, 1024, 32);
            g.fillStyle = 'rgba(25,12,4,0.35)';
            g.fillRect(0, y - 20, 1024, 4); g.fillRect(0, y + 16, 1024, 4);
        });
        for (let i = 0; i < 60; i++) {
            const x = Math.random() * 1024, y = Math.random() * 256;
            const r = 4 + Math.random() * 18;
            const spot = g.createRadialGradient(x, y, 0, x, y, r);
            spot.addColorStop(0, `rgba(${30+Math.random()*30|0},15,5,${0.05 + Math.random()*0.12})`);
            spot.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = spot; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
        }
        const tex = new THREE.CanvasTexture(cv);
        tex.wrapS = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    const matCollector = new THREE.MeshStandardMaterial({
        map: makeCollectorTexture(), color: 0xffffff, metalness: 0.85, roughness: 0.35,
        emissive: 0x200800, emissiveIntensity: 1.0
    });
    const matBrass = new THREE.MeshStandardMaterial({ color: 0xb5995a, metalness: 0.95, roughness: 0.28 });
    const matShaft = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.85, roughness: 0.3 });
    const matHousing = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.5 });
    const matHousingBlue = new THREE.MeshStandardMaterial({ color: 0x4a6fa5, metalness: 0.6, roughness: 0.5 });
    const matSpring = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.7, roughness: 0.35 });
    const matArm = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.7, roughness: 0.4 });

    function makeBrushMaterial() {
        return new THREE.MeshStandardMaterial({
            metalness: 0.1, roughness: 0.8, vertexColors: true,
            emissive: 0x331100, emissiveIntensity: 0.55
        });
    }
    function brushGeometryWithGradient(w, h, d) {
        const geo = new THREE.BoxGeometry(w, h, d, 1, 1, 4);
        const pos = geo.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const cHot = new THREE.Color(0xff6b35), cCold = new THREE.Color(0x3b3b3b);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            const t = 1 - ((pos.getZ(i) / d) + 0.5);
            c.copy(cCold).lerp(cHot, Math.pow(t, 1.6));
            colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return geo;
    }

    // ── Rotor (anillo + ejes) ──
    const rotor = new THREE.Group(); scene.add(rotor);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.4, 64), matCollector);
    ring.position.y = 0.6; ring.castShadow = true; ring.receiveShadow = true; rotor.add(ring);
    for (const dy of [-0.2, 0.2]) {
        const lip = new THREE.Mesh(
            new THREE.TorusGeometry(1.2, 0.015, 10, 72),
            new THREE.MeshStandardMaterial({ color: 0x9a6a30, metalness: 0.95, roughness: 0.25 })
        );
        lip.rotation.x = Math.PI / 2; lip.position.y = 0.6 + dy; rotor.add(lip);
    }
    const shaftTop = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.0, 32), matShaft);
    shaftTop.position.y = 1.3; shaftTop.castShadow = true; rotor.add(shaftTop);
    const shaftBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 32), matShaft);
    shaftBottom.position.y = -0.2; shaftBottom.castShadow = true; rotor.add(shaftBottom);
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.05), matArm);
    key.position.set(0.21, 1.3, 0); rotor.add(key);

    function buildSpring(turns = 4, radius = 0.05, wire = 0.011, pitch = 0.028) {
        const g = new THREE.Group();
        for (let i = 0; i < turns; i++) {
            const seg = new THREE.Mesh(new THREE.TorusGeometry(radius, wire, 6, 20), matSpring);
            seg.rotation.x = Math.PI / 2; seg.rotation.z = (i % 2) * 0.3;
            seg.position.y = i * pitch; g.add(seg);
        }
        return g;
    }

    const RING_R = 1.2, HOLDER_R = 1.6, GAP = HOLDER_R - RING_R;
    const BRUSH_W = 0.18, BRUSH_H = 0.12, BRUSH_LEN = 0.45;

    // Lista de mallas de escobilla, para raycaster (click → mostrar última medición)
    const brushMeshes = [];

    for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        const ux = Math.sin(angle), uz = Math.cos(angle);
        const assembly = new THREE.Group();
        assembly.position.set(ux * HOLDER_R, 0.6, uz * HOLDER_R);
        assembly.lookAt(0, 0.6, 0);
        assembly.rotateY(Math.PI);
        scene.add(assembly);

        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.15), i % 2 === 0 ? matHousing : matHousingBlue);
        housing.castShadow = true; housing.receiveShadow = true; assembly.add(housing);

        [[0.1, 0.21], [-0.1, 0.21], [0.1, -0.21], [-0.1, -0.21]].forEach(([bx, by]) => {
            const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 6), matShaft);
            bolt.rotation.x = Math.PI / 2; bolt.position.set(bx, by, 0.085); assembly.add(bolt);
        });

        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.45), matArm);
        arm.position.z = 0.3; arm.castShadow = true; assembly.add(arm);

        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 20), matBrass);
        post.position.set(0, -0.3, 0.55); post.castShadow = true; assembly.add(post);

        [0.16, 0, -0.16].forEach(cy => {
            const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.14), matBrass);
            clamp.position.set(0, cy, 0.55); clamp.castShadow = true; assembly.add(clamp);
            const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.035, 6), matShaft);
            nut.rotation.x = Math.PI / 2; nut.position.set(0, cy, 0.47); nut.castShadow = true; assembly.add(nut);
            const boltSide = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 6), matShaft);
            boltSide.rotation.z = Math.PI / 2; boltSide.position.set(0.09, cy, 0.55); assembly.add(boltSide);
        });

        const brushYs = [0.16, 0, -0.16];
        const sleeveColors = [0xd35427, 0xd8d8d2, 0xd8d8d2];
        brushYs.forEach((by, bi) => {
            const brushGroup = new THREE.Group(); brushGroup.position.y = by; assembly.add(brushGroup);
            const brush = new THREE.Mesh(brushGeometryWithGradient(BRUSH_W, BRUSH_H, BRUSH_LEN), makeBrushMaterial());
            brush.position.z = -GAP + BRUSH_LEN / 2; brush.castShadow = true; brushGroup.add(brush);
            // Metadata para raycaster: portaesc 1-4, escobilla 1-3 → label "Escobilla 1-1" ... "Escobilla 4-3"
            const portaId = i + 1;
            const brushId = bi + 1;
            brush.userData = {
                isBrush: true,
                portaId,
                brushId,
                label: `Escobilla ${portaId}-${brushId}`,
                originalEmissive: 0.55
            };
            brushMeshes.push(brush);

            const guide = new THREE.Mesh(new THREE.BoxGeometry(BRUSH_W + 0.05, BRUSH_H + 0.045, 0.28), i % 2 === 0 ? matHousingBlue : matHousing);
            guide.position.z = -0.1; guide.castShadow = true; brushGroup.add(guide);
            const spring = buildSpring(4);
            spring.rotation.x = Math.PI / 2; spring.position.set(0, BRUSH_H / 2 + 0.05, -0.18); brushGroup.add(spring);
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, BRUSH_H / 2 - 0.01, 0.02),
                new THREE.Vector3(0.07, BRUSH_H / 2 + 0.13, 0.12),
                new THREE.Vector3(0.1, BRUSH_H / 2 + 0.17, 0.28),
                new THREE.Vector3(0.04, BRUSH_H / 2 + 0.08, 0.42),
                new THREE.Vector3(0, 0.02, 0.5)
            ]);
            const pig = new THREE.Mesh(
                new THREE.TubeGeometry(curve, 28, 0.02, 8, false),
                new THREE.MeshStandardMaterial({ color: sleeveColors[bi], metalness: 0.05, roughness: 0.92 })
            );
            pig.castShadow = true; brushGroup.add(pig);
            const term = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.035, 10), matShaft);
            term.rotation.x = Math.PI / 2; term.position.set(0, BRUSH_H / 2, 0.03); brushGroup.add(term);
        });

        const div = document.createElement('div');
        div.className = 'v3d-lbl';
        div.textContent = `Portaescobillas ${i + 1}`;
        const lbl = new CSS2DObject(div);
        lbl.position.set(0, 0.48, 0.1); assembly.add(lbl);
    }

    // ── Raycaster: click en escobilla → callback con info + hover highlight ──
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredBrush = null;

    function updatePointer(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function pickBrush() {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(brushMeshes, false);
        return hits.length ? hits[0].object : null;
    }

    function setHover(brush) {
        if (hoveredBrush === brush) return;
        if (hoveredBrush) {
            hoveredBrush.material.emissiveIntensity = hoveredBrush.userData.originalEmissive;
        }
        hoveredBrush = brush;
        if (brush) {
            brush.material.emissiveIntensity = 1.4; // resalta la escobilla al pasar el mouse
            renderer.domElement.style.cursor = 'pointer';
        } else {
            renderer.domElement.style.cursor = 'grab';
        }
    }

    // El hover usa pointermove pero solo cuando NO se está arrastrando la cámara
    let isDragging = false;
    let dragStart = null;
    const DRAG_THRESHOLD = 5; // px

    function onPointerDown(event) {
        if (event.button !== 0) return;
        dragStart = { x: event.clientX, y: event.clientY };
        isDragging = false;
    }
    function onPointerMove(event) {
        if (dragStart) {
            const dx = event.clientX - dragStart.x;
            const dy = event.clientY - dragStart.y;
            if (Math.hypot(dx, dy) > DRAG_THRESHOLD) isDragging = true;
        }
        if (!isDragging) {
            updatePointer(event);
            setHover(pickBrush());
        }
    }
    function onPointerUp(event) {
        if (event.button !== 0) { dragStart = null; return; }
        if (!isDragging && dragStart && onBrushClick) {
            updatePointer(event);
            const brush = pickBrush();
            if (brush) {
                const rect = renderer.domElement.getBoundingClientRect();
                onBrushClick({
                    portaId: brush.userData.portaId,
                    brushId: brush.userData.brushId,
                    label: brush.userData.label,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    relX: event.clientX - rect.left,
                    relY: event.clientY - rect.top
                });
            }
        }
        dragStart = null;
        isDragging = false;
    }
    function onPointerLeave() {
        setHover(null);
        dragStart = null;
        isDragging = false;
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.style.cursor = 'grab';

    // ── Partículas de calor ──
    const sparkGeo = new THREE.BufferGeometry();
    const N_SPARKS = 60;
    const sparkPos = new Float32Array(N_SPARKS * 3);
    const sparkSeed = new Float32Array(N_SPARKS);
    for (let i = 0; i < N_SPARKS; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 1.18 + Math.random() * 0.1;
        sparkPos[i*3] = Math.sin(a) * r;
        sparkPos[i*3+1] = 0.4 + Math.random() * 0.5;
        sparkPos[i*3+2] = Math.cos(a) * r;
        sparkSeed[i] = Math.random() * Math.PI * 2;
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({
        color: 0xffa040, size: 0.025, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    scene.add(sparks);

    // ── Loop ──
    const clock = new THREE.Clock();
    let rafId = 0;
    let alive = true;
    function animate() {
        if (!alive) return;
        rafId = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        rotor.rotation.y = t * 0.55;
        matCollector.emissiveIntensity = 0.85 + Math.sin(t * 1.4) * 0.25;
        const p = sparkGeo.attributes.position;
        for (let i = 0; i < N_SPARKS; i++) {
            let y = p.getY(i) + 0.0016 + Math.sin(t * 2 + sparkSeed[i]) * 0.0004;
            if (y > 1.15) y = 0.42;
            p.setY(i, y);
        }
        p.needsUpdate = true;
        controls.update();
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
    }
    animate();

    // Resize observer: el canvas debe seguir el tamaño del tab-pane
    const ro = new ResizeObserver(() => {
        const w = host.clientWidth, h = host.clientHeight;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        labelRenderer.setSize(w, h);
    });
    ro.observe(host);

    return {
        destroy() {
            alive = false;
            cancelAnimationFrame(rafId);
            ro.disconnect();
            renderer.domElement.removeEventListener('pointerdown', onPointerDown);
            renderer.domElement.removeEventListener('pointermove', onPointerMove);
            renderer.domElement.removeEventListener('pointerup', onPointerUp);
            renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
            controls.dispose();
            scene.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    mats.forEach(m => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                }
            });
            renderer.dispose();
            pmrem.dispose();
            if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
            if (labelRenderer.domElement.parentNode) labelRenderer.domElement.parentNode.removeChild(labelRenderer.domElement);
        }
    };
}
