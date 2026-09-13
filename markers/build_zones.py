"""Build markers/*.json zone files from parsed wiki data in ../out.

Output files keep the wiki raw frame (same as rubbish_points.json):
- CSV x/y columns are author-resolved game coords, so they are stored
  back in raw order as point: [y, x].
- *_raw.json polygon vertices are already raw order and stored as-is.

The game_zones.js parser applies the wiki->site transform at load,
so converted files must NOT be pre-swapped.
Output per layer: {"points": [...], "polygons": [...]}.
"""
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "out"


def read_points_csv(path, layer):
    points = []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                x, y = float(row["x"]), float(row["y"])
            except (KeyError, TypeError, ValueError):
                continue
            item = {"_id": row.get("id", ""), "name": row.get("name", ""),
                    "layer": layer, "point": [y, x]}
            if row.get("stashType"):
                item["kind"] = row["stashType"]
            if row.get("icon"):
                item["icon"] = row["icon"]
            points.append(item)
    return points


def read_polygons_raw(path, default_color=None):
    """Returns list of {_id, name, color|None, polygon} with raw vertex order."""
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    polys = []
    for entry in raw:
        d = entry.get("data", entry)
        poly = d.get("polygon")
        if not poly or len(poly) < 3:
            continue
        pts = []
        for p in poly:
            try:
                pts.append([float(p[0]), float(p[1])])
            except (TypeError, ValueError, IndexError):
                pass
        if len(pts) < 3:
            continue
        style = d.get("style") or {}
        polys.append({
            "_id": d.get("_id", ""),
            "name": d.get("name", ""),
            "color": style.get("fillColor") or style.get("color") or default_color,
            "polygon": pts,
        })
    return polys


def write_layer(name, points=None, polygons=None):
    data = {"points": points or [], "polygons": polygons or []}
    path = HERE / name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"{name}: {len(data['points'])} points, {len(data['polygons'])} polygons")


def main():
    write_layer("phones.json",
                points=read_points_csv(OUT / "telephone" / "telephone_points.csv", "telephone"))

    write_layer("contraband.json",
                points=read_points_csv(OUT / "stash" / "stash_points.csv", "stash"))

    zz, red = [], []
    for poly in read_polygons_raw(OUT / "game-zones" / "game-zones_raw.json"):
        (zz if (poly["color"] or "").lower() == "#04ff1c" else red).append(poly)
    write_layer("zz.json", polygons=zz)
    write_layer("red.json", polygons=red)

    write_layer("gathering.json",
                polygons=read_polygons_raw(OUT / "gatherer" / "gatherer_raw.json"))

    write_layer("treasure.json",
                polygons=read_polygons_raw(OUT / "treasure" / "treasure_raw.json"))


if __name__ == "__main__":
    main()
