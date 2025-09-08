#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FermentaPro - Calcolatore grafico per fermentati casalinghi
Autore: ChatGPT
Versione Corretta: 1.3.1 (con bugfix critici)
Dipendenze: solo Python standard (tkinter, sqlite3). Nessuna libreria esterna richiesta.
Esecuzione: python FermentaPro_fixed.py
Database: crea automaticamente "fermentapro.db" nella stessa cartella.
"""

import os
import sys
import sqlite3
import datetime
from typing import List, Tuple, Optional

try:
    import tkinter as tk
    from tkinter import ttk, messagebox, filedialog
except Exception as e:
    print("Errore nell'importare tkinter:", e)
    sys.exit(1)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fermentapro.db")

APP_TITLE = "FermentaPro — Calcolatore di fermentati"
APP_VERSION = "1.3.1"

# -------------------------- Utility scientifiche --------------------------

Q10_DEFAULT = 2.2  # fattore Q10 approssimato per processi fermentativi

def adjusted_time_days(base_days_at_20c: float, temp_c: float, q10: float = Q10_DEFAULT) -> float:
    """
    Applica la regola di Van't Hoff (Q10) per stimare il tempo minimo.
    Tempo(T) = Tempo(20°C) * Q10^((20 - T)/10)
    """
    try:
        delta = (20.0 - float(temp_c)) / 10.0
        return max(0.1, float(base_days_at_20c) * (q10 ** delta))
    except Exception:
        return float(base_days_at_20c)

def estimate_brine_water_ml(
    total_veg_weight_g: float,
    jar_volume_ml: Optional[float] = None,
    headspace_ml: float = 0.0,
    packing_fraction: float = 0.7,
) -> float:
    """
    Stima il volume d'acqua per salamoia.
    - Se jar_volume_ml è fornito, assume che le verdure occupino 'packing_fraction' del volume del vaso.
      Acqua ≈ vaso*(1 - packing_fraction) - headspace.
    - Altrimenti, usa una stima empirica basata sul peso: acqua ≈ peso * (1/packing_fraction - 1)
      (densità vegetali ~ acqua).
    """
    pf = max(0.5, min(0.9, float(packing_fraction)))
    if jar_volume_ml and jar_volume_ml > 0:
        water = max(0.0, (jar_volume_ml * (1.0 - pf)) - max(0.0, headspace_ml))
    else:
        water = max(0.0, float(total_veg_weight_g) * ((1.0 / pf) - 1.0))
    return water

def salt_for_brine_g(water_ml: float, brine_pct: float) -> float:
    """ Sale per salamoia: % (m/m) sul peso (≈ volume) dell'acqua. """
    return max(0.0, float(water_ml) * float(brine_pct) / 100.0)

def salt_for_dry_g(total_veg_weight_g: float, dry_pct: float) -> float:
    """ Sale a secco: % (m/m) sul peso totale delle verdure. """
    return max(0.0, float(total_veg_weight_g) * float(dry_pct) / 100.0)

# -------------------------- DB --------------------------

INIT_VEGETABLES = [
    ("Cavolo cappuccio", "Autunno, Inverno", 2.0, 7.0, "Julienne/sottile", "Ottimo per crauti; tempi base 7–14 gg."),
    ("Cavolo verza", "Autunno, Inverno", 2.0, 8.0, "Julienne/sottile", "Foglie più spesse; tempi leggermente maggiori."),
    ("Cavolfiore", "Autunno, Inverno", 2.5, 8.0, "Cimette", "Adatto in salamoia 2.5–3.5%."),
    ("Carota", "Tutto l'anno", 2.5, 6.0, "Rondelle/bastoncini", "A rondelle o bastoncini; croccante."),
    ("Cetriolo", "Estate", 3.0, 5.0, "Interi/rondelle spesse", "Cornichon in salamoia 3–5%; usa foglie di vite per croccantezza."),
    ("Zucchina", "Estate", 2.5, 5.0, "Bastoncini/rondelle", "Meglio salamoia leggera 2–3%."),
    ("Peperone", "Estate, Autunno", 2.5, 7.0, "Listarelle", "A listarelle; salamoia 2.5–3%."),
    ("Barbabietola", "Autunno, Inverno", 2.5, 8.0, "Cubetti/bastoncini", "Ottima per kvass/fermentazioni rosse."),
    ("Ravanello", "Primavera, Autunno", 2.5, 5.0, "Metà/interi", "Sapori pungenti, rapida fermentazione."),
    ("Cipolla", "Tutto l'anno", 2.5, 6.0, "Anelli/fettine", "Da usare mista per non coprire gli altri aromi."),
    ("Aglio", "Tutto l'anno", 2.5, 10.0, "Spicchi interi", "Spicchi interi richiedono tempi più lunghi."),
    ("Fagiolino", "Estate", 3.0, 7.0, "Interi", "Preferibile salamoia 3%."),
    ("Melanzana", "Estate", 2.5, 7.0, "Cubetti", "Spurgare prima; in salamoia 2.5–3%."),
    ("Finocchio", "Autunno, Inverno", 2.5, 6.0, "Spicchi/fettine", "Ottimo con agrumi e pepe."),
    ("Porro", "Autunno, Inverno", 2.5, 8.0, "Rondelle", "A rondelle; sapore deciso."),
    ("Broccolo", "Autunno, Inverno", 2.5, 7.0, "Cimette", "In salamoia con spezie."),
    ("Pomodoro verde", "Estate, Autunno", 3.0, 7.0, "Spicchi", "Ottimo in salamoia con aneto."),
    ("Asparago", "Primavera", 3.0, 6.0, "Gambi interi", "Gambi; breve fermentazione."),
    ("Sedano", "Tutto l'anno", 2.5, 6.0, "Pezzetti", "In salamoia leggera."),
    ("Cavolo rapa", "Autunno, Inverno", 2.0, 7.0, "Bastoncini", "Buono a secco (kimchi-style)."),
    ("Daikon", "Inverno", 2.5, 6.0, "Bastoncini/rondelle", "Takuan style, attenzione agli odori."),
    ("Pak choi", "Tutto l'anno", 2.5, 6.0, "Foglie intere/tagliate", "Foglie delicate."),
]

INIT_SPICES = [
    "Pepe nero", "Pepe rosa", "Coriandolo", "Cumino", "Aneto", "Alloro", "Ginepro",
    "Peperoncino", "Zenzero", "Curcuma", "Semi di senape", "Aglio secco", "Peperoncino affumicato",
    "Origano (secco)"
]

def get_conn():
    return sqlite3.connect(DB_PATH)

