"""Create a private first-deployment snapshot without copying live SQLite files."""
from pathlib import Path
import sqlite3
import tarfile

root = Path(__file__).resolve().parent.parent
output = root / "storage" / "deployment"
output.mkdir(exist_ok=True)
snapshot = output / "gallery.sqlite"
with sqlite3.connect(root / "storage" / "gallery.sqlite") as source:
    with sqlite3.connect(snapshot) as target:
        source.backup(target)
        # The snapshot is shipped as one file; do not leave its edits in a
        # separate WAL journal that would be missing from the archive.
        target.execute("PRAGMA journal_mode=DELETE")
        # The staging copy starts without active sessions or advertising.
        target.execute("DELETE FROM sessions")
        target.execute("DELETE FROM challenges")
        target.execute("DELETE FROM attempts")
        for key in ("adsenseEnabled", "registrationOpen"):
            target.execute("INSERT INTO site_settings(key,value) VALUES (?,'false') ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key,))
archive = output / "first-deployment.tar.gz"
with tarfile.open(archive, "w:gz", compresslevel=1) as bundle:
    for name in ("app", "components", "lib", "scripts", "public", "deploy"):
        bundle.add(root / name, arcname=f"app/{name}", filter=lambda info: None if "__pycache__" in info.name else info)
    for name in ("package.json", "package-lock.json", "tsconfig.json", "next-env.d.ts", "next.config.ts", "eslint.config.mjs", "Readme.md"):
        bundle.add(root / name, arcname=f"app/{name}")
    bundle.add(snapshot, arcname="data/gallery.sqlite")
    for name in ("uploads", "materials", "models"):
        if (root / "storage" / name).exists():
            bundle.add(root / "storage" / name, arcname=f"data/{name}")
print(f"Created private deployment archive: {archive} ({archive.stat().st_size / 1024**3:.2f} GiB)")
