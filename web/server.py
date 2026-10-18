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
import math
import os
import random
import re
import shutil
import sqlite3
import threading
import time
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

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
    "starter_g": float, "scoby_g": float, "continuous": int, "base_mode": str,
}
NEW_COLS = {
    "kind": "TEXT DEFAULT 'verdure'", "temp_mode": "TEXT DEFAULT 'auto'", "tea_g": "REAL DEFAULT 0",
    "sugar_g": "REAL DEFAULT 0", "starter_g": "REAL DEFAULT 0", "scoby_g": "REAL DEFAULT 0",
    "continuous": "INTEGER DEFAULT 0", "base_mode": "TEXT DEFAULT 'auto'",
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
        have_r = {r[1] for r in c.execute("PRAGMA table_info(recipes)")}
        for col, decl in (("want", "INTEGER DEFAULT 0"), ("kind", "TEXT DEFAULT ''"), ("shelf_days", "REAL DEFAULT 0")):
            if col not in have_r:
                c.execute(f"ALTER TABLE recipes ADD COLUMN {col} {decl}")
        c.execute("""CREATE TABLE IF NOT EXISTS crisp_obs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, jar_id INTEGER, veg TEXT NOT NULL,
            warm_days REAL, fridge_days REAL NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS jar_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, jar_id INTEGER NOT NULL, date TEXT NOT NULL,
            type TEXT NOT NULL, value REAL, value2 REAL, note TEXT DEFAULT '', created_at TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS weather_days (
            date TEXT PRIMARY KEY, tmean REAL NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, temp REAL, hum REAL,
            source TEXT NOT NULL, created_at TEXT NOT NULL)""")
        c.execute("CREATE INDEX IF NOT EXISTS readings_ts ON readings(ts)")
        c.execute("""CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)""")
        c.execute("""CREATE TABLE IF NOT EXISTS base_overrides (
            key TEXT PRIMARY KEY, days REAL NOT NULL, updated_at TEXT NOT NULL)""")
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


# ------------------------------------------------------------------ sensore (es. Raspberry Pi + DS18B20)
# GET/POST /api/temp?t=21.4[&h=55][&ts=2026-10-17T13:00:00][&src=nome]
# POST JSON: {"t":21.4,"h":55,"ts":"..."}  oppure batch {"readings":[{...},{...}]} oppure [{...},{...}]
T_KEYS = ("t", "temp", "temperature", "tC", "tc", "temp_c")
H_KEYS = ("h", "hum", "humidity", "rh")
TS_KEYS = ("ts", "time", "timestamp", "date")
MERGE_SECONDS = 20          # due invii ravvicinati senza orario si uniscono (anti-spam)
MAX_BATCH = 5000


def get_setting(c, key, default=""):
    r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r[0] if r else default


def set_setting(c, key, value):
    c.execute("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def sensor_token(c):
    return (os.environ.get("SENSOR_TOKEN") or get_setting(c, "sensor_token", "")).strip()


def use_sim(c):
    return get_setting(c, "use_simulated", "0") == "1"


def _num(v):
    try:
        x = float(str(v).strip().replace(",", "."))
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _ts(v):
    """Orario della lettura: ISO locale (con o senza fuso) oppure secondi Unix. None = adesso."""
    if v in (None, ""):
        return None
    now = now_local().replace(tzinfo=None)
    x = _num(v)
    if x is not None and x > 1e9:
        d = datetime.datetime.fromtimestamp(x, TZ).replace(tzinfo=None) if TZ else datetime.datetime.fromtimestamp(x)
    else:
        try:
            d = datetime.datetime.fromisoformat(str(v).strip().replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("orario non valido (usa ISO 2026-10-17T13:00:00 o secondi Unix)")
        if d.tzinfo is not None:
            d = d.astimezone(TZ).replace(tzinfo=None) if TZ else d.replace(tzinfo=None)
    if d > now + datetime.timedelta(minutes=10):
        raise ValueError("orario nel futuro")
    if d < now - datetime.timedelta(days=60):
        raise ValueError("lettura piu' vecchia di 60 giorni")
    return d.replace(microsecond=0).isoformat(timespec="seconds")


def clean_src(v, default="sensore"):
    v = re.sub(r"[^a-z0-9_-]", "", str(v or "").lower())[:30]
    return v or default


def extract_reading(flat):
    t = next((_num(flat[k]) for k in T_KEYS if k in flat and _num(flat[k]) is not None), None)
    h = next((_num(flat[k]) for k in H_KEYS if k in flat and _num(flat[k]) is not None), None)
    ts = _ts(next((flat[k] for k in TS_KEYS if flat.get(k) not in (None, "")), None))
    src = clean_src(flat.get("src") or flat.get("source") or flat.get("sensor"))
    return t, h, ts, src


def save_reading(c, t, h, src, ts=None, merge=True):
    if t is not None and not -10 <= t <= 50:
        raise ValueError("temperatura fuori scala (-10..50 C)")
    if h is not None and not 0 <= h <= 100:
        raise ValueError("umidita' fuori scala (0..100 %)")
    if t is None and h is None:
        raise ValueError("serve tC/t/temp oppure rh/h/hum")
    now = now_local().replace(tzinfo=None)
    given = ts is not None
    ts = ts or now.isoformat(timespec="seconds")
    if given:
        dup = c.execute("SELECT id FROM readings WHERE source=? AND ts=?", (src, ts)).fetchone()
        if dup:
            return dup["id"], "gia' presente"
    last = None if (given or not merge) else c.execute("SELECT id, ts FROM readings WHERE source=? ORDER BY ts DESC, id DESC LIMIT 1", (src,)).fetchone()
    if last and ts >= last["ts"] and (datetime.datetime.fromisoformat(ts) - datetime.datetime.fromisoformat(last["ts"])).total_seconds() < MERGE_SECONDS:
        sets, vals = [], []
        if t is not None:
            sets.append("temp=?"); vals.append(round(t, 2))
        if h is not None:
            sets.append("hum=?"); vals.append(round(h, 1))
        c.execute(f"UPDATE readings SET {', '.join(sets)}, ts=? WHERE id=?", (*vals, ts, last["id"]))
        return last["id"], "unita alla lettura precedente"
    cur = c.execute("INSERT INTO readings (ts, temp, hum, source, created_at) VALUES (?,?,?,?,?)",
                    (ts, round(t, 2) if t is not None else None, round(h, 1) if h is not None else None, src,
                     now.isoformat(timespec="seconds")))
    return cur.lastrowid, "salvata"


def hourly(c, since_iso, include_sim):
    flt = "" if include_sim else " AND source != 'simulato'"
    q = f"""SELECT substr(ts,1,13) h, avg(temp) t, avg(hum) rh, max(source='simulato') sim, min(source='simulato') allsim, count(*) n
            FROM readings WHERE ts >= ?{flt} GROUP BY h ORDER BY h"""
    return [dict(r) for r in c.execute(q, (since_iso,))]


def sensor_days(c):
    """Media giornaliera = media delle medie orarie (campionamento irregolare non pesa)."""
    days, sim = {}, {}
    for r in hourly(c, "0000", use_sim(c)):
        if r["t"] is None:
            continue
        d = r["h"][:10]
        days.setdefault(d, []).append(r["t"])
        sim[d] = sim.get(d, True) and bool(r["allsim"])
    out = {d: (sum(v) / len(v), "sensore-sim" if sim[d] else "sensore") for d, v in days.items()}
    prev = None
    now = now_local().replace(tzinfo=None)
    rec = hourly(c, (now - datetime.timedelta(hours=24)).isoformat(timespec="seconds"), use_sim(c))
    rec = [r for r in rec if r["t"] is not None]
    if rec and rec[-1]["h"] >= (now - datetime.timedelta(hours=6)).isoformat()[:13]:
        prev = sum(r["t"] for r in rec) / len(rec)
    return out, prev


def simulate_history(c, days=7):
    """Storico realistico: 18-23 C con ciclo giorno/notte, umidita' inversa, ogni 30 minuti."""
    now = now_local().replace(tzinfo=None, second=0, microsecond=0)
    rnd = random.Random(int(now.timestamp()) // 3600)
    t0 = now - datetime.timedelta(days=days)
    drift, n, ts = 0.0, 0, t0
    c.execute("DELETE FROM readings WHERE source='simulato' AND ts >= ?", (t0.isoformat(timespec="seconds"),))
    while ts <= now:
        if ts.hour == 0 and ts.minute == 0:
            drift = max(-0.8, min(0.8, drift + rnd.uniform(-0.4, 0.4)))
        hour = ts.hour + ts.minute / 60
        temp = 20.5 + drift + 2.3 * math.sin(2 * math.pi * (hour - 10) / 24) + rnd.gauss(0, 0.15)
        hum = 58 - (temp - 20.5) * 3 + rnd.gauss(0, 1.2)
        c.execute("INSERT INTO readings (ts, temp, hum, source, created_at) VALUES (?,?,?,?,?)",
                  (ts.isoformat(timespec="seconds"), round(min(23.4, max(17.6, temp)), 2), round(max(30, min(85, hum)), 1),
                   "simulato", now.isoformat(timespec="seconds")))
        n += 1
        ts += datetime.timedelta(minutes=30)
    return n


def sensor_status(c):
    last = c.execute("SELECT * FROM readings ORDER BY ts DESC, id DESC LIMIT 1").fetchone()
    last_real = c.execute("SELECT * FROM readings WHERE source!='simulato' ORDER BY ts DESC, id DESC LIMIT 1").fetchone()
    now = now_local().replace(tzinfo=None)
    age = lambda r: round((now - datetime.datetime.fromisoformat(r["ts"])).total_seconds() / 60) if r else None
    counts = {r["source"]: r["n"] for r in c.execute("SELECT source, count(*) n FROM readings GROUP BY source")}
    return {"last": dict(last) if last else None, "last_min": age(last),
            "last_real": dict(last_real) if last_real else None, "last_real_min": age(last_real),
            "counts": counts, "use_simulated": use_sim(c), "token_set": bool(sensor_token(c)),
            "lan_ip": os.environ.get("LAN_IP", ""), "port": PORT}


# ------------------------------------------------------------------ tempo base
KOMBU_BASE = float(KOMBUCHA["f1"]["base_days_20"])
GENERIC_BASE = 7.0


def recipe_base_default(r):
    q = float(r["q10"] or 2.2)
    return round(float(r["min_time_days"]) / q ** ((20.0 - float(r["target_temp_c"])) / 10.0), 2)


def overrides(c):
    return {r["key"]: r["days"] for r in c.execute("SELECT key, days FROM base_overrides")}


def jar_base(j, recs, ov):
    if (j.get("kind") or "verdure") == "kombucha":
        default, src = ov.get("kombucha", KOMBU_BASE), "kombucha"
        custom_src = "kombucha" in ov
    elif j.get("recipe_id") and j["recipe_id"] in recs:
        key = f"recipe:{j['recipe_id']}"
        default, src = ov.get(key, recipe_base_default(recs[j["recipe_id"]])), "ricetta"
        custom_src = key in ov
    else:
        default, src, custom_src = GENERIC_BASE, "vaso", False
    mode = j.get("base_mode") or "auto"
    eff = float(j["base_days"]) if mode == "tuo" and j.get("base_days") else float(default)
    return {"eff": round(eff, 2), "default": round(float(default), 2), "mode": mode, "src": src, "src_custom": custom_src}


# ------------------------------------------------------------------ prontezza
def d_(s):
    return datetime.date.fromisoformat(str(s)[:10])


def readiness(j, events, wx, today, hour_frac, sens=None, sens_prev=None):
    sens = sens or {}
    kombu = (j.get("kind") or "verdure") == "kombucha"
    q = float(j.get("q10") or 2.2)
    base = float(j.get("_base") or j.get("base_days") or (12 if kombu else 7))
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
        if mode != "fissa":
            sv = sens.get(day.isoformat())
            if sv and day <= today:
                return sv[0], sv[1]
            if day > today and sens_prev is not None:
                return sens_prev, "sensore-prev"
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
        recs = {r["id"]: dict(r) for r in c.execute("SELECT id, min_time_days, target_temp_c, q10 FROM recipes")}
        ov = overrides(c)
        sens, sens_prev = sensor_days(c)
    for j in jars:
        j["events"] = evs.get(j["id"], [])
        j["base_info"] = jar_base(j, recs, ov)
        j["_base"] = j["base_info"]["eff"]
        try:
            j["ready"] = readiness(j, j["events"], wx, today, hour_frac, sens, sens_prev)
        except Exception as e:  # noqa: BLE001
            print("[fermentati] prontezza errore:", j.get("id"), repr(e), flush=True)
            j["ready"] = None
        j.pop("_base", None)
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
        ov = overrides(c)
        for r in c.execute("SELECT * FROM recipes ORDER BY id"):
            d = dict(r)
            d["items"] = items.get(d["id"], [])
            d["base_default"] = recipe_base_default(d)
            key = f"recipe:{d['id']}"
            d["base_custom"] = key in ov
            d["base_eff"] = round(float(ov.get(key, d["base_default"])), 2)
            months = set()
            for it in d["items"]:
                if it["type"] == "vegetable" and it["name"] in vmap:
                    months |= season_months(vmap[it["name"]]["seasons"])
            d["months"] = sorted(months)
            recipes.append(d)
        drinks = {r["slug"]: json.loads(r["data"]) for r in c.execute("SELECT slug, data FROM drinks")}
        if "kombucha" in drinks:
            drinks["kombucha"]["base_default"] = KOMBU_BASE
            drinks["kombucha"]["base_custom"] = "kombucha" in ov
            drinks["kombucha"]["base_eff"] = float(ov.get("kombucha", KOMBU_BASE))
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
    if "base_mode" in out and out["base_mode"] not in ("auto", "tuo"):
        raise ValueError("modo tempo base non valido")
    if "base_days" in out and out["base_days"] is not None and not 1 <= out["base_days"] <= 120:
        raise ValueError("tempo base fuori scala (1-120 giorni)")
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
            if p == "/api/temp" and method in ("GET", "POST"):
                qs = {k: v[0] for k, v in (parse_qs(self.path.split("?", 1)[1]).items() if "?" in self.path else [])}
                body = None
                if method == "POST":
                    n = int(self.headers.get("Content-Length") or 0)
                    if n > 2_000_000:
                        raise ValueError("invio troppo grande")
                    raw = self.rfile.read(n) if n else b""
                    if raw and "json" in self.headers.get("Content-Type", ""):
                        body = json.loads(raw)
                    elif raw:
                        body = {k: v[0] for k, v in parse_qs(raw.decode("utf-8", "replace")).items()}
                batch = body if isinstance(body, list) else (body.get("readings") if isinstance(body, dict) and isinstance(body.get("readings"), list) else None)
                common = dict(qs)
                if isinstance(body, dict):
                    common.update({k: v for k, v in body.items() if not isinstance(v, (dict, list))})
                with LOCK, conn() as c:
                    tok = sensor_token(c)
                    if tok and str(common.get("token") or self.headers.get("X-Token") or "") != tok:
                        return self.send_json({"error": "token mancante o sbagliato"}, 403)
                    if batch is not None:
                        if len(batch) > MAX_BATCH:
                            raise ValueError(f"massimo {MAX_BATCH} letture per invio")
                        ok, skip, errs = 0, 0, []
                        for i, item in enumerate(batch):
                            try:
                                if not isinstance(item, dict):
                                    raise ValueError("ogni lettura deve essere un oggetto")
                                t, h, ts, src = extract_reading({**common, **item})
                                _, what = save_reading(c, t, h, src, ts, merge=False)
                                ok += what == "salvata"; skip += what != "salvata"
                            except ValueError as e:
                                errs.append(f"#{i}: {e}")
                        print(f"[fermentati] batch letture: {ok} salvate, {skip} gia' presenti, {len(errs)} scartate", flush=True)
                        return self.send_json({"ok": True, "salvate": ok, "gia_presenti": skip, "scartate": len(errs), "errori": errs[:20]})
                    t, h, ts, src = extract_reading(common)
                    rid, what = save_reading(c, t, h, src, ts)
                    r = c.execute("SELECT * FROM readings WHERE id=?", (rid,)).fetchone()
                print(f"[fermentati] lettura {src}: t={t} h={h} ({what})", flush=True)
                return self.send_json({"ok": True, "esito": what, "lettura": dict(r)})
            if p == "/api/sensor" and method == "GET":
                with conn() as c:
                    st = sensor_status(c)
                    now = now_local().replace(tzinfo=None)
                    st["h24"] = hourly(c, (now - datetime.timedelta(hours=24)).isoformat(timespec="seconds"), True)
                    st["d7"] = hourly(c, (now - datetime.timedelta(days=7)).isoformat(timespec="seconds"), True)
                return self.send_json(st)
            if p == "/api/sensor/series" and method == "GET":
                qs = parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
                since = (qs.get("from") or ["0000"])[0][:19]
                with conn() as c:
                    return self.send_json(hourly(c, since, use_sim(c)))
            if p == "/api/sensor/settings" and method == "POST":
                b = self.body()
                with LOCK, conn() as c:
                    if "use_simulated" in b:
                        set_setting(c, "use_simulated", "1" if b["use_simulated"] else "0")
                    if "token" in b:
                        set_setting(c, "sensor_token", re.sub(r"[^A-Za-z0-9_-]", "", str(b["token"] or ""))[:40])
                    return self.send_json(sensor_status(c))
            if p == "/api/sensor/simulate" and method == "POST":
                b = self.body()
                with LOCK, conn() as c:
                    n = simulate_history(c, max(1, min(30, int(b.get("days") or 7))))
                return self.send_json({"ok": True, "letture": n})
            if p == "/api/sensor/simulated" and method == "DELETE":
                with LOCK, conn() as c:
                    n = c.execute("DELETE FROM readings WHERE source='simulato'").rowcount
                return self.send_json({"ok": True, "cancellate": n})
            if p == "/api/base" and method == "POST":
                b = self.body()
                key = str(b.get("key") or "")
                if not re.fullmatch(r"recipe:\d+|kombucha", key):
                    raise ValueError("chiave non valida")
                days = b.get("days")
                with LOCK, conn() as c:
                    if days in (None, ""):
                        c.execute("DELETE FROM base_overrides WHERE key=?", (key,))
                    else:
                        days = float(days)
                        if not 1 <= days <= 120:
                            raise ValueError("tempo base fuori scala (1-120 giorni)")
                        c.execute("""INSERT INTO base_overrides (key, days, updated_at) VALUES (?,?,?)
                                     ON CONFLICT(key) DO UPDATE SET days=excluded.days, updated_at=excluded.updated_at""",
                                  (key, round(days, 2), now_local().isoformat(timespec="seconds")))
                    cur = overrides(c).get(key)
                return self.send_json({"ok": True, "key": key, "days": cur})
            if p == "/api/recipes" and method == "POST":
                b = self.body()
                name = str(b.get("name") or "").strip()[:160]
                meth = b.get("method")
                if not name or meth not in ("secco", "salamoia"):
                    raise ValueError("nome o metodo mancante")
                items = [i for i in (b.get("items") or []) if i.get("type") in ("vegetable", "spice") and str(i.get("name") or "").strip()]
                if not any(i["type"] == "vegetable" for i in items):
                    raise ValueError("serve almeno una verdura")
                tot = float(b.get("total_weight_g") or 0)
                if not 1 <= tot <= 100000:
                    raise ValueError("peso non valido")
                vals = (name, meth, tot, float(b["brine_pct"]) if b.get("brine_pct") else None, None, None,
                        0.7 if meth == "salamoia" else None, float(b.get("target_temp_c") or 20),
                        max(0.1, float(b.get("min_time_days") or 7)), max(0.0, float(b.get("salt_g") or 0)),
                        max(0.0, float(b.get("water_ml") or 0)), 2.2, str(b.get("notes") or "")[:4000], 0, "",
                        now_local().isoformat(timespec="seconds"), 1 if b.get("want") else 0,
                        b.get("kind") if b.get("kind") in ("scorta", "bevanda", "salsa", "jiang", "latticini", "cereali", "alcolici") else "", max(0.0, float(b.get("shelf_days") or 0)))
                with LOCK, conn() as c:
                    cur = c.execute("""INSERT INTO recipes (name, method, total_weight_g, brine_pct, jar_volume_ml, headspace_ml,
                        packing_fraction, target_temp_c, min_time_days, salt_g, water_ml, q10, notes, rating, tasted_notes, created_at,
                        want, kind, shelf_days)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", vals)
                    rid = cur.lastrowid
                    for i in items[:40]:
                        c.execute("INSERT INTO recipe_items (recipe_id, item_type, name, weight_g) VALUES (?,?,?,?)",
                                  (rid, i["type"], str(i["name"])[:80], max(0.0, float(i.get("g") or 0))))
                return self.send_json({"ok": True, "id": rid}, 201)
            m = re.fullmatch(r"/api/recipes/(\d+)", p)
            if m and method == "POST":
                b = self.body()
                sets, vals = [], []
                if "rating" in b:
                    sets.append("rating=?"); vals.append(max(0, min(5, int(b["rating"] or 0))))
                if "want" in b:
                    sets.append("want=?"); vals.append(1 if b["want"] else 0)
                if "tasted_notes" in b:
                    sets.append("tasted_notes=?"); vals.append(str(b["tasted_notes"] or "")[:4000])
                if not sets:
                    return self.send_json({"error": "niente da salvare"}, 400)
                with LOCK, conn() as c:
                    c.execute(f"UPDATE recipes SET {', '.join(sets)} WHERE id=?", (*vals, int(m.group(1))))
                    r = c.execute("SELECT id, rating, tasted_notes, want FROM recipes WHERE id=?", (int(m.group(1)),)).fetchone()
                return self.send_json(dict(r) if r else {"error": "non trovata"}, 200 if r else 404)
            if p == "/api/crisp" and method == "GET":
                with conn() as c:
                    return self.send_json([dict(r) for r in c.execute("SELECT * FROM crisp_obs ORDER BY id DESC LIMIT 500")])
            if p == "/api/crisp" and method == "POST":
                b = self.body()
                veg = str(b.get("veg") or "").strip()[:60]
                fr = float(b.get("fridge_days"))
                wd = float(b["warm_days"]) if b.get("warm_days") not in (None, "") else None
                if not veg or not 0 <= fr <= 365:
                    raise ValueError("giorni non validi")
                with LOCK, conn() as c:
                    cur = c.execute("INSERT INTO crisp_obs (jar_id, veg, warm_days, fridge_days, note, created_at) VALUES (?,?,?,?,?,?)",
                                    (b.get("jar_id"), veg, wd, fr, str(b.get("note") or "")[:300], now_local().isoformat(timespec="seconds")))
                return self.send_json({"ok": True, "id": cur.lastrowid}, 201)
            m = re.fullmatch(r"/api/crisp/(\d+)", p)
            if m and method == "DELETE":
                with LOCK, conn() as c:
                    c.execute("DELETE FROM crisp_obs WHERE id=?", (int(m.group(1)),))
                return self.send_json({"ok": True})
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
