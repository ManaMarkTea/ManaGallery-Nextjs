# Preparing archived model previews

The original member-only `.3ds` downloads remain unchanged. A separate offline
tool creates validated GLB derivatives for a future Mana viewer:

```sh
npm ci
npm run models:convert
# Or select private directories:
node scripts/convert-models.mjs /private/models /private/model-previews
```

Defaults are `storage/models` and `storage/model-previews`, both ignored by Git.
The input is the existing version-one model catalogue plus the ID-named `.3ds`
files. Each source must match its imported size and SHA256. Input IDs must be
positive integers; source files must be regular, non-linked files under 25 MiB.
The tool refuses overlapping source/output directories, public or source-tree
output, output links and unrelated non-empty output directories.

Conversion uses pinned Three.js TDSLoader and GLTFExporter in a worker with a
15-second deadline and 256 MiB heap limit per model. It rejects invalid/empty
geometry, more than one million vertices, non-finite positions and invalid bounds.
Empty mesh placeholders are omitted and counted. The pinned loader's texture-map
hook is overridden so old file paths cannot fetch local/remote textures. No
external resource is read or uploaded. The generated model is validated with the
Khronos glTF validator before an atomic write.

The converter changes 3DS Z-up to glTF/Mana Y-up. Relative source scale is kept;
physical units are not inferred or guaranteed.

These are **geometry and basic-color previews**. External texture maps, legacy
animation and a faithful recreation of Bryce materials are not provided. The
manifest records source/output hashes, bounds, mesh/triangle counts, omitted
maps/empty meshes, validation warnings and any failed conversions. Failed items
are absent from its published entries; the command exits unsuccessfully if any
fail. Originals are never replaced. Derivatives are reproducible from backed-up
originals and the Git-controlled converter; they are not a new canonical archive.

## Member downloads and deployment

Signed-in members can download an available derivative from a model's detail
page using **Download GLB geometry**. `/download/ID?format=glb` applies the same
membership and moderation checks as the original model download. The derivative's
source hash must match the current original catalogue, and its bytes must match
its own size/SHA256 before serving. A stale, corrupt or missing derivative is not
served. No models are placed under public/.

The Git pull script stages derivatives from the private seed's
`data/model-previews/` when present. Its ID-named GLBs and catalogue are copied
alongside the original private model files as `models/ID.glb` and
`models/previews.json`. The existing fixed promotion helper copies only regular
files while the app is stopped. Local/cloud backups already include the complete
private model directory and authenticate the generated files as well.

To generate derivatives on the existing VPS, as the SSH administrator:

```sh
cd ~/rendergallery-git-stage/app
node scripts/convert-models.mjs ~/rendergallery-stage/data/models ~/rendergallery-stage/data/model-previews
# Then use the ordinary Git deployment to stage and promote the result.
```

## Mana integration remains separate

The adjacent ManaRenderer checkout already imports GLB through its managed loader.
Its current browser host includes the full editor/play runtime. It does not yet
provide a small, standalone gallery viewer host.

The next integration should provide a versioned Mana viewer bundle with an
explicit model URL, an idle thumbnail mode, on-demand interactive detail mode,
camera framing from validated bounds, orbit/zoom/reset controls, and teardown
when the card leaves view. It should load only on demand, respect reduced motion,
and retain a static image/download fallback when WebGPU is unavailable.

The future viewer can fetch derivatives through the authenticated download route.
Do not put GLBs under `public/` or bypass moderation through an engine asset URL. Keep the viewer
code separately versioned and source-only; neither repository should contain
archive models or account data. No Mana viewer or public static derivative URL
is enabled by the converter; the interactive engine integration is still pending.
