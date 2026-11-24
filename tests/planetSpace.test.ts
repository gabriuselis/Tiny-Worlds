import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { cameraDirInPlanetSpace } from '../src/render/planetSpace';
import { TAP_CAMERA_FACING_DOT } from '../src/core/config/world';

const scratch = new Vector3();

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

describe('cameraDirInPlanetSpace', () => {
  it('unrotated planet returns the camera direction unchanged', () => {
    const cam = new Vector3(0, 0, 10);
    cameraDirInPlanetSpace(cam, new Quaternion(), scratch);
    expect(scratch.x).toBe(0);
    expect(scratch.y).toBe(0);
    expect(scratch.z).toBeCloseTo(1);
  });

  it('planet rotated +90 deg around Y reports the camera at local -X', () => {
    const cam = new Vector3(0, 0, 10);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    cameraDirInPlanetSpace(cam, q, scratch);
    expect(scratch.x).toBeCloseTo(-1);
    expect(scratch.y).toBe(0);
    expect(scratch.z).toBeCloseTo(0);
  });

  it('a plot facing the camera after rotation passes and the far side fails', () => {
    const cam = new Vector3(0, 0, 10);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    cameraDirInPlanetSpace(cam, q, scratch);
    const near = new Vector3(-1, 0, 0); // local plot normal pointing at the camera
    const far = new Vector3(1, 0, 0); // far side
    expect(dot(near, scratch)).toBeGreaterThan(TAP_CAMERA_FACING_DOT);
    expect(dot(far, scratch)).toBeLessThanOrEqual(TAP_CAMERA_FACING_DOT);
  });
});
