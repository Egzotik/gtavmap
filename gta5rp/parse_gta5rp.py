"""Парсинг интерактивной карты wiki.gta5rp.com/map — всё, что можно достать.

Источники данных (всё статическое, браузера не нужно):
  main (все метки)   — массив BLIPS в JS-чанке (id,x,y,label + category)
  green_zones        — массив MAP_ZONES в JS-чанке ({uId,name,center,poly})
  hunting            — /map/data/hunting-spots.json (полигоны)
  treasure           — /map/data/treasure-spots.json + treasure-depth.json
  roads              — /map/data/roads.json (сохраняется как есть)
  категории/иконки   — BLIP_CATEGORY ({label,blipId,group,link}) и спрайты
                       blip_sheet_1/2/3.webp (сетка 16x16, ячейка 64px)

Имена чанков при каждом деплое меняются, поэтому скрипт сам качает /map,
находит все /_next/static/chunks/*.js и ищет нужные по маркерам.

Запуск:
    python parse_gta5rp.py                    # всё
    python parse_gta5rp.py --only main green_zones
    python parse_gta5rp.py --out ./data       # свой каталог

Выход (out/):
    main_blips.json / main_blips.csv / main.svg
    green_zones.json / green_zones.csv / green_zones.svg
    hunting.json / hunting.csv / hunting.svg
    treasure_spots.json/.csv/.svg, treasure_depth.json/.csv/.svg
    roads.json
    categories.json   — BLIP_CATEGORY + ZONE_CATEGORY + стили областей
    icons/            — blip_sheet_*.webp + нарезанные blip_<id>_<cat>.png

Координаты — игровые (x≈±4000, y≈±6500). В SVG север сверху (Y перевёрнута).
"""

import argparse
import csv
import html
import json
import re
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = "https://wiki.gta5rp.com"
UA = {"User-Agent": "Mozilla/5.0"}

PALETTE = ["#4ade80", "#60a5fa", "#fbbf24", "#f87171", "#c084fc", "#2dd4bf",
           "#fb923c", "#f472b6", "#a3e635", "#38bdf8", "#e879f9", "#facc15",
           "#34d399", "#fca5a5", "#93c5fd", "#fdba74"]

DATA_JSONS = ["hunting-spots.json", "treasure-spots.json", "treasure-depth.json", "roads.json"]
AREA_STYLE = {  # из чанка (модуль областей), fallback если не распарсится
    "hunting_spots": {"fill": "rgba(22, 163, 74, 0.28)", "stroke": "rgba(74, 222, 128, 0.95)", "accent": "#4ade80"},
    "treasure_spots": {"fill": "rgba(251, 191, 36, 0.28)", "stroke": "rgba(251, 191, 36, 0.95)", "accent": "#fbbf24"},
    "treasure_depth": {"fill": "rgba(34, 211, 238, 0.22)", "stroke": "rgba(34, 211, 238, 0.85)", "accent": "#22d3ee"},
}


