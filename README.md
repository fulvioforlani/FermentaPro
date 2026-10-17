# FermentaPro / Fermentati

Calcolatore e ricettario per fermentati casalinghi (verdure a secco o in salamoia, kombucha). Gratuito, per chiunque voglia usarlo.
*Free home-fermentation calculator and recipe book (Italian UI). Use it, change it, share it.*

## Cosa fa
- **Sale con tara**: peso lordo − tara = peso netto → grammi di sale (a secco: % sul peso delle verdure; salamoia: % sul peso dell'acqua). Dice se la % messa è nel range sicuro.
- **Vasi in corso** con segnalatore a 3 livelli (troppo presto / si può assaggiare / pronto), tempi corretti con la temperatura (Q10) e **tempo base modificabile**.
- **Temperatura**: misura a mano > sensore > meteo ARPA Piemonte (estate) > 20 °C.
- **Kombucha** tutto in grammi (acqua, tè, zucchero, starter, SCOBY).
- **Ricettario** con 190+ ricette e **ricerca per ingredienti**, anche con verdure sostitutive.
- **Guida** con le regole (vedi `GUIDA.md`). Sono stime: contano sempre assaggio e odore. Nessun consiglio medico.

## Avvio rapido (webapp, Docker)
```
cd web
docker compose up -d --build
```
Poi apri http://localhost:8954 . In `web/docker-compose.yml` imposta `LAN_IP` con l'IP del tuo PC per usarla anche dal telefono (e apri la porta 8954 nel firewall solo per la rete di casa). I dati sono in un volume Docker (copia del database di partenza `web/seed/fermentapro.db`).

## Sensore di temperatura (facoltativo)
Un Raspberry con sonda DS18B20 può mandare la temperatura a `http://IP-DEL-PC:8954/api/temp?t=21.4` (parametri opzionali `h`, `ts`, `src`, oppure JSON `{"readings":[...]}` per le letture arretrate).

## App Android (facoltativa)
`android/` contiene una WebView che apre la webapp di casa (indirizzo impostabile al primo avvio). Serve Java 17 e gli strumenti Android SDK (build-tools 34, platform android-34); poi `python android/build.py`. L'APK e la chiave di firma non sono nel repo.

## Programma desktop originale
`FermentaPro.py` (Python + tkinter, nessuna dipendenza) con `fermentapro.db`.

## Licenza
MIT, vedi `LICENSE`. Usalo, modificalo, condividilo.
