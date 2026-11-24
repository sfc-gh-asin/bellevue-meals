#!/usr/bin/env python3
"""Validate data/meals.json before committing. Exit code 1 on problems.

Usage: python3 scripts/validate.py [path/to/meals.json]
"""
import json
import re
import sys
from datetime import date

path = sys.argv[1] if len(sys.argv) > 1 else "data/meals.json"
errors = []


def err(msg):
    errors.append(msg)


try:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:  # noqa: BLE001
    sys.exit(f"{path}: cannot parse JSON: {e}")

if not isinstance(data.get("days"), list):
    err("top-level 'days' must be a list")

seen = set()
for i, day in enumerate(data.get("days") or []):
    where = f"days[{i}]"
    d = day.get("date", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(d)):
        err(f"{where}: 'date' must be YYYY-MM-DD, got {d!r}")
    else:
        try:
            date.fromisoformat(d)
        except ValueError:
            err(f"{where}: invalid date {d!r}")
        if d in seen:
            err(f"{where}: duplicate date {d}")
        seen.add(d)
    if day.get("closed"):
        continue
    for j, meal in enumerate(day.get("meals") or []):
        mw = f"{where}.meals[{j}]"
        if not meal.get("name"):
            err(f"{mw}: missing 'name'")
        for k, st in enumerate(meal.get("stations") or []):
            for m, item in enumerate(st.get("items") or []):
                if isinstance(item, str):
                    continue
                if not isinstance(item, dict) or not item.get("name"):
                    err(f"{mw}.stations[{k}].items[{m}]: item needs a 'name'")
                elif not isinstance(item.get("tags", []), list):
                    err(f"{mw}.stations[{k}].items[{m}]: 'tags' must be a list")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"{path}: OK ({len(seen)} days)")