def http(url: str, binary: bool = False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        blob = r.read()
    return blob if binary else blob.decode("utf-8", "ignore")


# ------------------------------------------------------------- JS-литералы
class JSParser:
    """Минимальный парсер JS-литералов: {...} [...] строки, числа, !0/!1."""

    def __init__(self, s: str):
        self.s, self.n, self.i = s, len(s), 0

    def ws(self):
        while self.i < self.n and self.s[self.i] in " \t\r\n":
            self.i += 1

    def parse(self):
        self.ws()
        c = self.s[self.i]
        if c == "{":
            return self.obj()
        if c == "[":
            return self.arr()
        if c in "\"'":
            return self.string()
        return self.atom()

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while self.i < self.n:
            c = self.s[self.i]
            if c == "\\":
                out.append(self.s[self.i + 1])
                self.i += 2
                continue
            if c == q:
                self.i += 1
                return "".join(out)
            out.append(c)
            self.i += 1
        raise ValueError("unterminated string")

    def atom(self):
        m = re.match(r"(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|!0|!1|true|false|null|undefined|NaN|[A-Za-z_$][\w$]*)",
                     self.s[self.i:])
        if not m:
            raise ValueError(f"bad atom at {self.s[self.i:self.i + 20]!r}")
        tok = m.group(0)
        self.i += len(tok)
        if tok in ("!1", "true"):
            return True
        if tok in ("!0", "false"):
            return False
        if tok in ("null", "undefined", "NaN"):
            return None
        try:
            return float(tok) if ("." in tok or "e" in tok or "E" in tok) else int(tok)
        except ValueError:
            return tok  # неизвестный идентификатор — вернуть как строку

    def key(self):
        self.ws()
        if self.s[self.i] in "\"'":
            return self.string()
        m = re.match(r"[A-Za-z_$][\w$]*", self.s[self.i:])
        if not m:
            raise ValueError(f"bad key at {self.s[self.i:self.i + 20]!r}")
        self.i += len(m.group(0))
        return m.group(0)

    def obj(self):
        self.i += 1  # {
        d = {}
        while True:
            self.ws()
            if self.s[self.i] == "}":
                self.i += 1
                return d
            k = self.key()
            self.ws()
            assert self.s[self.i] == ":", f"no colon at {self.s[self.i:self.i + 20]!r}"
            self.i += 1
            d[k] = self.parse()
            self.ws()
            if self.s[self.i] == ",":
                self.i += 1

    def arr(self):
        self.i += 1  # [
        a = []
        while True:
            self.ws()
            if self.s[self.i] == "]":
                self.i += 1
                return a
            if self.s[self.i] == ",":
                self.i += 1
                continue
            a.append(self.parse())
            self.ws()
            if self.s[self.i] == ",":
                self.i += 1


def bracket_match(s: str, start: int) -> int:
    """Индекс закрывающей скобки для открывающей на start (учитывает строки)."""
    pairs = {"[": "]", "{": "}", "(": ")"}
    close = pairs[s[start]]
    depth, i, n = 0, start, len(s)
    while i < n:
        c = s[i]
        if c in "\"'":
            q = c
            i += 1
            while i < n:
                if s[i] == "\\":
                    i += 2
                    continue
                if s[i] == q:
                    break
                i += 1
        elif c in "[{(":
            depth += 1
        elif c in "]})":
            depth -= 1
            if depth == 0:
                if c != close:
                    raise ValueError("mismatched brackets")
                return i
        i += 1
    raise ValueError("no match")


def split_top(s: str) -> list[str]:
    """Разбить содержимое [...] по запятым верхнего уровня."""
    parts, depth, cur, i, n = [], 0, [], 0, len(s)
    while i < n:
        c = s[i]
        if c in "\"'":
            q = c
            cur.append(c)
            i += 1
            while i < n:
                cur.append(s[i])
                if s[i] == "\\":
                    cur.append(s[i + 1] if i + 1 < n else "")
                    i += 2
                    continue
                if s[i] == q:
                    break
                i += 1
        elif c in "[{(":
            depth += 1
            cur.append(c)
        elif c in "]})":
            depth -= 1
            cur.append(c)
        elif c == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    if "".join(cur).strip():
        parts.append("".join(cur))
    return parts


def parse_js(text: str):
    return JSParser(text).parse()


# ------------------------------------------------------------- загрузка
def fetch_chunks(workdir: Path) -> dict[str, str]:
    page = http(SITE + "/map")
    urls = set(re.findall(r'"/_next/static/chunks/[^"]+\.js"', page))
    # дата-чанки (BLIPS/MAP_ZONES) подгружаются динамически — собираем
    # полный список через headless-браузер
    try:
        from playwright.sync_api import sync_playwright
        seen = set()

        def on_req(r):
            u = r.url
            if "/_next/static/chunks/" in u and u.endswith(".js"):
                seen.add('"' + u.split(SITE)[-1] + '"')

        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            pg = b.new_context(user_agent="Mozilla/5.0").new_page()
            pg.on("request", on_req)
            for view in ("", "?view=green_zones", "?view=hunting", "?view=treasure"):
                pg.goto(SITE + "/map" + view, wait_until="networkidle", timeout=60000)
                pg.wait_for_timeout(5000)
            b.close()
        urls |= seen
    except Exception as e:
        print(f"браузерный обход чанков пропущен ({e}), только HTML-список")
    urls = sorted(urls)
    print(f"чанков всего: {len(urls)}")
    chunks = {}
    for q in urls:
        u = q.strip('"')
        dest = workdir / ("chunk_" + u.split("/")[-1])
        if not dest.exists():
            dest.write_text(http(SITE + u), encoding="utf-8")
        chunks[u] = dest.read_text(encoding="utf-8")
    return chunks


def find_chunk(chunks: dict[str, str], marker: str) -> str:
    for u, t in chunks.items():
        if marker in t:
            return t
    raise RuntimeError(f"чанк с маркером {marker!r} не найден")


# ------------------------------------------------------------- извлечение
def extract_blips(chunk: str) -> list[dict]:
    """[[items], category]... -> плоский список {id,x,y,label,category}."""
    i = chunk.find("let t=[")
    if i < 0:
        raise RuntimeError("let t=[ (BLIPS) не найден")
    start = chunk.find("[", i + 5)
    end = bracket_match(chunk, start)
    pairs = parse_js(chunk[start:end + 1])
    out = []
    for items, cat in pairs:
        for it in items:
            it = dict(it)
            it["category"] = cat
            out.append(it)
    return out


def extract_map_zones(chunk: str) -> tuple[list[dict], dict, dict]:
    """MAP_ZONES (+ категории зон). Возвращает (zones, zone_category, owners)."""
    m = re.search(r'"MAP_ZONES",0,(\w+),', chunk)
    var = m.group(1)
    i = chunk.rfind(f"{var}=[", 0, m.start())
    if i < 0:
        # присвоение вида `o=[...` без let
        i = chunk.rfind(f"{var}=[", 0, m.start())
        raise RuntimeError("массив MAP_ZONES не найден") if i < 0 else None
    start = chunk.find("[", i)
    end = bracket_match(chunk, start)
    zones = []
    for part in split_top(chunk[start + 1:end]):
        part = part.strip()
        if part.startswith("..."):  # spread [...]/ {...}, бывает с .map() в хвосте
            rest = part[3:].strip()
            v_end = bracket_match(rest, 0)
            val = parse_js(rest[:v_end + 1])
            mm = re.search(r'category:"([\w]+)"', rest[v_end + 1:])
            items = val if isinstance(val, list) else [val]
            if mm:
                items = [dict(z, category=mm.group(1)) if isinstance(z, dict) else z
                         for z in items]
            zones.extend(items)
            continue
        if part.startswith("{"):
            zones.append(parse_js(part))
            continue
        if part.startswith("["):  # массив + возможный .map(e=>({...e,category:"x"}))
            arr_end = bracket_match(part, 0)
            inner = parse_js(part[:arr_end + 1])
            mm = re.search(r'category:"([\w]+)"', part[arr_end:])
            cat = mm.group(1) if mm else "unknown"
            for z in inner:
                z = dict(z)
                z["category"] = cat
                zones.append(z)
            continue
    zc, owners = {}, {}
    for pat, store in [(r'"ZONE_CATEGORY",0,(\w+),', zc), (r'"GHETTO_OWNER",0,(\w+),', owners)]:
        mm = re.search(pat, chunk)
        if not mm:
            continue
        v = mm.group(1)
        k = chunk.rfind(f"{v}={{", 0, mm.start())
        if k < 0:
            k = chunk.rfind(f"{v}=", 0, mm.start())
            k = chunk.find("{", k)
        else:
            k = chunk.find("{", k)
        try:
            store.update(parse_js(chunk[k:bracket_match(chunk, k) + 1]))
        except Exception:
            pass
    return zones, zc, owners


def extract_blip_category(chunk: str) -> tuple[dict, list[dict]]:
    """BLIP_CATEGORY dict + BLIP_SHEETS (геометрия спрайтов)."""
    m = re.search(r'"BLIP_CATEGORY",0,(\w+),', chunk)
    var = m.group(1)
    k = chunk.rfind(f"{var}={{", 0, m.start())
    if k < 0:
        raise RuntimeError("BLIP_CATEGORY не найден")
    start = chunk.find("{", k)
    cats = parse_js(chunk[start:bracket_match(chunk, start) + 1])
    # листы: a=[{url:i.src,cols:16,rows:16,cellW:64,...}]
    sheets = []
    for sm in re.finditer(r"cols:(\d+),rows:(\d+),cellW:([\d.]+),cellH:([\d./]+),startId:(\d+),count:(\d+)", chunk):
        cols, rows = int(sm.group(1)), int(sm.group(2))
        cellW = float(sm.group(3))
        cellH = eval(sm.group(4))  # бывает 512/7
        sheets.append({"cols": cols, "rows": rows, "cellW": cellW, "cellH": cellH,
                       "startId": int(sm.group(5)), "count": int(sm.group(6))})
    urls = re.findall(r'"/_next/static/media/(blip_sheet_\d\.[^"]+\.webp)"', chunk)
    for s, u in zip(sheets, ["/_next/static/media/" + x for x in urls]):
        s["url"] = u
    return cats, sheets


def extract_area_styles(chunk: str) -> dict:
    out = dict(AREA_STYLE)
    m = re.search(r"hunting_spots:\{label:", chunk)
    if not m:
        return out
    # берём style-блоки трёх групп
    for key in ("hunting_spots", "treasure_spots", "treasure_depth"):
        mm = re.search(re.escape(key) + r":\{.*?style:(\{[^}]+\})", chunk[m.start():m.start() + 4000].replace("\n", " "))
        if mm:
            try:
                out[key] = parse_js(mm.group(1))
            except Exception:
                pass
    return out


# ------------------------------------------------------------- SVG
def svg_open(width: int, height: int) -> list[str]:
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
            f'<rect width="{width}" height="{height}" fill="#1a1a1b"/>']


