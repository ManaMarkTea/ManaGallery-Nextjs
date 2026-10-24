import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const converterVersion = "three-0.186.1-geometry-v2";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function convertModel(bytes, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./model-conversion-worker.mjs", import.meta.url),
      { workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 256 } },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Model conversion exceeded its time limit"));
    }, timeoutMs);
    worker.once("message", (result) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.ok) resolve(result);
      else reject(new Error(result.error));
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`Conversion worker exited before returning output (${code})`),
      );
    });
  });
}

function atomicWrite(filename, bytes) {
  if (existsSync(filename) && lstatSync(filename).isSymbolicLink())
    throw new Error("Output must not be a symbolic link");
  const temporary = `${filename}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
  renameSync(temporary, filename);
}

export async function convertCatalogue(sourceDirectory, outputDirectory) {
  const source = realpathSync(sourceDirectory);
  if (
    existsSync(outputDirectory) &&
    lstatSync(outputDirectory).isSymbolicLink()
  )
    throw new Error("Output directory must not be a link");
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const output = realpathSync(outputDirectory);
  const relative = path.relative(root, output);
  if (
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      relative.split(path.sep)[0] !== "storage") ||
    output === source ||
    source.startsWith(output + path.sep) ||
    output.startsWith(source + path.sep)
  )
    throw new Error(
      "Choose a separate private output directory, outside source files and public/",
    );
  const marker = path.join(output, ".rendergallery-model-previews");
  if (existsSync(marker) && lstatSync(marker).isSymbolicLink())
    throw new Error("Output marker must not be a link");
  if (!existsSync(marker) && readdirSync(output).length)
    throw new Error(
      "Unrecognized non-empty output directory; refusing to overwrite it",
    );
  writeFileSync(marker, "Private generated model derivatives\n", {
    mode: 0o600,
  });
  const catalogue = JSON.parse(
    readFileSync(path.join(source, "catalogue.json"), "utf8"),
  );
  if (
    catalogue.version !== 1 ||
    !catalogue.entries ||
    typeof catalogue.entries !== "object" ||
    Array.isArray(catalogue.entries)
  )
    throw new Error("Invalid source catalogue");
  const entries = Object.create(null),
    failures = Object.create(null);
  for (const [id, entry] of Object.entries(catalogue.entries)) {
    if (!entry) continue;
    try {
      if (!/^[1-9]\d*$/.test(id)) throw new Error("Invalid catalogue ID");
      const filename = path.join(source, `${id}.3ds`);
      const info = lstatSync(filename);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 25 * 1024 * 1024
      )
        throw new Error("Source must be a regular file under 25 MiB");
      const bytes = readFileSync(filename);
      if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256)
        throw new Error("Source checksum mismatch");
      const {
        glb,
        meshes,
        vertices,
        triangles,
        bounds,
        omittedEmptyMeshes,
        omittedTextureMaps,
        validationWarnings,
      } = await convertModel(bytes);
      atomicWrite(path.join(output, `${id}.glb`), glb);
      entries[id] = {
        bytes: glb.length,
        sha256: digest(glb),
        sourceSha256: entry.sha256,
        meshes,
        vertices,
        triangles,
        bounds,
        omittedEmptyMeshes,
        omittedTextureMaps,
        validationWarnings,
      };
      console.log(
        `Model ${id}: converted and validated (${glb.length.toLocaleString()} bytes)`,
      );
    } catch (error) {
      failures[id] = error.message;
      console.error(`Model ${id}: ${error.message}`);
    }
  }
  const result = {
    version: 1,
    converter: converterVersion,
    geometryOnly: true,
    generated: new Date().toISOString(),
    entries,
    failures,
  };
  atomicWrite(
    path.join(output, "catalogue.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    `${Object.keys(entries).length} models converted; ${Object.keys(failures).length} failed. Originals unchanged.`,
  );
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 0 && arguments_.length !== 2) {
    console.error(
      "Usage: node scripts/convert-models.mjs [PRIVATE_MODEL_DIRECTORY PRIVATE_OUTPUT_DIRECTORY]",
    );
    process.exitCode = 1;
  } else {
    try {
      const result = await convertCatalogue(
        arguments_[0] || path.join(root, "storage/models"),
        arguments_[1] || path.join(root, "storage/model-previews"),
      );
      if (Object.keys(result.failures).length) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
