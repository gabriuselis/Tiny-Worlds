import * as THREE from 'three';
import { PLANET_RADIUS } from '../core/config/world';
import { cameraDirInPlanetSpace } from './planetSpace';
import type { GameState } from '../core/state';

interface AffordanceRing {
  mesh: THREE.Mesh;
  plotId: number;
  baseScale: number;
  phase: number;
}

export class LogPileAffordance {
  private rings: AffordanceRing[] = [];
  private ringGeometry: THREE.RingGeometry;
  private ringMaterial: THREE.MeshBasicMaterial;
  private camera: THREE.PerspectiveCamera;
  private planetGroup: THREE.Group;
  private cameraDir = new THREE.Vector3();
  private time = 0;

  constructor(camera: THREE.PerspectiveCamera, planetGroup: THREE.Group) {
    this.camera = camera;
    this.planetGroup = planetGroup;

    this.ringGeometry = new THREE.RingGeometry(0.08, 0.12, 32);
    this.ringGeometry.rotateX(-Math.PI / 2);
    
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  update(dt: number, state: GameState): void {
    this.time += dt;
    const logPlots = state.planets.verdant.plots.filter(
      (p) => p.state === 'logs' && (p.woodLeft ?? 0) > 0
    );
    const currentPlotIds = new Set(logPlots.map((p) => p.id));

    // Remove rings for collected piles (detach from the planet group; the
    // geometry is shared, so only the per-ring cloned material is disposed).
    for (let i = this.rings.length - 1; i >= 0; i--) {
      if (!currentPlotIds.has(this.rings[i].plotId)) {
        this.rings[i].mesh.removeFromParent();
        (this.rings[i].mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }

    // Camera direction for facing check, in planet-LOCAL space (computed once
    // per frame; the planet group rotates, so plot.dir stays local too).
    cameraDirInPlanetSpace(this.camera.position, this.planetGroup.quaternion, this.cameraDir);

    // Update existing and create new rings
    for (const plot of logPlots) {
      // Only show for camera-facing piles
      const dot = plot.dir.x * this.cameraDir.x + plot.dir.y * this.cameraDir.y + plot.dir.z * this.cameraDir.z;
      if (dot <= 0.05) continue;

      let ring = this.rings.find((r) => r.plotId === plot.id);
      if (!ring) {
        const mesh = new THREE.Mesh(this.ringGeometry, this.ringMaterial.clone());
        mesh.renderOrder = 5;
        this.planetGroup.add(mesh);
        ring = {
          mesh,
          plotId: plot.id,
          baseScale: 0.12,
          phase: Math.random() * Math.PI * 2,
        };
        this.rings.push(ring);
      }

      // Position ring at pile location
      const pos = new THREE.Vector3(plot.dir.x, plot.dir.y, plot.dir.z)
        .multiplyScalar(PLANET_RADIUS + 0.35);
      ring.mesh.position.copy(pos);
      ring.mesh.lookAt(0, 0, 0);
      ring.mesh.rotateX(-Math.PI / 2);

      // Pulsing animation
      const pulse = (Math.sin(this.time * 4 + ring.phase) + 1) * 0.5; // 0-1
      const scale = ring.baseScale * (0.7 + pulse * 0.5);
      ring.mesh.scale.setScalar(scale);

      // Fade in/out based on camera facing
      const opacity = Math.min(0.8, dot * 2) * (0.5 + pulse * 0.5);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  dispose(): void {
    for (const ring of this.rings) {
      ring.mesh.removeFromParent();
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
  }
}