import * as THREE from 'three';

const ACCENT = 0x22d3ee;

/** Cells per axis, cell size, spacing — the lattice reads as a 4×4×4 block. */
const N = 4;
const S = 1.05;
const GAP = 1.22;

/** How long a selection surge takes to cross the lattice and fade out. */
const SURGE_SECONDS = 1.3;

declare global {
  interface WindowEventMap {
    'marx:select': CustomEvent<{ index: number; total: number }>;
  }
}

interface Cell {
  cell: THREE.Group;
  home: THREE.Vector3;
  line: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  face: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  dir: THREE.Vector3;
  delay: number;
  edgeCore: boolean;
}

/**
 * Background fabric: a lattice of wireframe cells with routing pulses travelling
 * outward through the grid. It also answers `marx:select` from the systems
 * console by firing a directional surge, so the background reads as the thing
 * the interface is routing through. Purely presentational — the page is fully
 * readable if this never initialises.
 */
class MarxLattice extends HTMLElement {
  #raf = 0;
  #teardown: Array<() => void> = [];

  connectedCallback() {
    if (this.#teardown.length) return;
    this.#mount();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    for (const fn of this.#teardown.splice(0)) fn();
  }

  #mount() {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL (blocked, software-rendering disabled, old device): stay blank.
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = 'block';
    this.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.position.set(0, 0, 12);

    const group = new THREE.Group();
    scene.add(group);

    const box = new THREE.BoxGeometry(S, S, S);
    const edges = new THREE.EdgesGeometry(box);

    const cells: Cell[] = [];
    const half = (N - 1) / 2;

    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        for (let z = 0; z < N; z++) {
          const home = new THREE.Vector3((x - half) * GAP, (y - half) * GAP, (z - half) * GAP);
          const cell = new THREE.Group();
          cell.position.copy(home);

          const face = new THREE.Mesh(
            box,
            new THREE.MeshBasicMaterial({
              color: 0x0b1417,
              transparent: true,
              opacity: 0.55,
              depthWrite: false,
            }),
          );
          const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.34 }),
          );
          cell.add(face, line);
          group.add(cell);

          const dir = home.clone();
          if (dir.length() < 0.001) dir.set(0.2, 0.4, 0.3);
          dir.normalize();

          cells.push({
            cell,
            home,
            line,
            face,
            dir,
            delay: Math.random() * 0.35,
            edgeCore: Math.abs(home.x) < GAP && Math.abs(home.y) < GAP,
          });
        }
      }
    }

    const resize = () => {
      const w = this.clientWidth || 1;
      const h = this.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(this);
    this.#teardown.push(() => ro.disconnect());

    const pointer = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      window.addEventListener(type, fn, opts);
      this.#teardown.push(() => window.removeEventListener(type, fn, opts));
    };

    on('pointermove', onPointer, { passive: true });

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const origin = performance.now();
    const seconds = () => (performance.now() - origin) / 1000;

    // Each system in the console owns a heading; selecting one routes the surge
    // that way so the fabric visibly steers toward the chosen destination.
    const surge = { at: -SURGE_SECONDS, dir: new THREE.Vector3(0, 0, 1) };

    on('marx:select', (event) => {
      const { index, total } = event.detail;
      const angle = (index / Math.max(total, 1)) * Math.PI * 2;
      surge.dir.set(Math.cos(angle), Math.sin(angle), 0.4).normalize();
      surge.at = seconds();
    });

    /** Routing pulses travel outward through the lattice — a switch, not a detonation. */
    const draw = (elapsed: number) => {
      const since = elapsed - surge.at;
      const surging = since >= 0 && since < SURGE_SECONDS;
      const wave = since / SURGE_SECONDS;
      const gain = surging ? 1 - wave : 0;

      group.rotation.y = elapsed * 0.11 + pointer.x * 0.16 + gain * gain * 0.2;
      group.rotation.x = Math.sin(elapsed * 0.19) * 0.2 - pointer.y * 0.1;
      group.rotation.z = Math.sin(elapsed * 0.07) * 0.09;
      camera.position.z = 11.4 - gain * 0.55;

      const pulseA = (elapsed * 0.42) % 1;
      const pulseB = (elapsed * 0.23 + 0.5) % 1;

      for (const c of cells) {
        const dist = c.home.length();
        const norm = dist / 4.4;
        const hitA = Math.exp(-(((norm - pulseA) * 6.8) ** 2));
        const hitB = Math.exp(-(((norm - pulseB) * 8.4) ** 2)) * 0.5;

        // Cells facing the surge heading light hardest, so the pulse has a bearing.
        const aim = surging ? c.dir.dot(surge.dir) * 0.5 + 0.5 : 0;
        const hitS = surging
          ? Math.exp(-(((norm - wave) * 5) ** 2)) * (0.4 + 0.6 * aim) * (0.5 + 0.5 * gain)
          : 0;

        const hit = Math.max(hitA, hitB, hitS);
        const drift = 0.12 * Math.sin(elapsed * 0.9 + dist * 1.3 + c.delay * 4);

        c.cell.position.copy(c.home).addScaledVector(c.dir, drift);
        c.cell.rotation.set(0, elapsed * (c.edgeCore ? 0.22 : -0.16), hit * 0.35);
        c.cell.scale.setScalar(0.72 + hit * 0.48);
        c.line.material.opacity = 0.1 + hit * 0.62 + (c.edgeCore ? 0.08 : 0);
        c.face.material.opacity = 0.16 + hit * 0.4;
      }

      renderer.render(scene, camera);
    };

    const tick = () => {
      this.#raf = requestAnimationFrame(tick);
      draw(seconds());
    };

    const start = () => {
      if (this.#raf || reduceMotion.matches) return;
      tick();
    };
    const stop = () => {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    };

    const applyMotionPreference = () => {
      if (reduceMotion.matches) {
        stop();
        draw(0);
      } else {
        start();
      }
    };

    reduceMotion.addEventListener('change', applyMotionPreference);
    this.#teardown.push(() => reduceMotion.removeEventListener('change', applyMotionPreference));

    // Don't burn a GPU loop on a tab nobody is looking at.
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!reduceMotion.matches) start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.#teardown.push(() => document.removeEventListener('visibilitychange', onVisibility));

    this.#teardown.push(() => {
      box.dispose();
      edges.dispose();
      for (const c of cells) {
        c.face.material.dispose();
        c.line.material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    });

    applyMotionPreference();
  }
}

if (!customElements.get('marx-lattice')) {
  customElements.define('marx-lattice', MarxLattice);
}