def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS vegetables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        seasons TEXT,
        default_dry_pct REAL,
        base_days_20c REAL,
        notes TEXT,
        cut_style TEXT
    )
    """)
    # **BUGFIX CRITICO**: Aggiunge la colonna `cut_style` se non esiste in un DB pre-esistente.
    try:
        c.execute("ALTER TABLE vegetables ADD COLUMN cut_style TEXT")
    except sqlite3.OperationalError:
        pass  # La colonna esiste già

    c.execute("""
    CREATE TABLE IF NOT EXISTS spices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        method TEXT CHECK(method IN ('salamoia','secco')) NOT NULL,
        total_weight_g REAL NOT NULL,
        brine_pct REAL,
        jar_volume_ml REAL,
        headspace_ml REAL,
        packing_fraction REAL,
        target_temp_c REAL NOT NULL,
        min_time_days REAL NOT NULL,
        salt_g REAL NOT NULL,
        water_ml REAL NOT NULL,
        q10 REAL NOT NULL,
        notes TEXT,
        rating INTEGER DEFAULT 0,
        tasted_notes TEXT,
        created_at TEXT NOT NULL
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS recipe_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        item_type TEXT CHECK(item_type IN ('vegetable','spice')) NOT NULL,
        name TEXT NOT NULL,
        weight_g REAL DEFAULT 0,
        FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    )
    """)
    # preload vegetables
    for v in INIT_VEGETABLES:
        try:
            c.execute("INSERT OR IGNORE INTO vegetables(name, seasons, default_dry_pct, base_days_20c, cut_style, notes) VALUES (?,?,?,?,?,?)", v)
        except Exception:
            pass
    # preload spices
    for s in INIT_SPICES:
        try:
            c.execute("INSERT OR IGNORE INTO spices(name) VALUES (?)", (s,))
        except Exception:
            pass

    conn.commit()
    conn.close()

# -------------------------- Star Rating Widget --------------------------

class StarRating(ttk.Frame):
    def __init__(self, master, max_stars=5, initial=0, callback=None, **kwargs):
        super().__init__(master, **kwargs)
        self.max_stars = max_stars
        self.value = tk.IntVar(value=initial)
        self.callback = callback
        self.stars = []
        for i in range(1, max_stars+1):
            lbl = ttk.Label(self, text="☆", font=("Segoe UI", 18))
            lbl.grid(row=0, column=i-1, padx=2)
            lbl.bind("<Button-1>", lambda e, v=i: self.set_value(v))
            lbl.bind("<Enter>", lambda e, v=i: self._hover(v))
            lbl.bind("<Leave>", lambda e: self._hover(self.value.get()))
            self.stars.append(lbl)
        self._hover(initial)

    def _hover(self, v):
        for i, lbl in enumerate(self.stars, start=1):
            lbl.config(text="★" if i <= v else "☆")

    def set_value(self, v):
        self.value.set(v)
        self._hover(v)
        if self.callback:
            self.callback(v)

    def get(self):
        return self.value.get()

# -------------------------- UI --------------------------

class FermentaProApp(tk.Tk):
    def __init__(self):
        super().__init__()
        # Theme: lively greens/teals
        self.title(APP_TITLE)
        self.geometry("1200x780")
        self.minsize(1050, 660)
        self.style = ttk.Style(self)
        try:
            self.style.theme_use("clam")
        except Exception:
            pass
        # light, fresh palette
        self.configure(bg="#f2fbf4")
        self.style.configure("TLabel", background="#f2fbf4", foreground="#0b3d2e", font=("Segoe UI", 10))
        self.style.configure("TFrame", background="#f2fbf4")
        self.style.configure("TNotebook", background="#f2fbf4")
        self.style.configure("TNotebook.Tab", padding=10)
        self.style.configure("TButton", font=("Segoe UI", 10, "bold"))
        self.style.configure("Card.TFrame", background="#dff7e3")
        self.style.configure("CardTitle.TLabel", font=("Segoe UI", 12, "bold"), foreground="#064e3b", background="#dff7e3")
        self.style.configure("Muted.TLabel", foreground="#3e7a66")
        self.style.configure("Accent.TButton", background="#10b981", foreground="#053023")
        self.style.map("TButton", background=[("active", "#34d399")])

        # header
        header = ttk.Frame(self, style="TFrame")
        header.pack(fill="x", padx=16, pady=(12, 8))
        ttk.Label(header, text=f"🧪 {APP_TITLE}", font=("Segoe UI", 16, "bold")).pack(side="left")
        ttk.Label(header, text=f"v{APP_VERSION}", style="Muted.TLabel").pack(side="left", padx=(8,0))

        # notebook
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=16, pady=8)

        self.page_new = ttk.Frame(self.notebook, style="TFrame")
        self.page_book = ttk.Frame(self.notebook, style="TFrame")
        self.page_db = ttk.Frame(self.notebook, style="TFrame")

        self.notebook.add(self.page_new, text="Nuova ricetta")
        self.notebook.add(self.page_book, text="Ricettario")
        self.notebook.add(self.page_db, text="Database")

        # Costruzione pagine
        self.build_new_recipe_ui(self.page_new)
        self.build_book_ui(self.page_book)   # <-- QUESTA RIGA MANCAVA
        self.build_db_ui(self.page_db)

    def edit_selected_veg(self):
        sel = self.veg_tree.selection()
        if not sel:
            from tkinter import messagebox
            messagebox.showinfo("Info", "Seleziona una verdura da modificare.")
            return
        iid = sel[0]
        vals = self.veg_tree.item(iid, "values")
        curr_name = vals[0]; curr_weight = vals[1]

        win = tk.Toplevel(self); win.title("Modifica verdura"); win.transient(self); win.grab_set()
        frm = ttk.Frame(win, padding=12); frm.pack(fill="both", expand=True)

        ttk.Label(frm, text="Verdura").grid(row=0, column=0, sticky="w"); 
        name_entry = ttk.Entry(frm, width=38); name_entry.grid(row=0, column=1, sticky="w", padx=6, pady=4); 
        name_entry.insert(0, curr_name)

        ttk.Label(frm, text="Peso (g)").grid(row=1, column=0, sticky="w"); 
        weight_entry = ttk.Entry(frm, width=10); weight_entry.grid(row=1, column=1, sticky="w", padx=6, pady=4); 
        weight_entry.insert(0, curr_weight)

        def save_edit():
            name = name_entry.get().strip()
            try:
                w = float(weight_entry.get().strip() or 0.0)
            except:
                from tkinter import messagebox
                messagebox.showwarning("Errore", "Peso non valido."); return
            # aggiorna base/stagioni/taglio se il nome cambia
            info = self._veg_info(name)
            base = info[0] if info else float(vals[2]); seasons = info[1] if info else vals[3]; cut = info[2] if info else vals[4]
            self.veg_tree.item(iid, values=(name, f"{w:.0f}", f"{base:.1f}", seasons, cut))
            win.destroy()
            self.calculate()

        btns = ttk.Frame(frm); btns.grid(row=2, column=0, columnspan=2, pady=(8,0), sticky="e")
        ttk.Button(btns, text="Annulla", command=win.destroy).pack(side="right", padx=6)
        ttk.Button(btns, text="Salva", command=save_edit).pack(side="right")
        win.bind("<Return>", lambda e: save_edit())

    # ---------------- New Recipe UI ----------------
    def build_new_recipe_ui(self, root):
        top = ttk.Frame(root, style="TFrame")
        top.pack(fill="x", pady=(8,4))

        self.entry_recipe_name = ttk.Entry(top, width=40)
        ttk.Label(top, text="Nome ricetta").pack(side="left", padx=(0,6))
        self.entry_recipe_name.pack(side="left", padx=(0,16))

        self.method = tk.StringVar(value="salamoia")
        ttk.Label(top, text="Metodo").pack(side="left")
        ttk.Radiobutton(top, text="Sotto salamoia", variable=self.method, value="salamoia", command=self._update_method_state).pack(side="left", padx=4)
        ttk.Radiobutton(top, text="A secco", variable=self.method, value="secco", command=self._update_method_state).pack(side="left", padx=4)

        main = ttk.Frame(root, style="TFrame")
        main.pack(fill="both", expand=True)

        left = ttk.Frame(main, style="Card.TFrame", padding=12)
        left.pack(side="left", fill="both", expand=True, padx=(0,8), pady=8)

        ttk.Label(left, text="Verdure nella ricetta", style="CardTitle.TLabel").pack(anchor="w")
        self.veg_tree = ttk.Treeview(left, columns=("nome","peso","base","stagioni","taglio"), show="headings", height=8)
        self.veg_tree.heading("nome", text="Verdura")
        self.veg_tree.heading("peso", text="Peso (g)")
        self.veg_tree.heading("base", text="Tempo base @20°C (gg)")
        self.veg_tree.heading("stagioni", text="Stagioni")
        self.veg_tree.heading("taglio", text="Taglio (macrobiotico)")
        self.veg_tree.pack(fill="x", pady=6)

        add_row = ttk.Frame(left, style="TFrame")
        add_row.pack(fill="x", pady=(4,10))
        self.combo_veg = ttk.Combobox(add_row, width=40, values=self._list_veg_names())
        self.combo_veg.pack(side="left", padx=(0,6))
        self.entry_veg_weight = ttk.Entry(add_row, width=10)
        self.entry_veg_weight.pack(side="left", padx=(0,6))
        self.entry_veg_weight.insert(0, "500")
        ttk.Button(add_row, text="Aggiungi verdura", command=self.add_veg).pack(side="left")

        ttk.Separator(left, orient="horizontal").pack(fill="x", pady=8)

        ttk.Label(left, text="Spezie (facoltative)", style="CardTitle.TLabel").pack(anchor="w")
        self.spice_tree = ttk.Treeview(left, columns=("spezia","peso"), show="headings", height=6)
        self.spice_tree.heading("spezia", text="Spezia")
        self.spice_tree.heading("peso", text="Peso (g)")
        self.spice_tree.pack(fill="x", pady=6)

        add_sp = ttk.Frame(left, style="TFrame")
        add_sp.pack(fill="x", pady=(4,6))
        self.combo_spice = ttk.Combobox(add_sp, width=40, values=self._list_spice_names())
        self.combo_spice.pack(side="left", padx=(0,6))
        self.entry_spice_weight = ttk.Entry(add_sp, width=10)
        self.entry_spice_weight.pack(side="left", padx=(0,6))
        self.entry_spice_weight.insert(0, "5")
        ttk.Button(add_sp, text="Aggiungi spezia", command=self.add_spice).pack(side="left")

        # ✅ nuova opzione
        self.include_spices_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(left, text="Conta spezie nel peso (sale/acqua)", variable=self.include_spices_var, command=self.calculate).pack(anchor="w", pady=(4,0))

        right = ttk.Frame(main, style="Card.TFrame", padding=12)
        right.pack(side="left", fill="both", expand=True, padx=(8,0), pady=8)

        ttk.Label(right, text="Parametri & Calcoli", style="CardTitle.TLabel").pack(anchor="w")
        grid = ttk.Frame(right, style="TFrame")
        grid.pack(fill="x", pady=8)

        ttk.Label(grid, text="Temperatura target (°C)").grid(row=0, column=0, sticky="w", pady=3)
        self.entry_temp = ttk.Entry(grid, width=10)
        self.entry_temp.grid(row=0, column=1, sticky="w", padx=6, pady=3)
        self.entry_temp.insert(0, "20")

        ttk.Label(grid, text="Q10 (default 2.2)").grid(row=0, column=2, sticky="w", pady=3)
        self.entry_q10 = ttk.Entry(grid, width=10)
        self.entry_q10.grid(row=0, column=3, sticky="w", padx=6, pady=3)
        self.entry_q10.insert(0, "2.2")

        ttk.Label(grid, text="Sale a secco % (se metodo secco)").grid(row=1, column=0, sticky="w", pady=3)
        self.entry_dry_pct = ttk.Entry(grid, width=10)
        self.entry_dry_pct.grid(row=1, column=1, sticky="w", padx=6, pady=3)
        self.entry_dry_pct.insert(0, "2.0")

        ttk.Label(grid, text="Salamoia % (m/m)").grid(row=2, column=0, sticky="w", pady=3)
        self.entry_brine_pct = ttk.Entry(grid, width=10)
        self.entry_brine_pct.grid(row=2, column=1, sticky="w", padx=6, pady=3)
        self.entry_brine_pct.insert(0, "2.5")

        ttk.Label(grid, text="Volume vaso (ml) (opz.)").grid(row=3, column=0, sticky="w", pady=3)
        self.entry_jar_vol = ttk.Entry(grid, width=10)
        self.entry_jar_vol.grid(row=3, column=1, sticky="w", padx=6, pady=3)

        ttk.Label(grid, text="Spazio di testa (ml) (opz.)").grid(row=3, column=2, sticky="w", pady=3)
        self.entry_headspace = ttk.Entry(grid, width=10)
        self.entry_headspace.grid(row=3, column=3, sticky="w", padx=6, pady=3)
        self.entry_headspace.insert(0, "0")

        ttk.Label(grid, text="Frazione riempimento verdure (0.5–0.9)").grid(row=4, column=0, sticky="w", pady=3)
        self.entry_packfrac = ttk.Entry(grid, width=10)
        self.entry_packfrac.grid(row=4, column=1, sticky="w", padx=6, pady=3)
        self.entry_packfrac.insert(0, "0.7")

        ttk.Label(right, text="Note ricetta").pack(anchor="w", pady=(8,2))
        self.txt_notes = tk.Text(right, height=5, wrap="word", bg="#ffffff", fg="#083b2d", insertbackground="#083b2d")
        self.txt_notes.pack(fill="x")

        ttk.Separator(right, orient="horizontal").pack(fill="x", pady=8)
        self.lbl_results = ttk.Label(right, text="", font=("Segoe UI", 11, "bold"))
        self.lbl_results.pack(anchor="w")

        btns = ttk.Frame(right, style="TFrame")
        btns.pack(fill="x", pady=(8,4))
        ttk.Button(btns, text="Calcola", command=self.calculate).pack(side="left")
        ttk.Button(btns, text="Salva ricetta", command=self.save_recipe).pack(side="left", padx=8)
        tools = ttk.Frame(right, style="TFrame")
        tools.pack(fill="x", pady=(6,2))
        ttk.Button(tools, text="Calcola volume vaso", command=self.calc_required_jar_volume).pack(side="left")
        # check per scalare anche le spezie
        self.scale_spices_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(tools, text="Scala anche spezie", variable=self.scale_spices_var).pack(side="left", padx=8)
        ttk.Button(tools, text="Adatta alla capienza vaso", command=self.adapt_recipe_to_jar_ui).pack(side="left", padx=6)



        ttk.Separator(right, orient="horizontal").pack(fill="x", pady=8)
        ttk.Label(right, text="Valutazione (post-assaggio)", style="CardTitle.TLabel").pack(anchor="w")
        rate_row = ttk.Frame(right, style="TFrame")
        rate_row.pack(anchor="w", pady=(4,2))
        self.star = StarRating(rate_row, initial=0)
        self.star.pack(side="left")
        self.tasted_notes = tk.Text(right, height=3, wrap="word", bg="#ffffff", fg="#083b2d", insertbackground="#083b2d")
        self.tasted_notes.pack(fill="x", pady=(4,0))

        self._update_method_state()
        self.veg_tree.bind("<Double-1>", lambda e: self.edit_selected_veg())
        self.veg_tree.bind("<Delete>", lambda e: [self.veg_tree.delete(i) for i in self.veg_tree.selection()] or self.calculate())


    def _update_method_state(self):
        meth = self.method.get()
        is_brine = meth == "salamoia"
        state_brine = "normal" if is_brine else "disabled"
        state_dry = "normal" if not is_brine else "disabled"

        for w in (self.entry_brine_pct, self.entry_jar_vol, self.entry_headspace, self.entry_packfrac):
            w.config(state=state_brine)
        self.entry_dry_pct.config(state=state_dry)

    def _list_all_ingredients(self) -> list:
        """Elenco alfabetico di TUTTI gli ingredienti (verdure + spezie) presenti nelle ricette."""
        conn = get_conn(); cur = conn.cursor()
        cur.execute("SELECT DISTINCT name FROM recipe_items")
        names = sorted({row[0] for row in cur.fetchall()}, key=lambda s: s.lower())
        conn.close()
        return names
    
    def _list_veg_names(self) -> List[str]:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT name FROM vegetables ORDER BY name")
        rows = [r[0] for r in cur.fetchall()]
        conn.close()
        return rows

    def _veg_info(self, name: str) -> Optional[Tuple[float, str, str]]:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT base_days_20c, seasons, cut_style FROM vegetables WHERE name=?", (name,))
        row = cur.fetchone()
        conn.close()
        if row:
            return float(row[0] or 7.0), str(row[1] or ""), str(row[2] or "Taglio a piacere")
        return None

    def _list_spice_names(self) -> List[str]:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT name FROM spices ORDER BY name")
        rows = [r[0] for r in cur.fetchall()]
        conn.close()
        return rows

    def add_veg(self):
        name = self.combo_veg.get().strip()
        weight = self.entry_veg_weight.get().strip()
        if not name or not weight:
            messagebox.showwarning("Attenzione", "Inserisci verdura e peso (g).")
            return
        try:
            w = float(weight)
        except (ValueError, TypeError):
            messagebox.showwarning("Errore", "Peso non valido.")
            return

        info = self._veg_info(name)
        if not info:
            messagebox.showwarning("Attenzione", "Verdura non trovata nel database. Aggiungila prima dalla scheda 'Database'.")
            return

        base, seasons, cut = info
        self.veg_tree.insert("", "end", values=(name, f"{w:.0f}", f"{base:.1f}", seasons, cut))

    def add_spice(self):
        name = self.combo_spice.get().strip()
        weight = self.entry_spice_weight.get().strip()
        if not name:
            messagebox.showwarning("Attenzione", "Inserisci una spezia (puoi anche scrivere un nome nuovo).")
            return
        try:
            w = float(weight) if weight else 0.0
        except (ValueError, TypeError):
            messagebox.showwarning("Errore", "Peso spezia non valido.")
            return
        self.spice_tree.insert("", "end", values=(name, f"{w:.0f}"))

    def delete_selected_spice(self):
        sel = self.spice_tree.selection()
        if not sel:
            messagebox.showinfo("Info", "Seleziona una spezia da rimuovere.")
            return
        if messagebox.askyesno("Conferma", "Rimuovere le spezie selezionate?"):
            for iid in sel:
                self.spice_tree.delete(iid)

    def calculate(self):
        """Ricalcola sale/acqua/tempo. Se la spunta è attiva, somma il peso spezie al peso verdure."""
        try:
            # Verdure
            veg_items, total_weight, max_base = [], 0.0, 0.0
            for iid in self.veg_tree.get_children():
                vals = self.veg_tree.item(iid, "values")
                name, w_str, base_str = vals[0], vals[1], vals[2]
                w = float(w_str or 0)
                base = float(base_str or 6)
                veg_items.append((name, w, base))
                total_weight += w
                max_base = max(max_base, base)

            # Spezie
            spice_items, total_spice = [], 0.0
            for iid in self.spice_tree.get_children():
                vals = self.spice_tree.item(iid, "values")
                name, w_str = vals[0], vals[1]
                w = float(w_str or 0)
                spice_items.append((name, w))
                total_spice += w

            # ✅ opzionale: includi le spezie nel peso
            include_spices = bool(self.include_spices_var.get())
            eff_weight = total_weight + (total_spice if include_spices else 0.0)

            temp = float(self.entry_temp.get() or 20.0)
            q10 = float(self.entry_q10.get() or 2.2)
            method = self.method.get()

            water_ml, salt_g = 0.0, 0.0
            if method == "salamoia":
                brine_pct = float(self.entry_brine_pct.get() or 2.5)
                jar_vol = float((self.entry_jar_vol.get() or "0") or 0)
                headspace = float(self.entry_headspace.get() or 0)
                packfrac = float(self.entry_packfrac.get() or 0.7)
                water_ml = estimate_brine_water_ml(eff_weight, jar_vol if jar_vol > 0 else None, headspace, packfrac)
                salt_g = salt_for_brine_g(water_ml, brine_pct)
            else:
                dry_pct = float(self.entry_dry_pct.get() or 2.0)
                salt_g = salt_for_dry_g(eff_weight, dry_pct)

            min_time = adjusted_time_days(max_base if max_base > 0 else 7.0, temp, q10)

            summary = [f"• Peso totale verdure: {total_weight:.0f} g"]
            if include_spices and total_spice > 0:
                summary.append(f"• Spezie contate nel peso: +{total_spice:.0f} g → **{eff_weight:.0f} g**")
            if method == "salamoia":
                summary.append(f"• Acqua stimata per copertura: {water_ml:.0f} ml")
                summary.append(f"• Sale per salamoia: {salt_g:.1f} g")
            else:
                summary.append(f"• Sale a secco: {salt_g:.1f} g")
            summary.append(f"• Tempo minimo stimato a {temp:.1f}°C: {min_time:.1f} giorni (Q10={q10:.2f})")
            if total_spice > 0:
                summary.append(f"• Spezie totali (peso): {total_spice:.0f} g")

            self.lbl_results.config(text="\n".join(summary))

            # cache per salvataggio
            self._calc_cache = dict(
                veg_items=veg_items, spice_items=spice_items,
                total_weight=eff_weight,  # attenzione: salviamo il peso effettivo usato per i calcoli
                water_ml=water_ml, salt_g=salt_g,
                min_time=min_time, temp=temp, q10=q10,
            )
            return True
        except Exception as e:
            from tkinter import messagebox
            messagebox.showerror("Errore di calcolo", f"Controlla i valori inseriti.\nDettaglio: {e}")
            return False

    def save_recipe(self):
        """
        Salva la ricetta corrente.
        - Se esiste già una ricetta con lo stesso NOME, chiede se sovrascrivere.
        - In caso di sovrascrittura: aggiorna la ricetta e **rimpiazza** gli ingredienti.
        """
        from tkinter import messagebox

        # Assicurati di avere i calcoli aggiornati
        if not hasattr(self, "_calc_cache"):
            self.calculate()
            if not hasattr(self, "_calc_cache"):
                messagebox.showwarning("Attenzione", "Calcola prima i parametri della ricetta.")
                return

        cache = self._calc_cache

        name = self.entry_recipe_name.get().strip() or f"Ricetta {datetime.date.today().isoformat()}"
        method = self.method.get()
        notes = self.txt_notes.get("1.0", "end").strip()
        rating = self.star.get()
        tasted = self.tasted_notes.get("1.0", "end").strip()

        # Parametri metodo
        brine_pct = float(self.entry_brine_pct.get() or 0.0) if method == "salamoia" else None
        jar_vol = float(self.entry_jar_vol.get() or 0.0) if method == "salamoia" else None
        headspace = float(self.entry_headspace.get() or 0.0) if method == "salamoia" else None
        packfrac = float(self.entry_packfrac.get() or 0.0) if method == "salamoia" else None

        # Dati calcolati
        total_weight = float(cache.get("total_weight", 0.0))
        water_ml = float(cache.get("water_ml", 0.0))
        salt_g = float(cache.get("salt_g", 0.0))
        min_time = float(cache.get("min_time", 0.0))
        temp = float(cache.get("temp", 20.0))
        q10 = float(cache.get("q10", 2.2))
        veg_items = cache.get("veg_items", [])
        spice_items = cache.get("spice_items", [])

        conn = get_conn(); cur = conn.cursor()

        # Esiste già una ricetta con questo nome?
        cur.execute("SELECT id, created_at FROM recipes WHERE name=? ORDER BY datetime(created_at) DESC", (name,))
        existing = cur.fetchall()

        overwrite_id = None
        if existing:
            # Se ce ne sono più di una, prendiamo l'ultima (la più recente)
            overwrite_id = existing[0][0]
            dt = existing[0][1] or ""
            if not messagebox.askyesno(
                "Nome già presente",
                f"Esiste già una ricetta chiamata:\n\n“{name}” (creata il {dt}).\n\nVuoi SOVRASCRIVERLA?",
                icon="warning"
            ):
                conn.close()
                messagebox.showinfo("Annullato", "Salvataggio annullato: cambia il nome ricetta per creare una nuova scheda.")
                return

        try:
            if overwrite_id is None:
                # Inserimento NUOVO
                cur.execute("""
                    INSERT INTO recipes(
                        name, method, total_weight_g, brine_pct, jar_volume_ml, headspace_ml, packing_fraction,
                        target_temp_c, min_time_days, salt_g, water_ml, q10, notes, rating, tasted_notes, created_at
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    name, method, total_weight,
                    brine_pct, jar_vol, headspace, packfrac,
                    temp, min_time, salt_g, water_ml, q10,
                    notes, rating, tasted, datetime.datetime.now().isoformat(timespec="seconds")
                ))
                rid = cur.lastrowid
            else:
                # SOVRASCRIVI: aggiorna la riga esistente e rimpiazza gli ingredienti
                rid = int(overwrite_id)
                cur.execute("""
                    UPDATE recipes SET
                        method=?,
                        total_weight_g=?,
                        brine_pct=?, jar_volume_ml=?, headspace_ml=?, packing_fraction=?,
                        target_temp_c=?, min_time_days=?, salt_g=?, water_ml=?, q10=?,
                        notes=?, rating=?, tasted_notes=?
                    WHERE id=?
                """, (
                    method, total_weight,
                    brine_pct, jar_vol, headspace, packfrac,
                    temp, min_time, salt_g, water_ml, q10,
                    notes, rating, tasted, rid
                ))
                # Rimpiazza gli ingredienti
                cur.execute("DELETE FROM recipe_items WHERE recipe_id=?", (rid,))

            # Inserisci ingredienti
            for nm, w, _base in veg_items:
                cur.execute(
                    "INSERT INTO recipe_items(recipe_id, item_type, name, weight_g) VALUES (?,?,?,?)",
                    (rid, "vegetable", nm, float(w or 0.0))
                )
            for nm, w in spice_items:
                cur.execute(
                    "INSERT INTO recipe_items(recipe_id, item_type, name, weight_g) VALUES (?,?,?,?)",
                    (rid, "spice", nm, float(w or 0.0))
                )

            conn.commit()
        except Exception as e:
            conn.rollback()
            conn.close()
            messagebox.showerror("Errore salvataggio", f"Impossibile salvare la ricetta.\nDettaglio: {e}")
            return

        conn.close()
        messagebox.showinfo("OK", f"Ricetta “{name}” salvata.")
        self.refresh_recipe_list()

    def delete_selected_recipe(self):
        """
        Elimina la ricetta selezionata nel Ricettario (con conferma).
        Rimuove anche le relative righe in recipe_items (vincolo ON DELETE CASCADE o delete esplicito).
        """
        from tkinter import messagebox

        sel = self.recipes.selection()
        if not sel:
            messagebox.showinfo("Info", "Seleziona una ricetta da eliminare.")
            return

        rid = int(sel[0])
        vals = self.recipes.item(sel[0], "values")
        title = vals[1] if vals and len(vals) > 1 else "(senza titolo)"

        if not messagebox.askyesno("Conferma eliminazione", f"Vuoi eliminare definitivamente la ricetta:\n\n“{title}”?", icon="warning"):
            return

        try:
            conn = get_conn(); cur = conn.cursor()
            # Se il DB non ha ON DELETE CASCADE, cancelliamo gli item esplicitamente
            cur.execute("DELETE FROM recipe_items WHERE recipe_id=?", (rid,))
            cur.execute("DELETE FROM recipes WHERE id=?", (rid,))
            conn.commit(); conn.close()
        except Exception as e:
            messagebox.showerror("Errore", f"Impossibile eliminare la ricetta.\nDettaglio: {e}")
            return

        # Aggiorna UI
        for iid in sel:
            self.recipes.delete(iid)
        self.lbl_det.config(text="Ricetta eliminata.")
    # ---------------- Ricettario UI ----------------
    def build_book_ui(self, root):
        top = ttk.Frame(root, style="TFrame")
        top.pack(fill="x", pady=(8,4))

        ttk.Label(top, text="Cerca").pack(side="left", padx=(0,6))
        self.entry_search = ttk.Entry(top, width=32)
        self.entry_search.pack(side="left")

        ttk.Label(top, text="  Ingrediente").pack(side="left", padx=(8,6))
        self.combo_ing = ttk.Combobox(top, width=24, values=["— Tutti —"] + self._list_all_ingredients())
        self.combo_ing.set("— Tutti —")
        self.combo_ing.pack(side="left")
        self.combo_ing.bind("<<ComboboxSelected>>", lambda e: self.refresh_recipe_list())

        ttk.Label(top, text="  Stagione").pack(side="left", padx=(8,6))
        self.combo_season = ttk.Combobox(top, width=14, values=["—", "Primavera", "Estate", "Autunno", "Inverno", "Tutto l'anno"])
        self.combo_season.set("—")
        self.combo_season.pack(side="left")

        ttk.Label(top, text="  Mese").pack(side="left", padx=(12,6))
        self.combo_month = ttk.Combobox(top, width=12, values=["—","Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"])
        self.combo_month.set("—")
        self.combo_month.pack(side="left")

        ttk.Button(top, text="Di stagione oggi", command=self.filter_season_today).pack(side="left", padx=6)
        ttk.Button(top, text="Applica filtro", command=self.refresh_recipe_list).pack(side="left", padx=6)

        body = ttk.Frame(root, style="TFrame"); body.pack(fill="both", expand=True)
        wrap = ttk.Frame(body, style="TFrame"); wrap.pack(side="left", fill="both", expand=True, padx=(0,8), pady=8)
        vscroll = ttk.Scrollbar(wrap, orient="vertical"); hscroll = ttk.Scrollbar(wrap, orient="horizontal")

        # ✅ aggiungo la colonna "n°"
        self.recipes = ttk.Treeview(
            wrap,
            columns=("num","titolo","metodo","peso","sale","acqua","giorni","stag","creata"),
            show="headings", height=18,
            yscrollcommand=vscroll.set, xscrollcommand=hscroll.set
        )
        for col, txt, w, anchor in [
            ("num","#",60,"center"),
            ("titolo","Titolo",300,"w"),
            ("metodo","Metodo",90,"center"),
            ("peso","Peso (g)",90,"center"),
            ("sale","Sale (g)",90,"center"),
            ("acqua","Acqua (ml)",100,"center"),
            ("giorni","Tempo min (gg)",130,"center"),
            ("stag","Stagionalità",160,"center"),
            ("creata","Creata il",160,"center"),
        ]:
            self.recipes.heading(col, text=txt); self.recipes.column(col, width=w, anchor=anchor)

        vscroll.config(command=self.recipes.yview); hscroll.config(command=self.recipes.xview)
        self.recipes.grid(row=0, column=0, sticky="nsew"); vscroll.grid(row=0, column=1, sticky="ns"); hscroll.grid(row=1, column=0, sticky="ew")
        wrap.rowconfigure(0, weight=1); wrap.columnconfigure(0, weight=1)

        details = ttk.Frame(body, style="Card.TFrame", padding=12)
        details.pack(side="left", fill="both", expand=False, pady=8)
        ttk.Label(details, text="Dettagli ricetta", style="CardTitle.TLabel").pack(anchor="w")
        self.lbl_det = ttk.Label(details, text="", justify="left"); self.lbl_det.pack(anchor="w", pady=(6,8))
        ttk.Button(details, text="Carica in 'Nuova ricetta'", command=self.load_selected_recipe).pack(anchor="w")

        self.recipes.bind("<Double-1>", self.load_selected_recipe)
        self.refresh_recipe_list()
        self.attach_veg_filter_to_book_ui(top)
        ttk.Button(details, text="Elimina ricetta", command=self.delete_selected_recipe).pack(anchor="w", pady=(6,0))

    def adapt_recipe_to_jar(self, scale_spices: bool = True):
        """
        Scala tutte le verdure (e opzionalmente le spezie) per adattare la ricetta
        al vaso indicato (ml), mantenendo la stessa proporzione.
        target_veg_weight = (jar_vol - headspace) * pf
        fattore = target_veg_weight / peso_verdure_attuale
        """
        from tkinter import messagebox

        # leggi parametri del vaso
        try:
            jar_vol = float(self.entry_jar_vol.get() or 0.0)
            head = float(self.entry_headspace.get() or 0.0)
            pf = float(self.entry_packfrac.get() or 0.70)
        except Exception:
            messagebox.showwarning("Errore", "Controlla volume vaso / spazio di testa / frazione di riempimento.")
            return

        if jar_vol <= 0:
            messagebox.showinfo("Info", "Inserisci un volume vaso (ml) > 0.")
            return

        pf = max(0.50, min(0.90, pf))
        eff_vol = max(0.0, jar_vol - head)
        target_veg_weight = eff_vol * pf  # ~ g (assumiamo 1 g/ml)

        # peso verdure attuale
        veg_rows = self.veg_tree.get_children()
        if not veg_rows:
            messagebox.showinfo("Info", "Aggiungi almeno una verdura prima di adattare la ricetta.")
            return
        curr_veg_weight = 0.0
        for iid in veg_rows:
            vals = self.veg_tree.item(iid, "values")
            try:
                curr_veg_weight += float(vals[1])
            except Exception:
                pass
        if curr_veg_weight <= 0:
            messagebox.showwarning("Errore", "Pesi verdure non validi.")
            return

        factor = target_veg_weight / curr_veg_weight

        # scala verdure
        for iid in veg_rows:
            vals = list(self.veg_tree.item(iid, "values"))
            try:
                w = float(vals[1])
            except Exception:
                w = 0.0
            new_w = max(0.0, w * factor)
            vals[1] = f"{new_w:.0f}"
            self.veg_tree.item(iid, values=tuple(vals))

        # scala spezie (opzionale)
        if scale_spices:
            for iid in self.spice_tree.get_children():
                vals = list(self.spice_tree.item(iid, "values"))
                try:
                    w = float(vals[1])
                except Exception:
                    w = 0.0
                new_w = max(0.0, w * factor)
                vals[1] = f"{new_w:.0f}"
                self.spice_tree.item(iid, values=tuple(vals))

        # ricalcola sale/acqua/tempi con i nuovi pesi
        self.calculate()
        messagebox.showinfo("Adattamento completato",
                            f"Ricetta adattata al vaso da {jar_vol:.0f} ml (pf={pf:.2f}, testa {head:.0f} ml).\n"
                            f"Fattore di scala applicato: ×{factor:.3f}")

    def adapt_recipe_to_jar_ui(self):
        # se vuoi poter scegliere dalla UI se scalare anche le spezie
        flag = getattr(self, "scale_spices_var", None)
        scale_spices = bool(flag.get()) if flag else True
        self.adapt_recipe_to_jar(scale_spices=scale_spices)


    def calc_required_jar_volume(self):
        """
        Calcola il volume del vaso (ml) necessario per contenere le verdure inserite,
        dato 'Frazione riempimento verdure' (pf) e 'Spazio di testa' (headspace).
        Assunzione densità ~ 1 g/ml (buona per stima pratica).
        Vaso_ml = (peso_verdure / pf) + headspace
        """
        from tkinter import messagebox

        # somma i pesi verdure
        total_veg = 0.0
        for iid in self.veg_tree.get_children():
            vals = self.veg_tree.item(iid, "values")
            try:
                total_veg += float(vals[1])
            except Exception:
                pass

        if total_veg <= 0:
            messagebox.showinfo("Info", "Aggiungi almeno una verdura con un peso valido.")
            return

        try:
            pf = float(self.entry_packfrac.get() or 0.70)
            head = float(self.entry_headspace.get() or 0.0)
        except Exception:
            messagebox.showwarning("Errore", "Controlla frazione di riempimento e spazio di testa.")
            return

        pf = max(0.50, min(0.90, pf))
        required_ml = (total_veg / pf) + max(0.0, head)

        # scrive nel campo e mostra
        self.entry_jar_vol.delete(0, "end")
        self.entry_jar_vol.insert(0, f"{required_ml:.0f}")
        messagebox.showinfo("Volume vaso stimato",
                            f"Per {total_veg:.0f} g di verdure, pf={pf:.2f} e spazio di testa {head:.0f} ml\n"
                            f"serve un vaso da ~ {required_ml:.0f} ml.")

    def _months_for_season_text(self, text: str) -> set:
        months = set()
        t = (text or "").strip()
        if "Tutto l'anno" in t: return set(range(1, 13))
        if "Primavera" in t: months.update([3, 4, 5])
        if "Estate" in t: months.update([6, 7, 8])
        if "Autunno" in t: months.update([9, 10, 11])
        if "Inverno" in t: months.update([12, 1, 2])
        return months

    def attach_veg_filter_to_book_ui(self, top: ttk.Frame):
        """Aggiunge al Ricettario la tendina 'Ingrediente principale (verdura)'. """
        ttk.Label(top, text="  Ingrediente principale").pack(side="left", padx=(8,6))
        values = ["— Tutte verdure —"] + self._list_vegetable_catalog()
        self.combo_veg_filter = ttk.Combobox(top, width=24, values=values)
        self.combo_veg_filter.set("— Tutte verdure —")
        self.combo_veg_filter.pack(side="left")
        self.combo_veg_filter.bind("<<ComboboxSelected>>", lambda e: self.refresh_recipe_list())


    def _infer_recipe_seasons(self, recipe_id: int) -> str:
        try:
            conn = get_conn(); cur = conn.cursor()
            cur.execute("SELECT i.name FROM recipe_items i WHERE i.recipe_id=? AND i.item_type='vegetable'", (recipe_id,))
            veg_names = [row[0] for row in cur.fetchall()]
            if not veg_names: return ""
            
            placeholders = ','.join(['?'] * len(veg_names))
            cur.execute(f"SELECT seasons FROM vegetables WHERE name IN ({placeholders})", veg_names)
            
            seasons_set = set()
            for (season_str,) in cur.fetchall():
                if season_str:
                    for token in season_str.split(','):
                        seasons_set.add(token.strip())

            conn.close()
            order = ["Primavera", "Estate", "Autunno", "Inverno", "Tutto l'anno"]
            return ", ".join(sorted(list(seasons_set), key=lambda s: order.index(s) if s in order else 99))
        except Exception:
            return ""

    def _infer_recipe_months(self, recipe_id: int) -> set:
        months = set()
        try:
            conn = get_conn(); cur = conn.cursor()
            cur.execute("SELECT i.name FROM recipe_items i WHERE i.recipe_id=? AND i.item_type='vegetable'", (recipe_id,))
            veg_names = [row[0] for row in cur.fetchall()]
            if not veg_names: return set()
            
            placeholders = ','.join(['?'] * len(veg_names))
            cur.execute(f"SELECT seasons FROM vegetables WHERE name IN ({placeholders})", veg_names)

            for (season_str,) in cur.fetchall():
                months.update(self._months_for_season_text(season_str or ""))
            conn.close()
        except Exception:
            return months
        return months

    def filter_season_today(self):
        months_it = ["—","Gennaio","Febbraio","Marzo","Aprile","Maggio",
                     "Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"]
        m = datetime.date.today().month
        self.combo_month.set(months_it[m])
        self.refresh_recipe_list()

    def import_csv_recipes(self):
        """
        Importa ricette da CSV con colonne:
        Titolo, Metodo, Vegetali, Spezie, TempC, Q10, BrinePct, DryPct, JarVolumeML, HeadspaceML, PackingFraction, Note

        - Duplicati: se esiste già una ricetta con lo stesso Titolo (case-insensitive) viene **saltata**.
        - Le verdure non presenti nel DB vengono aggiunte automaticamente con valori di default.
        """
        from tkinter import filedialog, messagebox
        import csv, datetime

        path = filedialog.askopenfilename(
            title="Importa ricette CSV",
            filetypes=(("CSV files", "*.csv"), ("Tutti i file", "*.*"))
        )
        if not path:
            return

        def fnum(x, default=0.0):
            try:
                return float(x)
            except Exception:
                return default

        added = 0
        skipped_dup = 0
        skipped_err = 0

        conn = get_conn()
        cur = conn.cursor()

        try:
            with open(path, newline="", encoding="utf-8") as f:
                rdr = csv.DictReader(f)
                required = {"Titolo", "Metodo", "Vegetali"}
                if not required.issubset(set(rdr.fieldnames or [])):
                    messagebox.showerror(
                        "Errore CSV",
                        "Colonne richieste mancanti. Servono almeno: Titolo, Metodo, Vegetali."
                    )
                    return

                # cache titoli esistenti (case-insensitive)
                cur.execute("SELECT LOWER(name) FROM recipes")
                existing_titles = {row[0] for row in cur.fetchall()}

                for row in rdr:
                    title = (row.get("Titolo") or "").strip()
                    if not title:
                        skipped_err += 1
                        continue

                    # duplicato?
                    if title.lower() in existing_titles:
                        skipped_dup += 1
                        continue

                    method = (row.get("Metodo") or "").strip().lower()
                    method = "salamoia" if method.startswith("sala") else ("secco" if "secco" in method else "salamoia")

                    # parsing ingredienti "Nome:Peso|Nome2:Peso"
                    def parse_pairs(s):
                        items = []
                        for part in (s or "").split("|"):
                            part = part.strip()
                            if not part:
                                continue
                            if ":" in part:
                                nm, wt = part.split(":", 1)
                                try:
                                    w = float(wt)
                                except Exception:
                                    w = 0.0
                            else:
                                nm, w = part, 0.0
                            items.append((nm.strip(), w))
                        return items

                    veg_pairs = parse_pairs(row.get("Vegetali"))
                    spice_pairs = parse_pairs(row.get("Spezie"))

                    if not veg_pairs:
                        skipped_err += 1
                        continue

                    # assicurati che le verdure esistano in tabella
                    for nm, w in veg_pairs:
                        cur.execute("SELECT 1 FROM vegetables WHERE name=?", (nm,))
                        if not cur.fetchone():
                            # default inserimento
                            cur.execute("""
                                INSERT INTO vegetables(name, seasons, default_dry_pct, base_days_20c, cut_style, notes)
                                VALUES (?,?,?,?,?,?)
                            """, (nm, "—", 2.0, 6.0, "Taglio a piacere", ""))

                    # calcoli base
                    total_weight = sum(w for _n, w in veg_pairs)
                    # giorni base = max dei giorni base delle verdure coinvolte
                    max_base = 6.0
                    for nm, _ in veg_pairs:
                        r = cur.execute("SELECT base_days_20c FROM vegetables WHERE name=?", (nm,)).fetchone()
                        if r and r[0]:
                            try:
                                max_base = max(max_base, float(r[0]))
                            except Exception:
                                pass

                    tempC = fnum(row.get("TempC"), 20.0)
                    q10 = fnum(row.get("Q10"), 2.2)
                    brine_pct = fnum(row.get("BrinePct"), 2.5)
                    dry_pct = fnum(row.get("DryPct"), 2.0)
                    jar_ml = fnum(row.get("JarVolumeML"), 0.0)
                    head_ml = fnum(row.get("HeadspaceML"), 20.0)
                    packfrac = fnum(row.get("PackingFraction"), 0.7)

                    # acqua & sale
                    if method == "salamoia":
                        if jar_ml > 0:
                            water_ml = max(0.0, (jar_ml * (1.0 - packfrac)) - head_ml)
                        else:
                            water_ml = max(0.0, total_weight * ((1.0 / packfrac) - 1.0))
                        salt_g = max(0.0, water_ml * brine_pct / 100.0)
                    else:
                        water_ml = 0.0
                        salt_g = max(0.0, total_weight * dry_pct / 100.0)

                    # tempo minimo con Q10
                    delta = (20.0 - float(tempC)) / 10.0
                    min_time = max(0.1, float(max_base) * ((q10 or 2.2) ** delta))

                    notes = (row.get("Note") or "").strip()

                    # inserisci recipe
                    cur.execute("""
                        INSERT INTO recipes(
                            name, method, total_weight_g, brine_pct, jar_volume_ml, headspace_ml, packing_fraction,
                            target_temp_c, min_time_days, salt_g, water_ml, q10, notes, rating, tasted_notes, created_at
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (
                        title, method, total_weight,
                        brine_pct if method == "salamoia" else None,
                        jar_ml if method == "salamoia" else None,
                        head_ml if method == "salamoia" else None,
                        packfrac if method == "salamoia" else None,
                        tempC, min_time, salt_g, water_ml, q10, notes, 0, "", datetime.datetime.now().isoformat(timespec="seconds")
                    ))
                    rid = cur.lastrowid

                    # items
                    for nm, w in veg_pairs:
                        cur.execute("INSERT INTO recipe_items(recipe_id, item_type, name, weight_g) VALUES (?,?,?,?)",
                                    (rid, "vegetable", nm, float(w or 0.0)))
                    for nm, w in spice_pairs:
                        cur.execute("INSERT INTO recipe_items(recipe_id, item_type, name, weight_g) VALUES (?,?,?,?)",
                                    (rid, "spice", nm, float(w or 0.0)))

                    # traccia il titolo importato per evitare duplicati multipli nello stesso file
                    existing_titles.add(title.lower())
                    added += 1

            conn.commit()

        except Exception as e:
            conn.rollback()
            conn.close()
            messagebox.showerror("Errore import", f"Impossibile completare l'import.\nDettaglio: {e}")
            return
        finally:
            conn.close()

        messagebox.showinfo("Import completato", f"Aggiunte: {added}\nSaltate (duplicati): {skipped_dup}\nSaltate (errori): {skipped_err}")
        self.refresh_recipe_list()

    def refresh_recipe_list(self):
        """
        Ricerca avanzata + filtri:
        - testo (AND su titolo/note/ingredienti)
        - Ingrediente (qualsiasi: verdura o spezia)
        - Ingrediente principale (verdura)
        - Stagione / Mese
        Ordina alfabeticamente per titolo e mostra numero sequenziale.
        """
        # pulizia tabella
        for iid in self.recipes.get_children():
            self.recipes.delete(iid)

        # input UI
        raw_q = (self.entry_search.get() or "").strip().lower()
        terms = [t for t in raw_q.split() if t]

        ing_filter = self.combo_ing.get() if hasattr(self, "combo_ing") else "— Tutti —"
        if ing_filter == "— Tutti —":
            ing_filter = ""

        veg_filter = self.combo_veg_filter.get() if hasattr(self, "combo_veg_filter") else "— Tutte verdure —"
        if veg_filter == "— Tutte verdure —":
            veg_filter = ""

        season_filter = self.combo_season.get() if hasattr(self, "combo_season") else "—"
        month_filter = self.combo_month.get() if hasattr(self, "combo_month") else "—"
        month_index = ["—","Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"]
        mnum = month_index.index(month_filter) if month_filter in month_index else 0

        # carica tutte le ricette
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT r.id, r.name, r.method, r.total_weight_g, r.salt_g, r.water_ml, r.min_time_days, r.created_at
            FROM recipes r
        """)
        rows = cur.fetchall()

        # ---- filtro per Ingrediente (qualsiasi tipo) ----
        if ing_filter:
            cur.execute("SELECT DISTINCT recipe_id FROM recipe_items WHERE LOWER(name)=LOWER(?)", (ing_filter,))
            ids_ing = {rid for (rid,) in cur.fetchall()}
            # ATTENZIONE: filtrare correttamente senza creare liste di boolean
            rows = [r for r in rows if r[0] in ids_ing]

        # ---- filtro per Ingrediente principale (verdura) ----
        if veg_filter:
            cur.execute("""
                SELECT DISTINCT recipe_id
                FROM recipe_items
                WHERE item_type='vegetable' AND LOWER(name)=LOWER(?)
            """, (veg_filter,))
            ids_veg = {rid for (rid,) in cur.fetchall()}
            rows = [r for r in rows if r[0] in ids_veg]

        # ---- filtro testuale (AND) su titolo, note e ingredienti ----
        if terms:
            # partiamo dagli id presenti in rows
            ids_ok = {r[0] for r in rows}
            for t in terms:
                like = f"%{t}%"
                cur.execute("""
                    SELECT id FROM recipes WHERE LOWER(COALESCE(name,'')) LIKE ? OR LOWER(COALESCE(notes,'')) LIKE ?
                    UNION
                    SELECT recipe_id FROM recipe_items WHERE LOWER(name) LIKE ?
                """, (like, like, like))
                ids_t = {rid for (rid,) in cur.fetchall()}
                ids_ok &= ids_t
                if not ids_ok:
                    break
            rows = [r for r in rows if r[0] in ids_ok]

        conn.close()

        # ordina alfabeticamente per titolo
        rows.sort(key=lambda r: (r[1] or "").lower())

        # applica stagione/mese e popola con numero sequenziale
        seq = 1
        shown = 0
        for rid, name, method, tw, sg, wm, days, created in rows:
            stag = self._infer_recipe_seasons(rid) if hasattr(self, "_infer_recipe_seasons") else ""
            if season_filter != "—" and season_filter not in (stag or ""):
                continue
            if mnum:
                months = self._infer_recipe_months(rid) if hasattr(self, "_infer_recipe_months") else set()
                if mnum not in months:
                    continue

            self.recipes.insert(
                "", "end", iid=str(rid),
                values=(
                    f"{seq:03d}",          # numero sequenziale
                    name,
                    method,
                    f"{float(tw or 0):.0f}",
                    f"{float(sg or 0):.1f}",
                    f"{float(wm or 0):.0f}",
                    f"{float(days or 0):.1f}",
                    stag,
                    created or ""
                )
            )
            seq += 1
            shown += 1

        self.lbl_det.config(text=f"{shown} ricette trovate. Doppio click per dettagli.")
    def _list_vegetable_catalog(self) -> list:
        """Ritorna l'elenco alfabetico delle verdure presenti nella tabella 'vegetables'."""
        conn = get_conn(); cur = conn.cursor()
        cur.execute("SELECT name FROM vegetables")
        names = sorted((r[0] for r in cur.fetchall()), key=lambda s: s.lower())
        conn.close()
        return names

    def load_selected_recipe(self, event=None):
        sel = self.recipes.selection()
        if not sel: return
        rid = int(sel[0])

        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM recipes WHERE id=?", (rid,))
        rec = cur.fetchone()
        if not rec:
            messagebox.showerror("Errore", "Ricetta non trovata.")
            conn.close()
            return
        
        rec_cols = [d[0] for d in cur.description]
        rec_dict = dict(zip(rec_cols, rec))

        cur.execute("SELECT item_type, name, weight_g FROM recipe_items WHERE recipe_id=?", (rid,))
        items = cur.fetchall()
        conn.close()

        self.notebook.select(self.page_new)

        # reset & populate
        self.entry_recipe_name.delete(0, "end"); self.entry_recipe_name.insert(0, rec_dict.get('name', ''))
        self.method.set(rec_dict.get('method', 'salamoia')); self._update_method_state()

        for t in self.veg_tree.get_children(): self.veg_tree.delete(t)
        for t in self.spice_tree.get_children(): self.spice_tree.delete(t)

        for itype, nm, w in items:
            if itype == "vegetable":
                info = self._veg_info(nm)
                base, seasons, cut = info if info else (7.0, "", "Taglio a piacere")
                self.veg_tree.insert("", "end", values=(nm, f"{w:.0f}", f"{base:.1f}", seasons, cut))
            else:
                self.spice_tree.insert("", "end", values=(nm, f"{w:.0f}"))

        self.entry_temp.delete(0, "end"); self.entry_temp.insert(0, f"{rec_dict.get('target_temp_c', 20.0):.1f}")
        self.entry_q10.delete(0, "end"); self.entry_q10.insert(0, f"{rec_dict.get('q10', 2.2):.2f}")
        self.entry_dry_pct.delete(0, "end"); self.entry_dry_pct.insert(0, f"{rec_dict.get('default_dry_pct', 2.0):.1f}")
        self.entry_brine_pct.delete(0, "end"); self.entry_brine_pct.insert(0, f"{rec_dict.get('brine_pct', 2.5):.1f}")
        self.entry_jar_vol.delete(0, "end"); self.entry_jar_vol.insert(0, f"{rec_dict.get('jar_volume_ml', ''):.0f}" if rec_dict.get('jar_volume_ml') else "")
        self.entry_headspace.delete(0, "end"); self.entry_headspace.insert(0, f"{rec_dict.get('headspace_ml', 0.0):.0f}")
        self.entry_packfrac.delete(0, "end"); self.entry_packfrac.insert(0, f"{rec_dict.get('packing_fraction', 0.7):.2f}")

        self.txt_notes.delete("1.0", "end"); self.txt_notes.insert("1.0", rec_dict.get('notes', ''))
        self.star.set_value(int(rec_dict.get('rating', 0)))
        self.tasted_notes.delete("1.0", "end"); self.tasted_notes.insert("1.0", rec_dict.get('tasted_notes', ''))
        
        self.calculate()

    # ---------------- DB UI ----------------
    def build_db_ui(self, root):
        card1 = ttk.Frame(root, style="Card.TFrame", padding=12)
        card1.pack(fill="x", padx=0, pady=(10,6))
        ttk.Label(card1, text="Verdure", style="CardTitle.TLabel").pack(anchor="w")

        self.veg_table = ttk.Treeview(card1, columns=("stagioni","secco","base","taglio","note"), show="headings", height=8)
        self.veg_table.heading("stagioni", text="Stagioni"); self.veg_table.column("stagioni", width=180)
        self.veg_table.heading("secco", text="Sale secco %"); self.veg_table.column("secco", width=110)
        self.veg_table.heading("base", text="Giorni base @20°C"); self.veg_table.column("base", width=150)
        self.veg_table.heading("taglio", text="Taglio consigliato"); self.veg_table.column("taglio", width=200)
        self.veg_table.heading("note", text="Note"); self.veg_table.column("note", width=320)
        self.veg_table.pack(fill="x", pady=6)

        frm_add = ttk.Frame(card1, style="TFrame")
        frm_add.pack(fill="x", pady=(2,8))
        self.entry_new_veg = ttk.Entry(frm_add, width=30); self.entry_new_veg.pack(side="left", padx=(0,6))
        self.entry_new_season = ttk.Entry(frm_add, width=25); self.entry_new_season.pack(side="left", padx=6)
        self.entry_new_dry = ttk.Entry(frm_add, width=10); self.entry_new_dry.pack(side="left", padx=6)
        self.entry_new_base = ttk.Entry(frm_add, width=10); self.entry_new_base.pack(side="left", padx=6)
        self.entry_new_cut = ttk.Entry(frm_add, width=28); self.entry_new_cut.pack(side="left", padx=6)
        self.entry_new_note = ttk.Entry(frm_add, width=40); self.entry_new_note.pack(side="left", padx=6)
        ttk.Button(frm_add, text="Aggiungi/aggiorna", command=self.add_update_veg).pack(side="left", padx=6)

        card2 = ttk.Frame(root, style="Card.TFrame", padding=12)
        card2.pack(fill="x", padx=0, pady=(6,10))
        ttk.Label(card2, text="Spezie", style="CardTitle.TLabel").pack(anchor="w")
        self.spice_list = ttk.Treeview(card2, columns=("dummy",), show="headings", height=6)
        self.spice_list.heading("dummy", text="Spezia")
        self.spice_list.pack(fill="x", pady=6)

        frm_sp = ttk.Frame(card2, style="TFrame"); frm_sp.pack(fill="x", pady=(2,8))
        self.entry_new_spice = ttk.Entry(frm_sp, width=30); self.entry_new_spice.pack(side="left", padx=(0,6))
        ttk.Button(frm_sp, text="Aggiungi", command=self.add_spice_db).pack(side="left", padx=6)

        self.refresh_db_tables()

    def refresh_db_tables(self):
        conn = get_conn()
        cur = conn.cursor()
        
        for iid in self.veg_table.get_children(): self.veg_table.delete(iid)
        cur.execute("SELECT name, seasons, default_dry_pct, base_days_20c, cut_style, notes FROM vegetables ORDER BY name")
        for name, seasons, dry, base, cut, notes in cur.fetchall():
            self.veg_table.insert("", "end", values=(seasons or "", f"{float(dry or 0):.1f}", f"{float(base or 0):.1f}", cut or "", notes or ""))

        for iid in self.spice_list.get_children(): self.spice_list.delete(iid)
        cur.execute("SELECT name FROM spices ORDER BY name")
        for (nm,) in cur.fetchall():
            self.spice_list.insert("", "end", values=(nm,))
        
        conn.close()
        self.combo_veg["values"] = self._list_veg_names()
        self.combo_spice["values"] = self._list_spice_names()

    def add_update_veg(self):
        name = self.entry_new_veg.get().strip()
        if not name:
            messagebox.showwarning("Attenzione", "Inserisci il nome della verdura.")
            return
        try:
            season = self.entry_new_season.get().strip() or "—"
            dry = float(self.entry_new_dry.get().strip() or 2.0)
            base = float(self.entry_new_base.get().strip() or 7.0)
            cut = self.entry_new_cut.get().strip() or "Taglio a piacere"
            note = self.entry_new_note.get().strip()
        except ValueError:
            messagebox.showerror("Errore", "Controlla che i valori numerici (sale, giorni) siano validi.")
            return

        conn = get_conn()
        cur = conn.cursor()
        cur.execute("""
        INSERT INTO vegetables(name, seasons, default_dry_pct, base_days_20c, cut_style, notes)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(name) DO UPDATE SET seasons=excluded.seasons, default_dry_pct=excluded.default_dry_pct,
            base_days_20c=excluded.base_days_20c, cut_style=excluded.cut_style, notes=excluded.notes
        """, (name, season, dry, base, cut, note))
        conn.commit(); conn.close()
        self.refresh_db_tables()
        messagebox.showinfo("OK", f"'{name}' salvata nel database.")

    def add_spice_db(self):
        name = self.entry_new_spice.get().strip()
        if not name: return
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("INSERT OR IGNORE INTO spices(name) VALUES (?)", (name,))
        conn.commit()
        conn.close()
        self.refresh_db_tables()

# -------------------------- Avvio --------------------------
def main():
    init_db()
    app = FermentaProApp()
    app.mainloop()

if __name__ == "__main__":
    main()