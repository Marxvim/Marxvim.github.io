import * as THREE from 'three';

const ACCENT = 0x22d3ee;

/** Cells per axis, cell size, spacing — the lattice reads as a 4×4×4 block. */
const N = 4;
const S = 1.05;
const GAP = 1.22;

interface Cell {
  cell: THREE.Group;
  home: THREE.Vector3;
  line: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  face: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  dir: THREE.Vector3;
  spread: number;
  delay: number;
  spin: THREE.Vector3;
  edgeCore: boolean;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Decorative background: a lattice of wireframe cells that detonates outward as
 * the page is scrolled. Purely presentational — the page is fully readable if
 * this never initialises.
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
            spread: 4 + Math.random() * 9,
            delay: Math.random() * 0.35,
            spin: new THREE.Vector3(
              (Math.random() - 0.5) * 2.2,
              (Math.random() - 0.5) * 2.2,
              (Math.random() - 0.5) * 2.2,
            ),
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

    let progress = 0;
    let target = 0;
    const readScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      target = max > 0 ? clamp01(window.scrollY / max) : 0;
    };
    readScroll();

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

    on('scroll', readScroll, { passive: true });
    on('resize', readScroll);
    on('pointermove', onPointer, { passive: true });

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    /** Lay out every cell for a given scroll progress and draw one frame. */
    const draw = (elapsed: number) => {
      group.rotation.y = elapsed * 0.08 + pointer.x * 0.18 + progress * 1.1;
      group.rotation.x = Math.sin(elapsed * 0.14) * 0.12 - pointer.y * 0.12 + progress * 0.25;
      camera.position.z = 12 + progress * 5;

      for (const c of cells) {
        const p = smoothstep(clamp01((progress - c.delay) / (1 - c.delay)));
        c.cell.position.copy(c.home).addScaledVector(c.dir, p * c.spread);
        c.cell.rotation.set(c.spin.x * p, c.spin.y * p, c.spin.z * p);
        c.cell.scale.setScalar(1 - p * 0.45);
        c.line.material.opacity = 0.34 * (1 - p * 0.85) + (c.edgeCore ? 0.1 * (1 - p) : 0);
        c.face.material.opacity = 0.55 * (1 - p);
      }

      renderer.render(scene, camera);
    };

    const origin = performance.now();
    const seconds = () => (performance.now() - origin) / 1000;
    let last = 0;

    const tick = () => {
      this.#raf = requestAnimationFrame(tick);
      const elapsed = seconds();
      const dt = Math.min(elapsed - last, 0.1);
      last = elapsed;

      // Frame-rate independent easing: matches the design's 0.08/frame at 60fps.
      progress += (target - progress) * (1 - Math.pow(1 - 0.08, dt * 60));
      draw(elapsed);
    };

    const start = () => {
      if (this.#raf || reduceMotion.matches) return;
      last = seconds();
      tick();
    };
    const stop = () => {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    };

    // Reduced motion: render the lattice at rest, tracking scroll without
    // animating drift, spin or damping.
    const staticDraw = () => {
      readScroll();
      progress = target;
      draw(0);
    };

    const applyMotionPreference = () => {
      if (reduceMotion.matches) {
        stop();
        staticDraw();
        this.#teardown.push(() => window.removeEventListener('scroll', staticDraw));
        window.addEventListener('scroll', staticDraw, { passive: true });
      } else {
        window.removeEventListener('scroll', staticDraw);
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
