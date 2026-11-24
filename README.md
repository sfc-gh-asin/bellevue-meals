# Bellevue Meals: week at a glance

A minimal static page that shows **this week's and next week's** Snowflake Bellevue
menus as a single grid (days as columns, meals as rows). One click switches weeks.
No build step, no dependencies. It's built to run on GitHub Pages.

```
index.html        page shell
style.css         styles (light/dark, responsive)
app.js            reads data/meals.json and renders the grid
data/meals.json   ← the only file that changes
scripts/fetch_meals.py   pulls menus from Sifted's API → data/meals.json
scripts/validate.py      sanity-check meals.json before committing
.github/workflows/update-meals.yml   scheduled job that runs the two scripts and commits
```

## Run locally

`fetch()` doesn't work over `file://`, so use a local server:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

To preview as if it were a different day, add `?today=2026-11-25` to the URL.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Go to **Settings → Pages → Build and deployment**, set Source to *Deploy from a branch*, then pick `main` and `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.

## Updating the menu

```sh
python3 scripts/fetch_meals.py && python3 scripts/validate.py
```

The fetcher (stdlib only) calls the same JSON API the Sifted site uses:

1. `GET https://snowflake.sifted.co/api/markets/snowflake/bellevue` → market `id`
2. `GET https://snowflake.sifted.co/api/markets/meals?id=<id>&date=YYYY-MM-DD` for each weekday,
   from this Monday through next Friday (the API refuses anything later).

It turns each Sifted "menu" into a station (brand name + headline dish), keeps vegan/vegetarian
tags, allergens and ingredients, and folds toppings, dressings, sauces, salad-bar bases and
items the cafe's own TV screens hide (`tv-ignore`) into a collapsible "+ N more" line.
If a day fails to fetch, the previous entry for that day is kept, and `updated` only changes
when the menu content does.

**Automation:** `.github/workflows/update-meals.yml` runs the fetcher each weekday morning
(and Sunday afternoon) and commits `data/meals.json` only if it changed. Pages redeploys on
each push. Under the repo's **Settings → Actions → General → Workflow permissions**, allow
read *and* write. You can also start it by hand from the Actions tab.

The page works out "this week" and "next week" from the viewer's current date (weeks run
Monday to Sunday). On weekends it opens on next week.

### Format

```jsonc
{
  "location": "Bellevue",                    // optional, used in the title
  "updated": "2026-11-23T07:00:00-08:00",    // optional, shown in the header
  "notice": "Optional banner text",          // optional; remove when not needed
  "days": [
    {
      "date": "2026-11-23",                  // YYYY-MM-DD, required
      "meals": [
        {
          "name": "Lunch",                   // becomes a grid row
          "time": "11:30 AM–1:30 PM",        // optional
          "location": "Cafe, 3rd floor",     // optional
          "stations": [
            {
              "name": "Wok N Tandoor",       // optional
              "dish": "Tandoori Chicken",    // optional headline
              "items": [
                { "name": "Tandoori Chicken", "main": true },   // main dishes are emphasized
                { "name": "Garlic Naan", "tags": ["V"], "allergens": ["Milk", "Wheat"],
                  "ingredients": "optional", "description": "optional" },
                "Plain strings work too"
              ],
              "extras": [ { "label": "sauces", "items": ["Raita"] } ]   // optional, collapsed
            }
          ]
        }
      ]
    },
    { "date": "2026-11-26", "closed": true, "note": "Closed for Thanksgiving" }
  ]
}
```

- **Rows** come from the meal names used that week, ordered Breakfast → Brunch → Lunch → Snacks → Dinner, with any other names after those.
- **Weekends** only appear as columns if `days` includes entries for them.
- **Mains vs. sides:** items with `"main": true` are shown large and bold; the rest form a muted "with …" line (first 4 shown, the rest plus `extras` behind "+N more"). The fetcher marks Sifted entrées/proteins as mains.
- **Layout:** a timetable. Stations are rows and days are columns. When a station serves identical food on consecutive days, those cells merge into one with an "Every day" / "Mon – Wed" span line. Phones get a day-by-day list with the same station/dish structure.
- **Marks:** `VG` vegan is a filled green dot, `V` vegetarian an open green ring (the two tags Sifted provides). Other tags show as small bold letters. Edit `TAGS` in `app.js`.
- **Look:** one typeface (Helvetica Neue from the system, no web fonts), black on white, two rule weights. Green is the only color, and it's reserved for the diet marks. Colors and spacing are CSS variables at the top of `style.css`.
- **Allergens** are hidden until the viewer ticks the "Allergens" toggle; hovering a dish shows its allergens and ingredients either way.
