// Renders data/meals.json as a timetable: stations are rows, days are columns.
// No build step, no dependencies. See README.md for the data format.

const TAGS = { VG: "Vegan", V: "Vegetarian", GF: "Gluten-free", DF: "Dairy-free", H: "Halal" };
const MEAL_ORDER = ["breakfast", "brunch", "lunch", "snack", "snacks", "dinner"];
const SIDES_SHOWN = 4;

// ---------- dates (local time, "YYYY-MM-DD") ----------
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
const fmt = (d, opts) => d.toLocaleDateString("en-US", opts);

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

// ?today=2026-11-25 previews the page as of another date.
const todayParam = new URLSearchParams(location.search).get("today");
const today = todayParam ? parseISO(todayParam) : new Date();
const todayISO = toISO(today);
const thisMonday = mondayOf(today);

let byDate = new Map();
const hasFood = (day) => day && !day.closed && day.meals?.length;

function weekDays(offset) {
  const mon = addDays(thisMonday, offset * 7);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    const iso = toISO(d);
    const day = byDate.get(iso);
    if (i < 5 || hasFood(day)) out.push({ d, iso, day, isToday: iso === todayISO, isPast: d < today && iso !== todayISO });
  }
  return out;
}

function rangeLabel(mon) {
  const fri = addDays(mon, 4);
  return fri.getMonth() === mon.getMonth()
    ? `${fmt(mon, { month: "short" })} ${mon.getDate()}–${fri.getDate()}`
    : `${fmt(mon, { month: "short" })} ${mon.getDate()} – ${fmt(fri, { month: "short" })} ${fri.getDate()}`;
}

// ---------- dish rendering ----------
function marks(tags = []) {
  return tags
    .map((t) => {
      const code = String(t).toUpperCase();
      const label = TAGS[code] || t;
      return code === "VG" || code === "V"
        ? `<i class="mark mark-${code}" title="${label}" aria-label="${label}"></i>`
        : `<i class="mark-text" title="${esc(label)}">${esc(code)}</i>`;
    })
    .join("");
}

function itemHTML(item, tag, sep = "") {
  const info = [
    item.allergens?.length ? `Contains: ${item.allergens.join(", ")}` : "",
    item.ingredients ? `Ingredients: ${item.ingredients}` : "",
  ].filter(Boolean).join("\n");
  // Keep the last word, mark and comma together so they never wrap apart.
  const name = esc(item.name);
  const cut = name.lastIndexOf(" ");
  const allergens = item.allergens?.length ? `<span class="allergens">${esc(item.allergens.join(", "))}</span>` : "";
  return `<${tag}${info ? ` title="${esc(info)}"` : ""}>${name.slice(0, cut + 1)}<span class="nw">${name.slice(cut + 1)}${marks(item.tags)}${sep}</span>${allergens}</${tag}>`;
}

function stationBody(st) {
  const items = (st.items || []).map((it) => (typeof it === "string" ? { name: it } : it));
  const mains = items.filter((i) => i.main);
  const sides = items.filter((i) => !i.main);
  const shown = sides.slice(0, SIDES_SHOWN);
  const hidden = sides.slice(SIDES_SHOWN).map((i) => i.name);
  const extras = [...(hidden.length ? [{ label: "more", items: hidden }] : []), ...(st.extras || [])].filter(
    (x) => x.items?.length
  );
  const n = extras.reduce((k, x) => k + x.items.length, 0);
  return [
    st.dish ? `<p class="dish">${esc(st.dish)}</p>` : "",
    mains.length ? `<ul class="dishes">${mains.map((m) => itemHTML(m, "li")).join("")}</ul>` : "",
    shown.length
      ? `<p class="sides">${shown.map((s, i) => itemHTML(s, "span", i < shown.length - 1 ? "," : "")).join(" ")}</p>`
      : "",
    n
      ? `<details class="more"><summary>${n} more</summary>${extras
          .map((x) => `<p><b>${esc(titleCase(x.label))}</b> ${x.items.map(esc).join(", ")}</p>`)
          .join("")}</details>`
      : "",
  ].join("");
}

// Content fingerprint, used to merge identical consecutive days into one cell.
const signature = (st) =>
  JSON.stringify([st.dish, (st.items || []).map((i) => (typeof i === "string" ? i : i.name)), st.extras]);

