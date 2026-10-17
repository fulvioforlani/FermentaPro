"""Fermentati - webapp per FermentaPro.

Server minimale (solo libreria standard Python + tzdata): serve i file statici
e una piccola API JSON. Lavora su una COPIA del database (volume Docker /data):
il fermentapro.db originale non viene mai toccato.

Temperatura per il segnalatore "pronto":
  - inverno (ott-mag): la temperatura di casa del vaso (default 20 C)
  - estate (giu-set): media giornaliera ARPA Piemonte, stazione Torino Alenia
    (la piu' vicina a Grugliasco, ~3 km). Fonti, in ordine di priorita':
      1. ARPA Banca Dati (dati giornalieri validati, tmedia)
      2. ARPA API Realtime (media delle misure orarie, ultimi 3 giorni)
      3. Open-Meteo (solo previsione dei giorni futuri / buchi), con cache
  - una misura fatta a mano vale per quel giorno e i 7 seguenti (o fino alla successiva)
Tempo equivalente a 20 C: somma giorno per giorno di Q10^((T-20)/10), Q10 = 2.2
"""
import datetime
import json
import os
import re
import shutil
import sqlite3
import threading
import time
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Rome")
except Exception:  # noqa: BLE001  (senza tzdata: ora del sistema)
    TZ = None

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
SEED = os.path.join(HERE, "seed", "fermentapro.db")
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(HERE, "data"))
DB = os.path.join(DATA_DIR, "fermentati.db")
PORT = int(os.environ.get("PORT", "8954"))
LOCK = threading.Lock()

STATION = {
    "name": "Torino Alenia",
    "arpa_daily": "PIE-001272-908",   # Banca Dati Storica ARPA (punto di misura)
    "arpa_rt": "S4294",               # API Realtime ARPA (codice stazione)
    "lat": 45.0789, "lon": 7.6103,
}
HOME = {"lat": 45.068, "lon": 7.578}  # Grugliasco (per Open-Meteo)
RANK = {"arpa": 3, "arpa-rt": 2, "open-meteo": 1}
SUMMER = {6, 7, 8, 9}
METEO = {"last_refresh": None, "arpa_daily": None, "arpa_rt": None, "open_meteo": None}
REFRESH_EVERY = 3 * 3600

KOMBUCHA = {
    "slug": "kombucha", "name": "Kombucha", "type": "bevanda",
    "per_litro": {"tea_g": [5, 8, 6], "sugar_g": [50, 80, 70]},
    "starter_pct": [5, 20, 10],
    "scoby": {"tipico_g": [50, 100], "per_l": "1-3 L", "spessore_cm": [0.5, 1]},
    "f1": {"temp": [20, 26], "days": [7, 14], "taste_from": [5, 7], "base_days_20": 12},
    "ph": {"target": [2.5, 3.5], "safe_below": 4.2},
    "f2": {"days": [2, 4]},
    "steps": [
        "Pesa l'acqua: 1 L = 1000 g.",
        "Sciogli lo zucchero nell'acqua calda e lascia in infusione il tè.",
        "Togli le foglie e lascia raffreddare a temperatura ambiente.",
        "Versa nel vaso di vetro con lo starter del lotto precedente e lo SCOBY.",
        "Copri con un panno traspirante e un elastico.",
        "1a fermentazione: 7-14 giorni a 20-26 °C. Assaggia dal giorno 5-7.",
        "2a fermentazione (facoltativa): in bottiglia 2-4 giorni con frutta o zenzero.",
        "Poi in frigo.",
    ],
    "safety_ok": ["Patina nuova sopra: è il nuovo SCOBY.", "Filamenti marroni sotto: sono lieviti, normali."],
    "safety_bad": ["Muffa pelosa e colorata sullo SCOBY: butta tutto."],
    "rules": ["Vaso di vetro.", "Panno traspirante, non coperchio chiuso.", "Mai metallo a contatto a lungo.",
              "2a fermentazione: la pressione sale, apri le bottiglie con attenzione."],
}

