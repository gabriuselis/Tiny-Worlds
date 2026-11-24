import { Quaternion, Vector3 } from 'three';

/**
 * Camera direction expressed in planet-local space.
 *
 * The planet sits at the origin, so only rotation matters: normalize the
 * camera world position (direction from planet centre to camera), then rotate
 * it by the inverse of the planet quaternion. No translation, no scale, no
 * matrixWorld. Writes into the caller's reused `out` vector and returns it.
 * The scratch quaternion is module-level, so this allocates nothing per call.
 */
const _invQ = new Quaternion();

export function cameraDirInPlanetSpace(
  cameraWorldPos: Vector3,
  planetQuaternion: Quaternion,
  out: Vector3,
): Vector3 {
  out.copy(cameraWorldPos).normalize();
  _invQ.copy(planetQuaternion).invert();
  return out.applyQuaternion(_invQ);
}
