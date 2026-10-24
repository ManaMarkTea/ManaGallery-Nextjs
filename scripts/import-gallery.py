#!/usr/bin/env python3
"""Import public Bryce5 gallery content and thumbnails into RenderGallery."""

import argparse
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def sql_string(value):
    if value == "NULL":
        return None
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        value = value[1:-1]
        replacements = {
            "0": "\0",
            "b": "\b",
            "n": "\n",
            "r": "\r",
            "t": "\t",
            "Z": "\x1a",
            "\\": "\\",
            "'": "'",
            '"': '"',
        }
        result = []
        index = 0
        while index < len(value):
            if value[index] == "\\" and index + 1 < len(value):
                index += 1
                result.append(replacements.get(value[index], value[index]))
            elif value[index:index + 2] == "''":
                result.append("'")
                index += 1
            else:
                result.append(value[index])
            index += 1
        return "".join(result)
    return value


def split_sql_values(raw):
    values = []
    start = 0
    quoted = False
    escaped = False
    index = 0
    while index < len(raw):
        char = raw[index]
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == "'":
                if index + 1 < len(raw) and raw[index + 1] == "'":
                    index += 1
                else:
                    quoted = False
        elif char == "'":
            quoted = True
        elif char == ",":
            values.append(raw[start:index].strip())
            start = index + 1
        index += 1
    values.append(raw[start:].strip())
    return values


def insert_rows(sql, table):
    if table.startswith('legacy_'):
        prefix=os.environ.get('RENDERGALLERY_LEGACY_TABLE_PREFIX','legacy_')
        if not re.fullmatch(r'[A-Za-z0-9_]+',prefix):
            raise ValueError('Invalid legacy table prefix')
        table=prefix+table[len('legacy_'):]
    pattern = re.compile(
        rf"INSERT INTO\s+`?{re.escape(table)}`?\s*\((.*?)\)\s*VALUES\s*",
        re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(sql):
        columns = [column.strip().strip("`") for column in match.group(1).split(",")]
        index = match.end()
        while index < len(sql):
            while index < len(sql) and sql[index].isspace():
                index += 1
            if index >= len(sql) or sql[index] != "(":
                break
            start = index + 1
            index += 1
            quoted = False
            escaped = False
            while index < len(sql):
                char = sql[index]
                if quoted:
                    if escaped:
                        escaped = False
                    elif char == "\\":
                        escaped = True
                    elif char == "'":
                        if index + 1 < len(sql) and sql[index + 1] == "'":
                            index += 1
                        else:
                            quoted = False
                elif char == "'":
                    quoted = True
                elif char == ")":
                    yield {
                        column: sql_string(value)
                        for column, value in zip(columns, split_sql_values(sql[start:index]))
                    }
                    index += 1
                    break
                index += 1
            while index < len(sql) and sql[index].isspace():
                index += 1
            if index < len(sql) and sql[index] == ",":
                index += 1
                continue
            break


def safe_number(value, default=0):
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def safe_rating(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0


def safe_filename(value):
    if not value or value.startswith(("http://", "https://")):
        return None
    name = Path(value).name
    if name != value or name in {"", ".", ".."}:
        return None
    return name


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sql_dump", type=Path, help="Path to the Bryce5 SQL export")
    parser.add_argument(
        "--site",
        type=Path,
        default=Path("legacy/bryce5"),
        help="Path to the downloaded legacy site",
    )
    parser.add_argument("--output", type=Path, default=Path("."))
    args = parser.parse_args()

    sql = args.sql_dump.read_text(encoding="latin-1")
    categories = {}
    for row in insert_rows(sql, "legacy_categories"):
        category_id = safe_number(row.get("cat_id"))
        categories[category_id] = {
            "id": category_id,
            "name": row.get("cat_name") or "Uncategorized",
            "parentId": safe_number(row.get("cat_parent_id")),
            "order": safe_number(row.get("cat_order")),
        }

    authors = {
        safe_number(row.get("user_id")): row.get("user_name") or ""
        for row in insert_rows(sql, "legacy_users")
    }

    gallery_dir = args.output / "public" / "gallery"
    gallery_dir.mkdir(parents=True, exist_ok=True)
    full_dir = args.output / "public" / "full"
    full_dir.mkdir(parents=True, exist_ok=True)
    items = []
    category_counts = {}
    copied_full = 0
    copied_assets = 0
    missing_assets = 0
    for row in insert_rows(sql, "legacy_images"):
        if safe_number(row.get("image_active")) != 1:
            continue
        image_id = safe_number(row.get("image_id"))
        category_id = safe_number(row.get("cat_id"))
        thumbnail_name = safe_filename(row.get("image_thumb_file"))
        media_name = safe_filename(row.get("image_media_file"))
        source = None
        for folder, filename in (
            ("thumbnails", thumbnail_name),
            ("media", media_name),
            ("thumbnails", media_name),
        ):
            if filename:
                candidate = args.site / "data" / folder / str(category_id) / filename
                if candidate.is_file():
                    source = candidate
                    break
        extension = source.suffix.lower() if source else ".jpg"
        if not re.fullmatch(r"\.[a-z0-9]{1,8}", extension):
            extension = ".jpg"
        asset_name = f"{image_id}{extension}"
        if source:
            shutil.copyfile(source, gallery_dir / asset_name)
            copied_assets += 1
        else:
            missing_assets += 1
        full_asset = None
        if media_name and Path(media_name).suffix.lower() in IMAGE_EXTENSIONS:
            full_source = args.site / "data" / "media" / str(category_id) / media_name
            if full_source.is_file():
                full_asset = f"{image_id}{full_source.suffix.lower()}"
                target = full_dir / full_asset
                if not target.is_file() or target.stat().st_size != full_source.stat().st_size:
                    shutil.copyfile(full_source, target)
                copied_full += 1
        try:
            date = datetime.fromtimestamp(
                safe_number(row.get("image_date")), tz=timezone.utc
            ).date().isoformat()
        except (OverflowError, OSError, ValueError):
            date = None
        items.append(
            {
                "id": image_id,
                "title": row.get("image_name") or "Untitled artwork",
                "description": row.get("image_description") or "",
                "categoryId": category_id,
                "category": categories.get(category_id, {}).get("name", "Uncategorized"),
                "author": authors.get(safe_number(row.get("user_id")), ""),
                "date": date,
                "views": safe_number(row.get("image_hits")),
                "rating": safe_rating(row.get("image_rating")),
                "image": f"/gallery/{asset_name}" if source else "",
                "fullImage": f"/full/{full_asset}" if full_asset else "",
            }
        )
        category_counts[category_id] = category_counts.get(category_id, 0) + 1

    output_data = args.output / "public" / "data"
    output_data.mkdir(parents=True, exist_ok=True)
    data = {
        "items": items,
        "categories": [
            {
                "id": category["id"],
                "name": category["name"],
                "count": category_counts.get(category["id"], 0),
            }
            for category in sorted(categories.values(), key=lambda item: (item["order"], item["name"].casefold()))
            if category_counts.get(category["id"], 0)
        ],
    }
    (output_data / "gallery.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Imported {len(items):,} public artworks across {len(data['categories'])} categories; "
        f"copied {copied_assets:,} preview images and {copied_full:,} full-size images; "
        f"{missing_assets:,} artworks have no local preview."
    )


if __name__ == "__main__":
    main()
