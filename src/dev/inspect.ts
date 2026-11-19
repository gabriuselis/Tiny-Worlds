import * as THREE from 'three';
import { PLANET_RADIUS } from '../core/config/world';
import { format } from '../core/money';
import { countPlotStates, logsWaiting } from '../core/game';
import { logEvent, showToast } from '../ui/ui';
import { ctx } from '../app/context';
import { planetRadius } from '../app/constants';
import { showError } from '../app/errors';
import { variantPools, shadowPool, logPool, stageScaleFor } from '../app/trees';
import { countVisibleTrees } from './treeTools';

// ===== Surface check: verify trees sit on (not inside / floating above) the planet =====
function meshRadiusOrSize(mesh: THREE.Mesh | THREE.LineSegments): string {
  if (!mesh.geometry) return 'no-geo';
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.attributes.position;
  if (!pos) return 'no-pos';
  let min = Infinity, max = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = Math.sqrt(x * x + y * y + z * z);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return `min=${min.toFixed(3)} max=${max.toFixed(3)}`;
}

function matSummary(m: THREE.Material): string {
  const transparent = m.transparent === true ? 'T' : '-';
  const depthWrite = m.depthWrite === false ? 'F' : 'T';
  const side = m.side === THREE.BackSide ? 'back' : (m.side === THREE.DoubleSide ? 'double' : 'front');
  return `mat(transp=${transparent} depthWrite=${depthWrite} side=${side})`;
}

