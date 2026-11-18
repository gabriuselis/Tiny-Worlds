import * as THREE from 'three';

// Pooled "+1" style labels anchored to planet-local positions and projected to
// screen space. Small HTML overlay so the text stays crisp at any zoom.
interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
  duration: number;
  active: boolean;
}

export class FloatingTextPool {
  private items: Floater[] = [];
  private tmp = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private parent: THREE.Object3D,
    max = 8,
  ) {
    for (let i = 0; i < max; i++) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;display:none;' +
        'font-family:system-ui,sans-serif;font-weight:800;font-size:14px;color:#ffe08a;' +
        'text-shadow:0 1px 3px rgba(0,0,0,0.85);white-space:nowrap;transform:translate(-50%,-50%);';
      document.body.appendChild(el);
      this.items.push({ el, pos: new THREE.Vector3(), age: 0, duration: 0.8, active: false });
    }
  }

  spawn(localPos: THREE.Vector3, text = '+1 \u{1FAB5}'): void {
    let slot: Floater | undefined = this.items.find((f) => !f.active);
    if (!slot) {
      slot = this.items.reduce((a, b) => (a.age > b.age ? a : b));
    }
    slot.pos.copy(localPos);
    slot.age = 0;
    slot.duration = 0.8;
    slot.active = true;
    slot.el.textContent = text;
    slot.el.style.display = 'block';
  }

  update(dt: number): void {
    let any = false;
    for (const f of this.items) {
      if (!f.active) continue;
      any = true;
      f.age += dt;
      if (f.age >= f.duration) {
        f.active = false;
        f.el.style.display = 'none';
        continue;
      }
      this.tmp.copy(f.pos).applyMatrix4(this.parent.matrixWorld).project(this.camera);
      if (this.tmp.z > 1) {
        f.el.style.display = 'none';
        continue;
      }
      f.el.style.display = 'block';
      const x = (this.tmp.x * 0.5 + 0.5) * window.innerWidth;
      const rise = (f.age / f.duration) * 42;
      const y = (-this.tmp.y * 0.5 + 0.5) * window.innerHeight - rise;
      const fade = f.age > f.duration * 0.6 ? 1 - (f.age - f.duration * 0.6) / (f.duration * 0.4) : 1;
      f.el.style.left = `${x.toFixed(1)}px`;
      f.el.style.top = `${y.toFixed(1)}px`;
      f.el.style.opacity = fade.toFixed(2);
    }
    if (!any) return;
  }

  clear(): void {
    for (const f of this.items) {
      f.active = false;
      f.el.style.display = 'none';
    }
  }
}