// [meal name, [station names in order of first appearance]] for the week
function structure(days) {
  const meals = new Map();
  for (const { day } of days)
    for (const m of day?.meals || []) {
      if (!meals.has(m.name)) meals.set(m.name, []);
      const list = meals.get(m.name);
      for (const s of m.stations) if (!list.includes(s.name)) list.push(s.name);
    }
  const rank = (n) => { const i = MEAL_ORDER.indexOf(n.toLowerCase()); return i < 0 ? 99 : i; };
  return [...meals.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

const stationOn = (day, meal, name) =>
  day?.meals?.find((m) => m.name === meal)?.stations.find((s) => s.name === name);

const offNote = (day) => esc(day?.closed ? day.note || "Closed" : "No service");

// ---------- desktop: timetable ----------
function renderTable(days, meals) {
  const el = document.getElementById("table");
  el.style.gridTemplateColumns =
    "var(--label) " + days.map(({ day }) => (hasFood(day) ? "minmax(0, 1fr)" : "var(--slim)")).join(" ");
  const out = [];
  const at = (col, row, span = 1) => `style="grid-column:${col} / span ${span};grid-row:${row}"`;
  let row = 1;

  out.push(`<div class="corner" ${at(1, row)}></div>`);
  days.forEach(({ d, day, isToday, isPast }, i) => {
    out.push(
      `<div class="dayhead${isToday ? " today" : ""}${isPast ? " past" : ""}${hasFood(day) ? "" : " off"}" ${at(i + 2, row)}>
        <span class="num">${d.getDate()}</span>
        <span class="dow">${fmt(d, { weekday: hasFood(day) ? "long" : "short" })}${isToday ? ", today" : ""}</span>
        ${hasFood(day) ? "" : `<span class="note">${offNote(day)}</span>`}
      </div>`
    );
  });
  row++;

  for (const [meal, stations] of meals) {
    out.push(`<h2 class="meal" ${at(1, row, days.length + 1)}>${esc(meal)}</h2>`);
    row++;
    for (const name of stations) {
      out.push(`<div class="station-name" ${at(1, row)}>${esc(titleCase(name))}</div>`);
      for (let i = 0; i < days.length; ) {
        const st = stationOn(days[i].day, meal, name);
        let span = 1;
        if (st) {
          const sig = signature(st);
          while (i + span < days.length) {
            const next = stationOn(days[i + span].day, meal, name);
            if (!next || signature(next) !== sig) break;
            span++;
          }
        }
        const group = days.slice(i, i + span);
        const past = group.every((g) => g.isPast) ? " past" : "";
        out.push(
          st
            ? `<div class="cell${past}${span > 1 ? " merged" : ""}" ${at(i + 2, row, span)}>${
                span > 1
                  ? `<div class="span"><span>${
                      span === days.filter((x) => hasFood(x.day)).length
                        ? "Every day"
                        : `${fmt(group[0].d, { weekday: "short" })} – ${fmt(group[span - 1].d, { weekday: "short" })}`
                    }</span></div>`
                  : ""
              }${stationBody(st)}</div>`
            : `<div class="cell blank${past}" ${at(i + 2, row)}></div>`
        );
        i += span;
      }
      row++;
    }
  }

  // Today's column tint sits behind the content.
  const t = days.findIndex((x) => x.isToday);
  if (t >= 0) out.unshift(`<div class="today-col" style="grid-column:${t + 2};grid-row:1 / ${row}"></div>`);

  el.innerHTML = meals.length ? out.join("") : `<p class="nothing">No menus posted for this week yet.</p>`;
}

// ---------- phones: one day after another ----------
let dayObserver;

function renderList(days, meals) {
  // Sticky strip of days: tap to jump; the day in view is highlighted.
  const nav = `<nav class="daynav" aria-label="Jump to day">${days
    .map(
      ({ d, iso, day, isToday }) =>
        `<a href="#d-${iso}" data-iso="${iso}" class="${isToday ? "today" : ""}${hasFood(day) ? "" : " off"}">
          <span class="dow">${fmt(d, { weekday: "short" })}</span><span class="num">${d.getDate()}</span>
        </a>`
    )
    .join("")}</nav>`;

  document.getElementById("list").innerHTML = nav + days
    .map(({ d, iso, day, isToday, isPast }) => {
      const head = `<div class="dayhead${isToday ? " today" : ""}" id="d-${iso}">
          <span class="num">${d.getDate()}</span><span class="dow">${fmt(d, { weekday: "long" })}${isToday ? ", today" : ""}</span>
        </div>`;
      if (!hasFood(day)) return `<section class="lday off">${head}<p class="note">${offNote(day)}</p></section>`;
      const body = meals
        .map(([meal, stations]) => {
          const rows = stations
            .map((n) => [n, stationOn(day, meal, n)])
            .filter(([, st]) => st)
            .map(([n, st]) => `<div class="lrow"><div class="station-name">${esc(titleCase(n))}</div><div class="cell">${stationBody(st)}</div></div>`)
            .join("");
          return rows ? `<h2 class="meal">${esc(meal)}</h2>${rows}` : "";
        })
        .join("");
      return `<section class="lday${isPast ? " past" : ""}">${head}${body}</section>`;
    })
    .join("");

  const list = document.getElementById("list");
  const links = [...list.querySelectorAll(".daynav a")];
  const setActive = (iso) => links.forEach((a) => a.classList.toggle("active", a.dataset.iso === iso));
  links.forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById(`d-${a.dataset.iso}`).scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(a.dataset.iso);
    })
  );
  // Highlight the day whose section currently sits under the strip.
  dayObserver?.disconnect();
  dayObserver = new IntersectionObserver(
    (entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.querySelector(".dayhead").id.slice(2));
    },
    { rootMargin: "-80px 0px -70% 0px" }
  );
  list.querySelectorAll(".lday").forEach((sec) => dayObserver.observe(sec));
  setActive((days.find((x) => x.isToday) || days.find((x) => hasFood(x.day)) || days[0]).iso);
}