export function installInspectHooks(): void {
  // Expose coverage stats for the dev menu debug display
  (window as any).__getCoverageStats = (): string => {
    const grid = ctx.grid;
    if (!grid) return 'Coverage: grid not ready';
    const plots = grid.plots;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    let yPos = 0, yNeg = 0, xPos = 0, xNeg = 0, zPos = 0, zNeg = 0;
    for (const p of plots) {
      const lat = Math.asin(Math.max(-1, Math.min(1, p.dir.y))) * 180 / Math.PI;
      const lon = Math.atan2(p.dir.z, p.dir.x) * 180 / Math.PI;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (p.dir.y > 0) yPos++; else if (p.dir.y < 0) yNeg++;
      if (p.dir.x > 0) xPos++; else if (p.dir.x < 0) xNeg++;
      if (p.dir.z > 0) zPos++; else if (p.dir.z < 0) zNeg++;
    }
    let meshInfo = '';
    if (variantPools) {
      for (let c = 0; c < variantPools.length; c++) meshInfo += ` variant${c}:${variantPools[c].count}`;
    }
    if (shadowPool) meshInfo += ` shadow:${shadowPool.count}`;
    if (logPool) meshInfo += ` log:${logPool.count}`;
    const equatorBand = grid.plots.filter((p: any) => Math.abs(p.dir.y) < 0.05).length;
    return `Plots: ${plots.length} | Y+:${yPos} Y-:${yNeg} X+:${xPos} X-:${xNeg} Z+:${zPos} Z-:${zNeg} equator:${equatorBand}${meshInfo}`;
  };

  // Workers debug: worker count, empty plots, id, role, AI state, chosen target plot id,
  // remaining time in the state and position.
  (window as any).__getWorkersDebug = (): string => {
    const state = ctx.state;
    const verdant = state.planets.verdant;
    const counts = countPlotStates(state);
    let lines = `Workers: ${verdant.workers.length} | empty plots: ${counts.empty} | plots: ${counts.total} | tick: ${ctx.frameCount}`;
    for (const w of verdant.workers) {
      const left = w.stateTimer !== undefined ? ` left=${w.stateTimer.toFixed(1)}s` : '';
      lines += `\n  ${w.id} ${w.role} ${w.state} target=${w.target ?? '-'}${left} pos=(${w.pos.x.toFixed(2)},${w.pos.y.toFixed(2)},${w.pos.z.toFixed(2)})`;
    }
    lines += `\nParticles alive: ${ctx.particles?.aliveCount ?? 0}`;
    return lines;
  };

  // Compact state summary used by the dev self-test.
  (window as any).__getStateSummary = () => {
    const state = ctx.state;
    const counts = countPlotStates(state);
    return {
      plots: counts.total,
      empty: counts.empty,
      sapling: counts.sapling,
      medium: counts.medium,
      grown: counts.grown,
      falling: counts.falling,
      logs: counts.logs,
      planted: counts.planted,
      harvested: state.planets.verdant.treesHarvested,
      logsWaiting: logsWaiting(state),
      wood: format(state.wood),
      woodToSell: format(state.woodToSell),
      visible: countVisibleTrees(),
      workers: state.planets.verdant.workers.length,
      credits: format(state.currencies.credits),
    };
  };

  (window as any).__listMeshes = (): string => {
    const lines: string[] = [];
    const walk = (obj: THREE.Object3D, prefix: string): void => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        const s = obj.scale;
        lines.push(`${prefix}${obj.name || '(unnamed)'} [${obj.type}] scale=(${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}) worldScale=${obj.getWorldScale(new THREE.Vector3()).length().toFixed(2)} radius=${meshRadiusOrSize(obj)} renderOrder=${obj.renderOrder} ${obj.material ? matSummary(obj.material) : ''}`);
      }
      obj.children.forEach((c) => walk(c, prefix + '  '));
    };
    walk(ctx.sceneAPI?.scene ?? new THREE.Scene(), '');
    return lines.join('\n');
  };

  (window as any).__surfaceCheck = (): void => {
    try {
      const { grid, planetMesh, sceneAPI, surfaceRadius } = ctx;
      if (!grid || !planetMesh || !sceneAPI) { showToast('Surface check: scene not ready'); return; }
      const cam = sceneAPI.camera;
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();

      // Real surface radius from the planet mesh vertices (max distance from origin)
      const posAttr = (planetMesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
      let maxSurf = 0, minSurf = Infinity;
      for (let i = 0; i < posAttr.count; i++) {
        const d = Math.sqrt(posAttr.getX(i) ** 2 + posAttr.getY(i) ** 2 + posAttr.getZ(i) ** 2);
        if (d > maxSurf) maxSurf = d;
        if (d < minSurf) minSurf = d;
      }
      const meshWorldScale = planetMesh.getWorldScale(new THREE.Vector3()).length();

      // 8 sample plots: nearest to camera + 7 spread around
      const samples: any[] = [];
      const nearest = grid.plots.reduce((best: any, p: any) => {
        const dot = p.dir.x * camDir.x + p.dir.y * camDir.y + p.dir.z * camDir.z;
        return !best || dot > best.dot ? { plot: p, dot } : best;
      }, null as { plot: any; dot: number } | null);
      if (nearest) samples.push(nearest.plot);
      const step = Math.max(1, Math.floor(grid.plots.length / 7));
      for (let i = step; i < grid.plots.length && samples.length < 8; i += step) samples.push(grid.plots[i]);

      const baseRadius = surfaceRadius - 0.01;
      let lines = `Surface check:\n geomRadius=${planetRadius.toFixed(4)} PLANET_RADIUS=${PLANET_RADIUS.toFixed(4)}`;
      lines += `\n realSurf max=${maxSurf.toFixed(4)} min=${minSurf.toFixed(4)} meshWorldScale=${meshWorldScale.toFixed(4)} surfaceRadius(used)=${surfaceRadius.toFixed(4)} baseRadius=${baseRadius.toFixed(4)}`;
      lines += `\n camera near=0.05 far=2000 planet depthWrite=true (MeshStandard) outline depthWrite=false renderOrder=-1`;
      for (const p of samples) {
        const verdict = maxSurf > baseRadius + 0.001 ? 'BURIED' : 'OK';
        lines += `\n plot${p.id} baseDist=${baseRadius.toFixed(4)} dir=(${p.dir.x.toFixed(2)},${p.dir.y.toFixed(2)},${p.dir.z.toFixed(2)}) ${verdict}`;
      }
      // tree mesh counts + instances with scale > 0.5
      let trunkVisible = 0, crownVisible = 0;
      const verdant = ctx.state.planets.verdant;
      for (const p of verdant.plots) {
        const s = stageScaleFor(p.state);
        if (s > 0.5) { trunkVisible++; crownVisible++; }
      }
      lines += `\n tree meshes: variant.count=${variantPools?.[0]?.count ?? 0} shadow.count=${shadowPool?.count ?? 0} log.count=${logPool?.count ?? 0}`;
      lines += `\n instances scale>0.5: trunk=${trunkVisible} crown=${crownVisible}`;
      const msg = lines;
      logEvent(msg);
      showToast(msg.split('\n').slice(0, 4).join(' | '));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Surface check failed', msg);
      showToast(`Surface check failed: ${msg}`);
      logEvent(`Surface check FAILED: ${msg}`);
    }
  };
}
