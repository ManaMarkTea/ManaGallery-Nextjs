// Match the header's three-bar mark; SVG remains the editable source.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = await readFile(new URL("../app/icon.svg", import.meta.url));
const sizes = [16, 32, 48, 64];
const frames = await Promise.all(sizes.map(size => sharp(source).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(new URL("../app/favicon.ico", import.meta.url), Buffer.concat([header, ...frames]));
await sharp(source).resize(180, 180).flatten({background: "#202a33"}).png().toFile(fileURLToPath(new URL("../app/apple-icon.png", import.meta.url)));
console.log("Generated 16–64px favicon.ico and 180px Apple touch icon.");
