import * as THREE from 'three';

/**
 * Frees the geometry and materials of everything in a scene. Textures are left alone: the only
 * ones in use are shared between views. Sprites share one geometry, so only their material goes.
 */
export const disposeScene = (scene: THREE.Object3D): void => {
  scene.traverse((object) => {
    if (object instanceof THREE.Sprite) {
      object.material.dispose();
    } else if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    ) {
      (object.geometry as THREE.BufferGeometry).dispose();
      const materials = object.material as THREE.Material | THREE.Material[];
      for (const material of Array.isArray(materials) ? materials : [materials]) material.dispose();
    }
  });
};

/**
 * Frees a renderer and gives up its WebGL context at once, rather than whenever the canvas is
 * garbage collected: Firefox allows only so many live contexts, and every battle makes two.
 */
export const disposeRenderer = (renderer: THREE.WebGLRenderer): void => {
  renderer.dispose();
  renderer.forceContextLoss();
};
