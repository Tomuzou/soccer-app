import * as THREE from "three";

/** A spherical 32-panel layout, with seams and fine leather grain. No downloads. */
export function makeBallSurface(): {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const positions = ico.attributes.position;
  const pentagons: THREE.Vector3[] = [];
  const hexagons: THREE.Vector3[] = [];
  for (let i = 0; i < positions.count; i += 3) {
    const center = new THREE.Vector3();
    for (let j = 0; j < 3; j++) {
      const vertex = new THREE.Vector3()
        .fromBufferAttribute(positions, i + j)
        .normalize();
      if (!pentagons.some((other) => other.distanceToSquared(vertex) < 0.00001))
        pentagons.push(vertex);
      center.add(vertex);
    }
    hexagons.push(center.normalize());
  }
  ico.dispose();
  const centers = [...pentagons, ...hexagons];
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = canvas.width;
  bumpCanvas.height = canvas.height;
  const ctx = canvas.getContext("2d")!;
  const bumpCtx = bumpCanvas.getContext("2d")!;
  const color = ctx.createImageData(canvas.width, canvas.height);
  const bump = bumpCtx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const theta = (Math.PI * y) / (canvas.height - 1);
    const sy = Math.cos(theta),
      ring = Math.sin(theta);
    for (let x = 0; x < canvas.width; x++) {
      const phi = (Math.PI * 2 * x) / (canvas.width - 1);
      const sx = ring * Math.cos(phi),
        sz = ring * Math.sin(phi);
      let first = -2,
        second = -2,
        index = 0;
      centers.forEach((center, i) => {
        const dot = sx * center.x + sy * center.y + sz * center.z;
        if (dot > first) {
          second = first;
          first = dot;
          index = i;
        } else if (dot > second) second = dot;
      });
      const seam = first - second < 0.004;
      const grain = ((x * 73 + y * 37) % 11) - 5;
      const base = seam ? 65 : index < pentagons.length ? 25 : 234;
      const offset = (y * canvas.width + x) * 4;
      color.data.set(
        [base + grain, base + grain, base + grain - 3, 255],
        offset,
      );
      const height = seam ? 65 : 175 + grain * 3;
      bump.data.set([height, height, height, 255], offset);
    }
  }
  ctx.putImageData(color, 0, 0);
  bumpCtx.putImageData(bump, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return { color: map, bump: new THREE.CanvasTexture(bumpCanvas) };
}

export function makeTurfSurface(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#427537";
  ctx.fillRect(0, 0, 512, 512);
  // Short blades, a soft soil undertone and fine grain rather than large pixels.
  for (let i = 0; i < 23000; i++) {
    const x = Math.random() * 512,
      y = Math.random() * 512;
    ctx.strokeStyle = i % 3 ? "rgba(138,166,70,.22)" : "rgba(16,49,20,.28)";
    ctx.lineWidth = 0.6 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 2 - 1, y - 2 - Math.random() * 5);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(40, 54);
  return texture;
}
