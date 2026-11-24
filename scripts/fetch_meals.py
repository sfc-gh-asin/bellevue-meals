#!/usr/bin/env python3
"""Fetch this week's and next week's Bellevue menus from Sifted and write data/meals.json.

Stdlib only. Usage:
    python3 scripts/fetch_meals.py [--out data/meals.json] [--today YYYY-MM-DD]

How the source site works (snowflake.sifted.co/bellevue/meals):
  GET /api/markets/snowflake/bellevue              -> {"data": {"id": <market id>, ...}}
  GET /api/markets/meals?id=<market id>&date=<day> -> {"data": [ {serviceLine, menus: [...]}, ... ]}
The API refuses dates after next week's Friday.

If a day fails to fetch, any entry already in the output file for that day is kept.
The "updated" timestamp only changes when the menu content changes, so a scheduled
job can commit only when there's something new.
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

BASE = "https://snowflake.sifted.co"
MARKET = "/api/markets/snowflake/bellevue"
UA = "bellevue-meals-glance/1.0 (+GitHub Pages mirror)"

# Element types collapsed into a "+ N toppings" line instead of listed individually.
EXTRA_TYPES = {"Topping": "toppings", "Salad Dressing": "dressings", "Sauce": "sauces"}
MAIN_TYPES = {"Protein", "Vegetarian Entree", "Sandwich", "Entree", "Pizza"}
DIET_TAGS = {"vegan": "VG", "vegetarian": "V"}
ACRONYMS = {"BBQ", "BLT", "PB&J", "PB", "NY", "GF", "DF", "XL"}
SMALL_WORDS = {"and", "or", "of", "with", "on", "in", "a", "the", "&", "to", "de", "al"}


def get_json(path, params=None):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.load(r)
    if isinstance(body, dict) and body.get("error"):
        raise RuntimeError(body["error"].get("message", "API error"))
    return body["data"]


def tidy(name):
    """Turn SHOUTY menu names into Title Case; leave mixed-case words alone."""
    name = re.sub(r"\s+", " ", (name or "").strip())
    words = name.split(" ")
    out = []
    for i, w in enumerate(words):
        if re.fullmatch(r"[A-Z]{2}[a-z]+", w) or re.fullmatch(r"[A-Z]{3,}s", w):  # "MIso", "BISCUITs"
            w = w.lower().capitalize()
        elif w.isupper() and len(w) > 1 and w not in ACRONYMS:
            lw = w.lower()
            w = lw if (i > 0 and lw in SMALL_WORDS) else lw.capitalize()
            # capitalize after hyphens / parens / slashes, e.g. "(dak" -> "(Dak"
            w = re.sub(r"([-(/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
        out.append(w)
    return " ".join(out)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def convert_menu(menu):
    brand = (menu.get("brand") or {}).get("name") or ""
    title = tidy(menu.get("name"))
    items, types, extras = [], [], {}
    elements = menu.get("scheduledElements") or []
    continental = "continental" in norm(title + brand) or any(
        "continental" in [t.lower() for t in el.get("tags") or []] for el in elements
    )
    for el in elements:
        tags = [t.lower() for t in el.get("tags") or []]
        name = tidy(el.get("name"))
        if not name:
            continue
        if el.get("type") in EXTRA_TYPES:
            extras.setdefault(EXTRA_TYPES[el["type"]], []).append(name)
            continue
        if "base" in tags or "customize" in tags:  # build-your-own bases
            extras.setdefault("bases", []).append(name)
            continue
        if "tv-ignore" in tags:  # the cafe's own TV displays hide these
            extras.setdefault("more", []).append(name)
            continue
        item = {"name": name}
        # Main dishes get the visual emphasis; everything else renders as a "sides" line.
        if "continental" not in tags and ({"entree", "featured"} & set(tags) or el.get("type") in MAIN_TYPES):
            item["main"] = True
        diet = [DIET_TAGS[t] for t in ("vegan", "vegetarian") if t in tags]
        if diet:
            item["tags"] = diet[:1]  # vegan implies vegetarian; show the stronger one
        if el.get("allergens"):
            item["allergens"] = [a for a in el["allergens"] if a]
        if (el.get("ingredients") or "").strip():
            item["ingredients"] = el["ingredients"].strip()
        items.append(item)
        types.append(el.get("type"))

    st = {"name": brand or title, "items": items}
    if continental:
        # Same spread every day: no headline, just a (collapsible) list. Sifted sometimes
        # files it under another brand, so label it consistently.
        st["name"] = "Continental Breakfast"
        for i in items:
            i.pop("main", None)
    elif not any(i.get("main") for i in items) and items:
        # No obvious main: promote the item the menu title names (keeping the fuller
        # title, e.g. "6th floor Shortbread Cookies"), else the first non-fruit item.
        named = [i for i in items if norm(i["name"]) and norm(i["name"]) in norm(title)]
        if named:
            named[0]["main"] = True
            named[0]["name"] = title
        else:
            pick = next((i for i, t in zip(items, types) if t != "Fruit"), items[0])
            pick["main"] = True
    if extras:
        st["extras"] = [{"label": k, "items": v} for k, v in extras.items()]
    return st


def convert_day(iso, data):
    lines = sorted(data or [], key=lambda sl: (sl.get("serviceLine") or {}).get("order", 99))
    meals = []
    for sl in lines:
        stations = [convert_menu(m) for m in sl.get("menus") or []]
        stations = [s for s in stations if s["items"] or s.get("extras")]
        name = (sl.get("serviceLine") or {}).get("name") or "Meal"
        if name.lower() == "breakfast":
            stations = merge_hot_breakfast(stations)
        if stations:
            meals.append({"name": name, "stations": stations})
    return {"date": iso, "meals": meals}


# Bellevue runs a single hot breakfast line, but Sifted files its dishes under whichever
# brand made them (Hot Hands, Hot Breakfast, ...). Fold those into one "Hot Breakfast" row.
BREAKFAST_KEEP = {"continental breakfast", "sweet spot"}


def merge_hot_breakfast(stations):
    hot = [s for s in stations if s["name"].lower() not in BREAKFAST_KEEP]
    if not hot:
        return stations
    merged = {"name": "Hot Breakfast", "items": [i for s in hot for i in s["items"]]}
    extras = {}
    for s in hot:
        for x in s.get("extras", []):
            extras.setdefault(x["label"], []).extend(x["items"])
    if extras:
        merged["extras"] = [{"label": k, "items": v} for k, v in extras.items()]
    rest = sorted(
        (s for s in stations if s["name"].lower() in BREAKFAST_KEEP),
        key=lambda s: s["name"].lower() != "continental breakfast",  # continental, then sweets
    )
    return [merged] + rest


def pacific_today():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Los_Angeles")).date()
    except Exception:  # noqa: BLE001 - no tz database available
        return (datetime.now(timezone.utc) - timedelta(hours=8)).date()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/meals.json")
    ap.add_argument("--today", help="pretend today is YYYY-MM-DD")
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else pacific_today()
    monday = today - timedelta(days=today.weekday())
    dates = [monday + timedelta(days=w * 7 + i) for w in (0, 1) for i in range(5)]

    try:
        with open(args.out, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    old_days = {d["date"]: d for d in old.get("days", [])}

    market_id = get_json(MARKET)["id"]
    days, failures = [], 0
    for d in dates:
        iso = d.isoformat()
        try:
            days.append(convert_day(iso, get_json("/api/markets/meals", {"id": market_id, "date": iso})))
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"warn: {iso}: {e}", file=sys.stderr)
            if iso in old_days:
                days.append(old_days[iso])
        time.sleep(0.3)  # be polite

    if failures == len(dates):
        sys.exit("error: every request failed; leaving existing file untouched")

    out = {"location": "Bellevue", "updated": old.get("updated"), "days": days}
    if out["days"] != old.get("days") or not out["updated"]:
        out["updated"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print(f"wrote {args.out}: {sum(1 for d in days if d['meals'])} days with menus")
    else:
        print("no changes")


if __name__ == "__main__":
    main()
