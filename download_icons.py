"""Скачивание всех иконок меток с wiki.majestic-rp.ru/map/icons/.

Источники URL:
  1. out/*/*_raw.json — поля icon / style.circleIcon со всех слоёв
  2. markers/*.json — поля icon в конвертированных файлах проекта
  3. JS-чанки сайта (там же лежит /map/icons/mark.png и др.)
Листинга каталога на сервере нет (отдаёт SPA-заглушку), поэтому качаем то,
что реально используется.

Запуск:
    python download_icons.py             # докачать недостающее
    python download_icons.py --force     # перекачать всё заново
    python download_icons.py --out icons
"""
import argparse
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = "https://wiki.majestic-rp.ru"
CHUNKS = Path(r"C:\Users\egz0t\AppData\Local\Temp\opencode\jschunks")

PAT = re.compile(r"/map/icons/([A-Za-z0-9_.\-?=\/]+?\.png(?:\?[^\"'\\s)]*)?)")


def collect_from_raw() -> set[str]:
    urls = set()
    for f in list((ROOT / "out").rglob("*_raw.json")) + list((ROOT / "markers").rglob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        stack = [data]
        while stack:
            cur = stack.pop()
            if isinstance(cur, dict):
                for k, v in cur.items():
                    if k in ("icon", "circleIcon") and isinstance(v, str) and v.startswith("/map/icons/"):
                        urls.add(v)
                    elif isinstance(v, (dict, list)):
                        stack.append(v)
            elif isinstance(cur, list):
                stack.extend(cur)
    return urls


def collect_from_chunks() -> set[str]:
    urls = set()
    if not CHUNKS.exists():
        return urls
    for f in CHUNKS.glob("*.js"):
        try:
            t = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for m in PAT.finditer(t):
            urls.add("/map/icons/" + m.group(1))
    return urls


def download(urls: set[str], out_dir: Path, force: bool = False) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    ok, fail, skip = 0, [], 0
    for u in sorted(urls):
        name = u.split("/map/icons/")[-1].split("?", 1)[0]
        dest = out_dir / name
        if not force and dest.exists() and dest.stat().st_size > 0:
            skip += 1
            continue
        try:
            req = urllib.request.Request(SITE + u, headers={"User-Agent": "Mozilla/5.0"})
            blob = urllib.request.urlopen(req, timeout=30).read()
            if not blob.startswith(b"\x89PNG"):
                fail.append((u, "not a png"))
                continue
            dest.write_bytes(blob)
            ok += 1
        except Exception as e:
            fail.append((u, str(e)[:100]))
    print(f"скачано: {ok}, пропущено (уже есть): {skip}, ошибок: {len(fail)}")
    for u, e in fail:
        print(f"  FAIL {u}: {e}")
    total = sum(p.stat().st_size for p in out_dir.glob("*.png"))
    print(f"папка: {out_dir} ({len(list(out_dir.glob('*.png')))} файлов, {total / 1024:.0f} KB)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "icons"))
    ap.add_argument("--force", action="store_true", help="перекачать всё заново")
    args = ap.parse_args()
    urls = collect_from_raw() | collect_from_chunks()
    print(f"уникальных URL: {len(urls)} (raw+markers+чанки)")
    download(urls, Path(args.out), force=args.force)


if __name__ == "__main__":
    main()