def svg_legend(L: list[str], counts: Counter, color: dict) -> None:
    L.append('<g font-family="sans-serif" font-size="13">')
    lx, ly = 12, 20
    for g, n in counts.most_common(30):
        L.append(f'<rect x="{lx}" y="{ly - 10}" width="12" height="12" fill="{color[g]}"/>'
                 f'<text x="{lx + 18}" y="{ly}" fill="#eee">{html.escape(str(g))} ({n})</text>')
        ly += 20
    if len(counts) > 30:
        L.append(f'<text x="{lx}" y="{ly}" fill="#888">… и ещё {len(counts) - 30}</text>')
    L.append("</g>")


def bounds_of(points: list[tuple[float, float]], pad: float = 0.03):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    dx = (max(xs) - min(xs)) * pad
    dy = (max(ys) - min(ys)) * pad
    return (min(xs) - dx, min(ys) - dy, max(xs) + dx, max(ys) + dy)


def make_svg(path: Path, extent, width: int, draw) -> None:
    minx, miny, maxx, maxy = extent
    sx = width / (maxx - minx)
    height = round(width * (maxy - miny) / (maxx - minx))
    L = svg_open(width, height)
    draw(L, lambda x: (x - minx) * sx, lambda y: (maxy - y) * sx, sx)
    L.append("</svg>")
    path.write_text("\n".join(L), encoding="utf-8")