JAR_FIELDS = {
    "name": str, "recipe_id": int, "method": str, "start_date": str,
    "temp_c": float, "base_days": float, "q10": float, "net_g": float,
    "water_g": float, "salt_g": float, "color": str, "notes": str,
    "status": str, "fridge_date": str,
    "kind": str, "temp_mode": str, "tea_g": float, "sugar_g": float,
    "starter_g": float, "scoby_g": float, "continuous": int,
}
NEW_COLS = {
    "kind": "TEXT DEFAULT 'verdure'", "temp_mode": "TEXT DEFAULT 'auto'", "tea_g": "REAL DEFAULT 0",
    "sugar_g": "REAL DEFAULT 0", "starter_g": "REAL DEFAULT 0", "scoby_g": "REAL DEFAULT 0",
    "continuous": "INTEGER DEFAULT 0",
}


def now_local():
    return datetime.datetime.now(TZ) if TZ else datetime.datetime.now()


def conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DB):
        shutil.copyfile(SEED, DB)
        print(f"[fermentati] creato {DB} dalla copia del ricettario", flush=True)
    with conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS jars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, recipe_id INTEGER, method TEXT NOT NULL DEFAULT 'secco',
            start_date TEXT NOT NULL, temp_c REAL NOT NULL DEFAULT 20, base_days REAL NOT NULL DEFAULT 7,
            q10 REAL NOT NULL DEFAULT 2.2, net_g REAL DEFAULT 0, water_g REAL DEFAULT 0, salt_g REAL DEFAULT 0,
            color TEXT DEFAULT '', notes TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'attivo',
            fridge_date TEXT DEFAULT '', created_at TEXT NOT NULL)""")
        have = {r[1] for r in c.execute("PRAGMA table_info(jars)")}
        for col, decl in NEW_COLS.items():
            if col not in have:
                c.execute(f"ALTER TABLE jars ADD COLUMN {col} {decl}")
        c.execute("""CREATE TABLE IF NOT EXISTS jar_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, jar_id INTEGER NOT NULL, date TEXT NOT NULL,
            type TEXT NOT NULL, value REAL, value2 REAL, note TEXT DEFAULT '', created_at TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS weather_days (
            date TEXT PRIMARY KEY, tmean REAL NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS drinks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
            kind TEXT NOT NULL, data TEXT NOT NULL)""")
        c.execute("INSERT OR IGNORE INTO drinks (slug, name, kind, data) VALUES (?,?,?,?)",
                  ("kombucha", "Kombucha", "bevanda", json.dumps(KOMBUCHA, ensure_ascii=False)))


# ------------------------------------------------------------------ meteo
def http_json(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "fermentati/1.0 (uso domestico, Grugliasco)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def upsert_weather(c, d, t, src):
    row = c.execute("SELECT source FROM weather_days WHERE date=?", (d,)).fetchone()
    if row and RANK.get(row[0], 0) > RANK[src]:
        return
    c.execute("""INSERT INTO weather_days (date, tmean, source, updated_at) VALUES (?,?,?,?)
                 ON CONFLICT(date) DO UPDATE SET tmean=excluded.tmean, source=excluded.source, updated_at=excluded.updated_at""",
              (d, round(float(t), 2), src, now_local().isoformat(timespec="seconds")))


def refresh_weather():
    today = now_local().date()
    stamp = now_local().isoformat(timespec="seconds")
    # 1) ARPA Banca Dati: medie giornaliere validate
    try:
        url = ("https://utility.arpa.piemonte.it/meteoidro/dati_giornalieri_meteo/"
               f"?fk_id_punto_misura_meteo={STATION['arpa_daily']}&data_min={today - datetime.timedelta(days=150)}")
        rows, n = [], 0
        while url and n < 20:
            d = http_json(url)
            rows += d.get("results", [])
            url, n = d.get("next"), n + 1
        good = [r for r in rows if r.get("tmedia") is not None]
        with LOCK, conn() as c:
            for r in good:
                upsert_weather(c, r["data"], r["tmedia"], "arpa")
        METEO["arpa_daily"] = {"ok": True, "giorni": len(good), "ultimo": max((r["data"] for r in good), default=None), "quando": stamp}
    except Exception as e:  # noqa: BLE001
        METEO["arpa_daily"] = {"ok": False, "errore": str(e)[:160], "quando": stamp}
    # 2) ARPA Realtime: misure orarie ultimi 3 giorni -> media del giorno
    try:
        d = http_json(f"https://utility.arpa.piemonte.it/api_realtime/data_pie?station_code={STATION['arpa_rt']}&page_size=200")
        by = {}
        for r in d.get("data", []):
            t = r.get("air_temperature")
            if t is not None:
                by.setdefault(r["date"][:10], []).append(float(t))
        used = 0
        with LOCK, conn() as c:
            for day, vals in by.items():
                if len(vals) >= 12:   # giornata abbastanza completa
                    upsert_weather(c, day, sum(vals) / len(vals), "arpa-rt")
                    used += 1
        METEO["arpa_rt"] = {"ok": True, "giorni": used, "quando": stamp}
    except Exception as e:  # noqa: BLE001
        METEO["arpa_rt"] = {"ok": False, "errore": str(e)[:160], "quando": stamp}
    # 3) Open-Meteo: previsione (e riempimento buchi), priorita' piu' bassa
    try:
        d = http_json("https://api.open-meteo.com/v1/forecast"
                      f"?latitude={HOME['lat']}&longitude={HOME['lon']}&daily=temperature_2m_mean"
                      "&past_days=7&forecast_days=16&timezone=Europe%2FRome")
        days = d.get("daily", {})
        with LOCK, conn() as c:
            for day, t in zip(days.get("time", []), days.get("temperature_2m_mean", [])):
                if t is not None:
                    upsert_weather(c, day, t, "open-meteo")
        METEO["open_meteo"] = {"ok": True, "giorni": len(days.get("time", [])), "quando": stamp}
    except Exception as e:  # noqa: BLE001
        METEO["open_meteo"] = {"ok": False, "errore": str(e)[:160], "quando": stamp}
    METEO["last_refresh"] = stamp
    print(f"[fermentati] meteo aggiornato: {json.dumps(METEO, ensure_ascii=False)}", flush=True)


def weather_loop():
    while True:
        try:
            refresh_weather()
        except Exception as e:  # noqa: BLE001
            print("[fermentati] meteo errore:", repr(e), flush=True)
        time.sleep(REFRESH_EVERY)


# ------------------------------------------------------------------ prontezza
def d_(s):
    return datetime.date.fromisoformat(str(s)[:10])


def readiness(j, events, wx, today, hour_frac):
    kombu = (j.get("kind") or "verdure") == "kombucha"
    q = float(j.get("q10") or 2.2)
    base = float(j.get("base_days") or (12 if kombu else 7))
    t_home = float(j.get("temp_c") if j.get("temp_c") is not None else 20)
    mode = j.get("temp_mode") or "auto"
    start = d_(j["start_date"])
    cycle_start, cycle_note = start, ""
    pre = sorted([e for e in events if e["type"] == "prelievo"], key=lambda e: (e["date"], e["id"]))
    if kombu and pre:
        last = pre[-1]
        cycle_start = max(start, d_(last["date"]))
        tot = float((j.get("water_g") or 0) + (j.get("starter_g") or 0) + (j.get("sugar_g") or 0)) or 0
        refill = float(last.get("value2") or last.get("value") or 0)
        frac = min(1.0, max(0.1, refill / tot)) if tot > 0 and refill > 0 else 1 / 3
        base = max(3.0, base * frac)
        cycle_note = f"lotto continuo: rinnovato il {int(round(frac * 100))} %"
    taste_at = max(0.55 * base, 2.0)
    ready_at = max(base, 3.5)
    temps = sorted([e for e in events if e["type"] == "temp" and e.get("value") is not None], key=lambda e: (e["date"], e["id"]))

    def temp_for(day):
        best = None
        for e in temps:
            ed = d_(e["date"])
            if ed <= day and (day - ed).days <= 7:
                best = e
        if best:
            return float(best["value"]), "misurata"
        if mode == "auto" and day.month in SUMMER:
            w = wx.get(day.isoformat())
            if w:
                return w[0], w[1]
            return t_home, "stima"
        return t_home, ("casa" if mode == "auto" else "fissa")

    def f(t):
        return q ** ((min(35.0, max(2.0, t)) - 20.0) / 10.0)

    status = j.get("status") or "attivo"
    end = today
    if status != "attivo" and j.get("fridge_date"):
        end = min(today, d_(j["fridge_date"]))
    series, e_cum, dt_taste, dt_ready = [], 0.0, None, None

    def cross(prev, cur, day):
        nonlocal dt_taste, dt_ready
        if dt_taste is None and prev < taste_at <= cur:
            dt_taste = day
        if dt_ready is None and prev < ready_at <= cur:
            dt_ready = day

    day = cycle_start
    while day < end:
        t, src = temp_for(day)
        prev = e_cum
        e_cum += f(t)
        cross(prev, e_cum, day)
        series.append({"d": day.isoformat(), "t": round(t, 1), "src": src, "e": round(e_cum, 2)})
        day += datetime.timedelta(days=1)
    t_now, src_now = temp_for(min(today, max(cycle_start, today)))
    if status == "attivo" and cycle_start <= today:
        prev = e_cum
        e_cum += f(t_now) * hour_frac
        cross(prev, e_cum, today)
        series.append({"d": today.isoformat(), "t": round(t_now, 1), "src": src_now, "e": round(e_cum, 2), "oggi": True})
    proj = []
    if status == "attivo":
        e2, day = e_cum, today
        first = cycle_start <= today
        if not first:
            day = cycle_start
        steps = 0
        while steps < 150 and (dt_ready is None or len(proj) < 2 or e2 < ready_at * 1.05):
            t, src = temp_for(day)
            part = (1 - hour_frac) if (first and day == today) else 1.0
            prev = e2
            e2 += f(t) * part
            cross(prev, e2, day)
            if not (first and day == today):
                proj.append({"d": day.isoformat(), "t": round(t, 1), "src": src, "e": round(e2, 2)})
            day += datetime.timedelta(days=1)
            steps += 1
            if dt_ready is not None and e2 >= ready_at * 1.05 and len(proj) >= 2:
                break
    level = "pronto" if e_cum >= ready_at else "assaggia" if e_cum >= taste_at else "presto"
    min_ready = cycle_start + datetime.timedelta(days=3)   # mai pronto prima di 3 giorni di calendario
    if level == "pronto" and today < min_ready and status == "attivo":
        level = "assaggia"
    if dt_ready is not None and dt_ready < min_ready:
        dt_ready = min_ready
    return {
        "level": level, "e": round(e_cum, 2), "taste_at": round(taste_at, 2), "ready_at": round(ready_at, 2),
        "base": round(base, 2), "cycle_start": cycle_start.isoformat(), "cycle_note": cycle_note,
        "date_taste": dt_taste.isoformat() if dt_taste else None, "date_ready": dt_ready.isoformat() if dt_ready else None,
        "over": e_cum >= 2 * ready_at, "temp_now": {"t": round(t_now, 1), "src": src_now},
        "series": series[-120:], "proj": proj[:60], "future": cycle_start > today,
    }


def jars_payload():
    now = now_local()
    today = now.date()
    hour_frac = (now.hour * 60 + now.minute) / 1440.0
    with conn() as c:
        jars = [dict(r) for r in c.execute("SELECT * FROM jars ORDER BY start_date DESC, id DESC")]
        evs = {}
        for r in c.execute("SELECT * FROM jar_events ORDER BY date, id"):
            evs.setdefault(r["jar_id"], []).append(dict(r))
        wx = {r["date"]: (r["tmean"], r["source"]) for r in c.execute("SELECT * FROM weather_days")}
    for j in jars:
        j["events"] = evs.get(j["id"], [])
        try:
            j["ready"] = readiness(j, j["events"], wx, today, hour_frac)
        except Exception as e:  # noqa: BLE001
            print("[fermentati] prontezza errore:", j.get("id"), repr(e), flush=True)
            j["ready"] = None
    return jars


def all_data():
    with conn() as c:
        vegs = [dict(r) for r in c.execute("SELECT * FROM vegetables ORDER BY name")]
        spices = [r[0] for r in c.execute("SELECT name FROM spices ORDER BY name")]
        items = {}
        for r in c.execute("SELECT recipe_id, item_type, name, weight_g FROM recipe_items ORDER BY id"):
            items.setdefault(r["recipe_id"], []).append({"type": r["item_type"], "name": r["name"], "g": r["weight_g"] or 0})
        recipes = []
        vmap = {v["name"]: v for v in vegs}
        for r in c.execute("SELECT * FROM recipes ORDER BY id"):
            d = dict(r)
            d["items"] = items.get(d["id"], [])
            months = set()
            for it in d["items"]:
                if it["type"] == "vegetable" and it["name"] in vmap:
                    months |= season_months(vmap[it["name"]]["seasons"])
            d["months"] = sorted(months)
            recipes.append(d)
        drinks = {r["slug"]: json.loads(r["data"]) for r in c.execute("SELECT slug, data FROM drinks")}
    return {"recipes": recipes, "vegetables": vegs, "spices": spices, "drinks": drinks,
            "station": STATION["name"], "today": now_local().date().isoformat()}


def season_months(text):
    t = text or ""
    if "Tutto l'anno" in t:
        return set(range(1, 13))
    m = set()
    if "Primavera" in t: m.update([3, 4, 5])
    if "Estate" in t: m.update([6, 7, 8])
    if "Autunno" in t: m.update([9, 10, 11])
    if "Inverno" in t: m.update([12, 1, 2])
    return m


def clean_jar(body, partial=False):
    out = {}
    for k, typ in JAR_FIELDS.items():
        if k not in body:
            continue
        v = body[k]
        if v is None or v == "":
            out[k] = None if typ is not str else ""
            continue
        try:
            out[k] = typ(v)
        except (TypeError, ValueError):
            raise ValueError(f"campo non valido: {k}")
        if typ is str:
            out[k] = out[k][:2000]
    if "method" in out and out["method"] not in ("secco", "salamoia"):
        raise ValueError("metodo non valido")
    if "status" in out and out["status"] not in ("attivo", "frigo", "finito"):
        raise ValueError("stato non valido")
    if "kind" in out and out["kind"] not in ("verdure", "kombucha"):
        raise ValueError("tipo non valido")
    if "temp_mode" in out and out["temp_mode"] not in ("auto", "fissa"):
        raise ValueError("modo temperatura non valido")
    if "start_date" in out and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", out["start_date"] or ""):
        raise ValueError("data non valida")
    if not partial and not (out.get("name") or "").strip():
        raise ValueError("serve un nome")
    return out


EV_RANGE = {"temp": (-10, 45), "ph": (1, 9), "prelievo": (0, 100000)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or "") and not (self.path or "").startswith("/api/health"):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 200_000:
            raise ValueError("richiesta troppo grande")
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def one_jar(self, jid):
        return next((j for j in jars_payload() if j["id"] == jid), None)

    def route(self, method):
        p = self.path.split("?")[0].rstrip("/")
        try:
            if p == "/api/health" and method == "GET":
                return self.send_json({"ok": True})
            if p == "/api/data" and method == "GET":
                return self.send_json(all_data())
            if p == "/api/meteo" and method == "GET":
                with conn() as c:
                    last = [dict(r) for r in c.execute("SELECT * FROM weather_days ORDER BY date DESC LIMIT 30")]
                return self.send_json({"stazione": STATION, "stato": METEO, "giorni": last})
            if p == "/api/meteo/refresh" and method == "POST":
                refresh_weather()
                return self.send_json({"ok": True, "stato": METEO})
            m = re.fullmatch(r"/api/recipes/(\d+)", p)
            if m and method == "POST":
                b = self.body()
                sets, vals = [], []
                if "rating" in b:
                    sets.append("rating=?"); vals.append(max(0, min(5, int(b["rating"] or 0))))
                if "tasted_notes" in b:
                    sets.append("tasted_notes=?"); vals.append(str(b["tasted_notes"] or "")[:4000])
                if not sets:
                    return self.send_json({"error": "niente da salvare"}, 400)
                with LOCK, conn() as c:
                    c.execute(f"UPDATE recipes SET {', '.join(sets)} WHERE id=?", (*vals, int(m.group(1))))
                    r = c.execute("SELECT id, rating, tasted_notes FROM recipes WHERE id=?", (int(m.group(1)),)).fetchone()
                return self.send_json(dict(r) if r else {"error": "non trovata"}, 200 if r else 404)
            if p == "/api/jars" and method == "GET":
                return self.send_json(jars_payload())
            if p == "/api/jars" and method == "POST":
                d = clean_jar(self.body())
                d.setdefault("start_date", now_local().date().isoformat())
                d["created_at"] = now_local().isoformat(timespec="seconds")
                with LOCK, conn() as c:
                    cur = c.execute(f"INSERT INTO jars ({', '.join(d)}) VALUES ({', '.join('?' * len(d))})", tuple(d.values()))
                    jid = cur.lastrowid
                return self.send_json(self.one_jar(jid), 201)
            m = re.fullmatch(r"/api/jars/(\d+)", p)
            if m and method in ("PUT", "POST"):
                d = clean_jar(self.body(), partial=True)
                if not d:
                    return self.send_json({"error": "niente da salvare"}, 400)
                jid = int(m.group(1))
                with LOCK, conn() as c:
                    c.execute(f"UPDATE jars SET {', '.join(k + '=?' for k in d)} WHERE id=?", (*d.values(), jid))
                j = self.one_jar(jid)
                return self.send_json(j or {"error": "non trovato"}, 200 if j else 404)
            if m and method == "DELETE":
                with LOCK, conn() as c:
                    c.execute("DELETE FROM jar_events WHERE jar_id=?", (int(m.group(1)),))
                    c.execute("DELETE FROM jars WHERE id=?", (int(m.group(1)),))
                return self.send_json({"ok": True})
            m = re.fullmatch(r"/api/jars/(\d+)/events", p)
            if m and method == "POST":
                b, jid = self.body(), int(m.group(1))
                typ = b.get("type")
                if typ not in EV_RANGE:
                    raise ValueError("tipo non valido")
                day = str(b.get("date") or now_local().date().isoformat())
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                    raise ValueError("data non valida")
                v = float(b.get("value"))
                lo, hi = EV_RANGE[typ]
                if not lo <= v <= hi:
                    raise ValueError("valore fuori scala")
                v2 = b.get("value2")
                v2 = float(v2) if v2 not in (None, "") else None
                with LOCK, conn() as c:
                    if not c.execute("SELECT 1 FROM jars WHERE id=?", (jid,)).fetchone():
                        return self.send_json({"error": "vaso non trovato"}, 404)
                    c.execute("INSERT INTO jar_events (jar_id, date, type, value, value2, note, created_at) VALUES (?,?,?,?,?,?,?)",
                              (jid, day, typ, v, v2, str(b.get("note") or "")[:300], now_local().isoformat(timespec="seconds")))
                return self.send_json(self.one_jar(jid), 201)
            m = re.fullmatch(r"/api/events/(\d+)", p)
            if m and method == "DELETE":
                with LOCK, conn() as c:
                    r = c.execute("SELECT jar_id FROM jar_events WHERE id=?", (int(m.group(1)),)).fetchone()
                    c.execute("DELETE FROM jar_events WHERE id=?", (int(m.group(1)),))
                return self.send_json(self.one_jar(r["jar_id"]) if r else {"ok": True})
        except (ValueError, TypeError) as e:
            return self.send_json({"error": str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            print("[fermentati] errore:", repr(e), flush=True)
            return self.send_json({"error": "errore interno"}, 500)
        if p.startswith("/api/"):
            return self.send_json({"error": "non trovato"}, 404)
        return None if method == "GET" else self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.route("GET")
        return super().do_GET()

    def do_POST(self):
        return self.route("POST")

    def do_PUT(self):
        return self.route("PUT")

    def do_DELETE(self):
        return self.route("DELETE")


if __name__ == "__main__":
    init_db()
    threading.Thread(target=weather_loop, daemon=True).start()
    print(f"[fermentati] in ascolto su :{PORT}  db={DB}  tz={'Europe/Rome' if TZ else 'sistema'}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