function render(offset) {
  const days = weekDays(offset);
  const meals = structure(days);
  renderTable(days, meals);
  renderList(days, meals);

  document.querySelectorAll(".weeks button").forEach((b) =>
    b.setAttribute("aria-selected", String(Number(b.dataset.week) === offset))
  );
  history.replaceState(null, "", offset ? "#next" : location.pathname + location.search);

  if (offset === 0 && days[0].iso !== todayISO && matchMedia("(max-width: 900px)").matches)
    document.getElementById(`d-${todayISO}`)?.scrollIntoView({ block: "start" });
}

async function main() {
  let data;
  try {
    const res = await fetch("data/meals.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    document.getElementById("table").innerHTML = `<p class="nothing">Couldn’t load menu data (${esc(e.message)}).</p>`;
    return;
  }
  byDate = new Map((data.days || []).map((d) => [d.date, d]));

  if (data.updated) {
    const u = new Date(data.updated);
    document.getElementById("updated").textContent =
      "Updated " + u.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });
  }
  if (data.notice) {
    const n = document.getElementById("notice");
    n.textContent = data.notice;
    n.hidden = false;
  }
  if (data.location) document.querySelector(".ident strong").textContent = data.location;

  for (const i of [0, 1]) document.getElementById(`range-${i}`).textContent = rangeLabel(addDays(thisMonday, i * 7));

  const used = new Set();
  for (const d of data.days || [])
    for (const m of d.meals || [])
      for (const s of m.stations || [])
        for (const it of s.items || []) for (const t of it.tags || []) used.add(String(t).toUpperCase());
  document.getElementById("legend").innerHTML = ["VG", "V"]
    .filter((k) => used.has(k))
    .map((k) => `<span>${marks([k])}${TAGS[k]}</span>`)
    .join("");

  const box = document.getElementById("show-allergens");
  box.checked = localStorage.getItem("showAllergens") === "1";
  document.body.classList.toggle("show-allergens", box.checked);
  box.addEventListener("change", () => {
    document.body.classList.toggle("show-allergens", box.checked);
    localStorage.setItem("showAllergens", box.checked ? "1" : "0");
  });

  const weekend = today.getDay() === 0 || today.getDay() === 6;
  let offset = location.hash === "#next" || (weekend && !hasFood(byDate.get(todayISO))) ? 1 : 0;

  document.querySelectorAll(".weeks button").forEach((b) =>
    b.addEventListener("click", () => render((offset = Number(b.dataset.week))))
  );
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea")) return;
    if (e.key === "ArrowRight" && offset === 0) render((offset = 1));
    if (e.key === "ArrowLeft" && offset === 1) render((offset = 0));
  });

  render(offset);
}

main();