# ------------------------------------------------------------- main
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Парсинг карты wiki.gta5rp.com/map")
    ap.add_argument("--only", nargs="*", default=["main", "green_zones", "hunting", "treasure", "icons"],
                    help="что качать: main green_zones hunting treasure icons")
    ap.add_argument("--out", default=str(ROOT / "out"))
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    work = ROOT / "_work"
    work.mkdir(exist_ok=True)

    print("== скачиваю чанки ==")
    chunks = fetch_chunks(work)
    blip_chunk = find_chunk(chunks, '["BLIPS",0,')
    zone_chunk = find_chunk(chunks, '"MAP_ZONES",0,')

    print("== категории и спрайты ==")
    cats, sheets = extract_blip_category(zone_chunk if '"BLIP_CATEGORY",0,' in zone_chunk else blip_chunk)
    print(f"категорий меток: {len(cats)}, спрайт-листов: {len(sheets)}")

    if "main" in args.only:
        print("== main: метки ==")
        blips = extract_blips(blip_chunk)
        for b in blips:
            c = cats.get(b["category"], {})
            b["group"] = c.get("group")
            b["blipId"] = c.get("blipId")
            b["link"] = c.get("link")
        (out / "main_blips.json").write_text(json.dumps(blips, ensure_ascii=False, indent=1), encoding="utf-8")
        with (out / "main_blips.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["id", "x", "y", "label", "category", "group", "blipId", "link"])
            for b in blips:
                w.writerow([b.get("id"), b.get("x"), b.get("y"), b.get("label"),
                            b.get("category"), b.get("group"), b.get("blipId"), b.get("link")])
        cnt = Counter(b["category"] for b in blips)
        print(f"меток: {len(blips)}, категорий: {len(cnt)}")
        for g, n in cnt.most_common(15):
            print(f"    {g}: {n}")
        ext = bounds_of([(b["x"], b["y"]) for b in blips])
        groups = [g for g, _ in cnt.most_common()]
        color = {g: PALETTE[i % len(PALETTE)] for i, g in enumerate(groups)}

        def draw(L, X, Y, sx):
            for b in blips:
                L.append(f'<circle cx="{X(b["x"]):.1f}" cy="{Y(b["y"]):.1f}" r="4"'
                         f' fill="{color[b["category"]]}">'
                         f'<title>{html.escape(str(b.get("id")))} — {html.escape(str(cats.get(b["category"], {}).get("label", b["category"])))}'
                         f' ({b["x"]:.0f}, {b["y"]:.0f})</title></circle>')
            svg_legend(L, cnt, color)

        make_svg(out / "main.svg", ext, 1400, draw)
        print("main.svg готов")

    if "green_zones" in args.only:
        print("== green_zones ==")
        zones, zc, owners = extract_map_zones(zone_chunk)
        (out / "green_zones.json").write_text(
            json.dumps({"zones": zones, "zone_category": zc, "owners": owners},
                       ensure_ascii=False, indent=1), encoding="utf-8")
        gz = [z for z in zones if z.get("category") == "green_zone"]
        print(f"зон всего: {len(zones)}, зелёных: {len(gz)}")
        with (out / "green_zones.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["uId", "name", "category", "cx", "cy", "vertices"])
            for z in zones:
                ring = (z.get("poly") or [[]])[0]
                xs = [p[0] for p in ring]
                ys = [p[1] for p in ring]
                w.writerow([z.get("uId"), z.get("name"), z.get("category"),
                            sum(xs) / len(xs) if xs else "", sum(ys) / len(ys) if ys else "",
                            len(ring)])
        pts = [(p[0], p[1]) for z in zones for ring in (z.get("poly") or []) for p in ring]
        ext = bounds_of(pts)
        cnt = Counter(z.get("category") for z in zones)
        groups = [g for g, _ in cnt.most_common()]
        color = {g: PALETTE[i % len(PALETTE)] for i, g in enumerate(groups)}

        def draw(L, X, Y, sx):
            for z in zones:
                for ring in (z.get("poly") or []):
                    p = " ".join(f"{X(p[0]):.1f},{Y(p[1]):.1f}" for p in ring)
                    if p:
                        c = color[z.get("category")]
                        L.append(f'<polygon points="{p}" fill="{c}" fill-opacity="0.25"'
                                 f' stroke="{c}" stroke-width="1.5">'
                                 f'<title>{html.escape(str(z.get("uId")))} — {html.escape(str(z.get("name")))}</title></polygon>')
            svg_legend(L, cnt, color)

        make_svg(out / "green_zones.svg", ext, 1400, draw)
        print("green_zones.svg готов")

    if "hunting" in args.only or "treasure" in args.only:
        styles = extract_area_styles(blip_chunk)
        (out / "categories.json").write_text(
            json.dumps({"blip_category": cats, "sheets": sheets, "area_styles": styles},
                       ensure_ascii=False, indent=1), encoding="utf-8")
        for view, fname, key in [("hunting", "hunting-spots.json", "hunting_spots"),
                                 ("treasure", "treasure-spots.json", "treasure_spots")]:
            if view not in args.only:
                continue
            print(f"== {view} ==")
            areas = json.loads(http(SITE + "/map/data/" + fname))
            (out / (view + ".json")).write_text(json.dumps(areas, ensure_ascii=False), encoding="utf-8")
            # areas = [polygons...], polygon = [ring, holes...]
            polys = []
            for pi, poly in enumerate(areas):
                rings = poly if isinstance(poly[0][0], list) else [poly]
                for ri, ring in enumerate(rings):
                    polys.append((pi, ri, ring))
            with (out / (view + ".csv")).open("w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["poly_id", "ring", "cx", "cy", "vertices"])
                for pi, ri, ring in polys:
                    xs = [p[0] for p in ring]
                    ys = [p[1] for p in ring]
                    w.writerow([pi, ri, sum(xs) / len(xs), sum(ys) / len(ys), len(ring)])
            print(f"полигонов: {len(areas)}, колец: {len(polys)}")
            ext = bounds_of([(p[0], p[1]) for _, _, ring in polys for p in ring])
            st = styles.get(key, AREA_STYLE[key])

            def draw(L, X, Y, sx, _polys=polys, _st=st):
                for _, _, ring in _polys:
                    p = " ".join(f"{X(p[0]):.1f},{Y(p[1]):.1f}" for p in ring)
                    L.append(f'<polygon points="{p}" fill="{_st["fill"]}"'
                             f' stroke="{_st["stroke"]}" stroke-width="1.5"/>')

            make_svg(out / (view + ".svg"), ext, 1400, draw)
        if "treasure" in args.only:
            depth = http(SITE + "/map/data/treasure-depth.json")
            (out / "treasure_depth.json").write_text(depth, encoding="utf-8")
            print(f"treasure-depth: {len(depth) / 1024:.0f} KB")
            roads = http(SITE + "/map/data/roads.json")
            (out / "roads.json").write_text(roads, encoding="utf-8")
            print(f"roads: {len(roads) / 1024:.0f} KB")

    if "icons" in args.only:
        print("== иконки ==")
        idir = out / "icons"
        idir.mkdir(exist_ok=True)
        for s in sheets:
            if not s.get("url"):
                continue
            dest = idir / s["url"].split("/")[-1].split("?")[0]
            if not dest.exists():
                dest.write_bytes(http(SITE + s["url"], binary=True))
            s["file"] = dest.name
            print(f"лист: {dest.name}")
        try:
            from PIL import Image
            for cat, c in sorted(cats.items()):
                bid = c.get("blipId")
                if bid is None:
                    continue
                sh = next((s for s in sheets
                           if s["startId"] <= bid < s["startId"] + s["count"]), None)
                if not sh or not sh.get("file"):
                    continue
                r = bid - sh["startId"]
                col, row = r % sh["cols"], r // sh["cols"]
                im = Image.open(idir / sh["file"])
                cell = im.crop((int(col * sh["cellW"]), int(row * sh["cellH"]),
                                int((col + 1) * sh["cellW"]), int((row + 1) * sh["cellH"])))
                cell.save(idir / f"blip_{bid}_{cat}.png")
            print(f"нарезано иконок: {len(list(idir.glob('blip_*.png')))}")
        except ImportError:
            print("PIL нет — нарезка пропущена, листы скачаны")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
