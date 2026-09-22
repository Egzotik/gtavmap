"""Online counters for the hub page.

Runs in GitHub Actions (server side, no CORS issues) and writes online.json
at the repo root. The hub reads that file from the same origin.
Keeps the old file untouched if both APIs fail.
"""
import json
import urllib.request
from datetime import datetime, timezone

MAJESTIC_URL = "https://wiki.majestic-rp.ru/api/online"
GTA5RP_URL = "https://gta5masterlist.net/api/projects/gta-5-rp"


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


out = {"majestic": None, "gta5rp": None}

try:
    data = get_json(MAJESTIC_URL).get("data", {})
    if isinstance(data.get("players"), (int, float)):
        out["majestic"] = int(data["players"])
    else:
        out["majestic"] = sum(int(s.get("players") or 0) for s in data.get("servers", []))
except Exception as e:
    print("majestic failed:", str(e)[:200])

try:
    data = get_json(GTA5RP_URL)
    if isinstance(data.get("online"), (int, float)):
        out["gta5rp"] = int(data["online"])
except Exception as e:
    print("gta5rp failed:", str(e)[:200])

out["updatedAt"] = datetime.now(timezone.utc).isoformat()

if out["majestic"] is None and out["gta5rp"] is None:
    print("both APIs failed, keeping old online.json")
else:
    with open("online.json", "w", encoding="utf-8") as f:
        json.dump(out, f)
    print("wrote", out)
