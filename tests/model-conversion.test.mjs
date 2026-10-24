import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { convertCatalogue, convertModel } from "../scripts/convert-models.mjs";

function chunk(id, ...pieces) {
  const body = Buffer.concat(pieces);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(id);
  header.writeUInt32LE(body.length + 6, 2);
  return Buffer.concat([header, body]);
}

function triangle() {
  const positions = Buffer.alloc(2 + 9 * 4);
  positions.writeUInt16LE(3);
  [0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((value, index) =>
    positions.writeFloatLE(value, 2 + index * 4),
  );
  const faces = Buffer.alloc(10);
  [1, 0, 1, 2, 7].forEach((value, index) =>
    faces.writeUInt16LE(value, index * 2),
  );
  return chunk(
    0x4d4d,
    chunk(
      0x3d3d,
      chunk(
        0x4000,
        Buffer.from("Fictional triangle\0"),
        chunk(0x4100, chunk(0x4110, positions), chunk(0x4120, faces)),
      ),
    ),
  );
}

test("fictional 3DS converts to a validated, embedded GLB without external resources", async () => {
  const result = await convertModel(triangle());
  const output = Buffer.from(result.glb);
  assert.equal(output.toString("ascii", 0, 4), "glTF");
  assert.equal(output.readUInt32LE(4), 2);
  assert.equal(output.readUInt32LE(8), output.length);
  const jsonLength = output.readUInt32LE(12);
  const json = JSON.parse(output.toString("utf8", 20, 20 + jsonLength));
  assert.equal(result.meshes, 1);
  assert.equal(result.triangles, 1);
  assert.equal(result.vertices, 3);
  assert.equal(result.omittedTextureMaps, 0);
  assert.ok(Math.abs(result.bounds[4] - 1) < 0.00001, "Source Z-up becomes GLB Y-up");
  assert.ok(Math.abs(result.bounds[5]) < 0.00001);
  assert.equal(json.buffers.length, 1);
  assert.equal(json.buffers[0].uri, undefined);
  assert.equal(json.images, undefined);
});

test("malformed inputs and worker deadlines reject rather than publishing a preview", async () => {
  await assert.rejects(convertModel(Buffer.from("not a model")), /header/);
  await assert.rejects(convertModel(triangle(), 1), /time limit/);
});

test("catalogue conversion preserves originals, checks checksums and refuses unrelated output", async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "rendergallery-model-test-"),
  );
  try {
    const source = path.join(directory, "source");
    const output = path.join(directory, "output");
    const unrelated = path.join(directory, "unrelated");
    mkdirSync(source);
    mkdirSync(unrelated);
    writeFileSync(path.join(unrelated, "important.txt"), "keep this file");
    const bytes = triangle();
    writeFileSync(path.join(source, "1.3ds"), bytes);
    writeFileSync(path.join(source, "2.3ds"), bytes);
    writeFileSync(
      path.join(source, "catalogue.json"),
      JSON.stringify({
        version: 1,
        entries: {
          1: {
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
          2: { bytes: bytes.length, sha256: "0".repeat(64) },
          3: null,
        },
      }),
    );
    await assert.rejects(convertCatalogue(source, unrelated), /Unrecognized/);
    assert.equal(
      readFileSync(path.join(unrelated, "important.txt"), "utf8"),
      "keep this file",
    );
    await assert.rejects(convertCatalogue(source, source), /separate private/);
    const result = await convertCatalogue(source, output);
    assert.equal(Object.keys(result.entries).length, 1);
    assert.equal(result.geometryOnly, true);
    assert.match(result.failures["2"], /checksum mismatch/);
    assert.equal(existsSync(path.join(output, "1.glb")), true);
    assert.equal(existsSync(path.join(output, "2.glb")), false);
    assert.deepEqual(readFileSync(path.join(source, "1.3ds")), bytes);
    assert.deepEqual(readFileSync(path.join(source, "2.3ds")), bytes);
  } finally {
    assert.ok(
      path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep),
    );
    rmSync(directory, { recursive: true, force: true });
  }
});
