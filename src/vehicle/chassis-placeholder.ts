import * as THREE from 'three';

/**
 * ⚠️ PLACEHOLDER CHASSIS MESH — PROCEDURAL STAND-IN ⚠️
 * ----------------------------------------------------
 * This is NOT the art-pass wagon. It exists purely so the physics body has a
 * visible, correctly-proportioned proxy during integration. The real estate
 * wagon (wood trim, round headlights, roof rack, warm aged paint) arrives in
 * the visual pass; every material/geometry here is disposable.
 *
 * Local frame matches the vehicle controller: forward = +Z, up = +Y.
 */

export const PLACEHOLDER_NOTE =
  'placeholder chassis mesh — procedural stand-in, replaced by visual pass';

const PAINT = 0xa8562f; // warm faded terracotta-brown "old estate" paint
const WOOD = 0x8a5a33;
const CREAM = 0xe6dcc6;

export function createPlaceholderWagon(): THREE.Group {
  const g = new THREE.Group();
  g.name = PLACEHOLDER_NOTE;

  const paint = new THREE.MeshStandardMaterial({ color: PAINT, roughness: 0.85 });
  const wood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.9 });
  const cream = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.7 });

  // Main body: 1.7 m wide, ~1.1 m tall, 4.1 m long (half-extents in geometry).
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 3.9), paint);
  body.position.y = 0.45;
  g.add(body);

  // Cabin/glasshouse slightly narrower.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.2), cream);
  cabin.position.set(0, 0.95, -0.15);
  g.add(cabin);

  // Wood trim strips along the flanks (the estate-wagon tell).
  for (const side of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 3.6), wood);
    trim.position.set(side * 0.82, 0.42, 0);
    g.add(trim);
  }

  // Round headlight discs on the front face (+Z).
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 20),
      new THREE.MeshBasicMaterial({ color: 0xf0b24b }),
    );
    lamp.position.set(side * 0.5, 0.5, 1.96);
    g.add(lamp);
  }

  // Roof rack: two cross bars + two rails.
  for (const z of [-0.9, 0.5]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.08), wood);
    bar.position.set(0, 1.24, z);
    g.add(bar);
  }
  for (const x of [-0.6, 0.6]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 1.6), wood);
    rail.position.set(x, 1.21, -0.2);
    g.add(rail);
  }

  // Wheels: cylinders aligned to the X axle.
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x22201d, roughness: 1 });
  const wheelPos: ReadonlyArray<readonly [number, number, string]> = [
    [-0.78, 1.25, 'wheelLF'],
    [0.78, 1.25, 'wheelRF'],
    [-0.78, -1.3, 'wheelLR'],
    [0.78, -1.3, 'wheelRR'],
  ];
  for (const [x, z, name] of wheelPos) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.name = name;
    w.position.set(x, 0.34, z);
    g.add(w);
  }

  return g;
}
