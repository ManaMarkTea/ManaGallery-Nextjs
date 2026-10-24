// Offline conversion only. Never run model importers in an HTTP request handler.
import { parentPort, workerData } from "node:worker_threads";
import { Box3, MeshStandardMaterial } from "three";
import { TDSLoader } from "three/addons/loaders/TDSLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { validateBytes } from "gltf-validator";

// GLTFExporter uses the browser FileReader API for its in-memory Blob output.
// No DOM, filesystem lookup, image decoding or network access is needed here.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};

class GeometryLoader extends TDSLoader {
  textureMaps = 0;
  // Deliberately override this pinned loader's map hook: old texture paths may
  // refer to arbitrary local/remote locations. Preview derivatives omit maps.
  readMap() {
    this.textureMaps++;
    return null;
  }
}

async function convert(bytes) {
  const input = Buffer.from(bytes);
  if (
    input.length < 6 ||
    input.readUInt16LE(0) !== 0x4d4d ||
    input.readUInt32LE(2) < 6 ||
    input.readUInt32LE(2) > input.length
  )
    throw new Error("Invalid or truncated 3DS header");
  const loader = new GeometryLoader();
  const scene = loader.parse(
    input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
    "",
  );
  // 3DS uses Z-up; glTF and Mana use Y-up. Keep the source's relative scale.
  scene.rotation.x = -Math.PI / 2;
  let meshes = 0,
    triangles = 0,
    vertices = 0;
  const empty = [];
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const position = object.geometry.getAttribute("position");
    if (
      !position ||
      position.count === 0 ||
      !object.geometry.index ||
      object.geometry.index.count === 0
    ) {
      empty.push(object);
      return;
    }
    vertices += position.count;
    if (vertices > 1_000_000)
      throw new Error("Preview exceeds one million vertices");
    for (const number of position.array)
      if (!Number.isFinite(number)) throw new Error("Non-finite geometry");
    meshes++;
    triangles += (object.geometry.index?.count ?? position.count) / 3;
    const material = (source) =>
      new MeshStandardMaterial({
        name: source.name,
        color: source.color,
        opacity: source.opacity,
        transparent: source.transparent,
        side: source.side,
        roughness: Math.max(
          0.15,
          Math.min(1, Math.sqrt(2 / ((source.shininess || 0) + 2))),
        ),
        metalness: 0,
      });
    object.material = Array.isArray(object.material)
      ? object.material.map(material)
      : material(object.material);
  });
  for (const object of empty) object.removeFromParent();
  if (!meshes || !triangles) throw new Error("No triangle geometry found");
  const bounds = new Box3().setFromObject(scene);
  const range = [...bounds.min.toArray(), ...bounds.max.toArray()];
  if (!range.every(Number.isFinite) || bounds.isEmpty())
    throw new Error("Invalid model bounds");
  const glb = new Uint8Array(
    await new GLTFExporter().parseAsync(scene, {
      binary: true,
      onlyVisible: false,
    }),
  );
  const report = await validateBytes(glb, {
    maxIssues: 50,
    externalResourceFunction: async () => {
      throw new Error("External resources are forbidden");
    },
  });
  if (report.issues.numErrors)
    throw new Error(
      `GLB validation failed: ${report.issues.messages
        .filter((item) => item.severity === 0)
        .map((item) => item.code)
        .join(", ")}`,
    );
  return {
    glb,
    meshes,
    vertices,
    triangles,
    bounds: range,
    omittedEmptyMeshes: empty.length,
    omittedTextureMaps: loader.textureMaps,
    validationWarnings: report.issues.numWarnings,
  };
}

try {
  parentPort.postMessage({ ok: true, ...(await convert(workerData)) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message });
}
