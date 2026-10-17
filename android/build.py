"""Compila Fermentati.apk SENZA Gradle: aapt2 + javac + d8 + zipalign + apksigner.

Serve: JDK 17 (java/javac/keytool nel PATH) e un Android SDK minimo con
  build-tools/34.0.0   e   platforms/android-34
(percorso in ANDROID_SDK, predefinito C:\\Users\\fulvio\\android-sdk).

Uso:  python build.py
Esce: Fermentati.apk (firmato). Il keystore sta in keystore/ (MAI su git).
"""
import glob
import os
import secrets
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SDK = os.environ.get("ANDROID_SDK", r"C:\Users\fulvio\android-sdk")
BT = os.path.join(SDK, "build-tools", "34.0.0")
ANDROID_JAR = os.path.join(SDK, "platforms", "android-34", "android.jar")
OUT = os.path.join(ROOT, "build")
KS_DIR = os.path.join(ROOT, "keystore")
KS = os.path.join(KS_DIR, "fermentati.jks")
KS_PASS = os.path.join(KS_DIR, "password.txt")
ALIAS = "fermentati"
WIN = os.name == "nt"
exe = lambda n: os.path.join(BT, n + (".exe" if WIN else ""))
bat = lambda n: os.path.join(BT, n + (".bat" if WIN else ""))


def run(cmd):
    shown = ["***" if i and (cmd[i - 1] in ("-storepass", "-keypass") or c.startswith("pass:")) else c for i, c in enumerate(cmd)]
    print("  $", " ".join(os.path.basename(c) if i == 0 else c for i, c in enumerate(shown))[:200])
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=False)
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        sys.exit(f"ERRORE in {os.path.basename(cmd[0])}")
    return r.stdout


def network_security_config():
    """Testo in chiaro (http) solo verso la rete di casa; tutto il resto solo https."""
    hosts = ["localhost", "10.0.2.2"] + [f"192.168.{n}.{h}" for n in (0, 1) for h in range(1, 255)]
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             "<!-- GENERATO da build.py: http consentito solo per host di rete locale -->",
             "<network-security-config>",
             '    <base-config cleartextTrafficPermitted="false" />',
             '    <domain-config cleartextTrafficPermitted="true">',
             '        <domain includeSubdomains="true">local</domain>']
    lines += [f"        <domain>{h}</domain>" for h in hosts]
    lines += ["    </domain-config>", "</network-security-config>", ""]
    path = os.path.join(ROOT, "res", "xml", "network_security_config.xml")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


def keystore():
    if os.path.exists(KS):
        return open(KS_PASS, encoding="utf-8").read().strip()
    os.makedirs(KS_DIR, exist_ok=True)
    pw = secrets.token_urlsafe(18)
    with open(KS_PASS, "w", encoding="utf-8") as f:
        f.write(pw + "\n")
    run(["keytool", "-genkeypair", "-keystore", KS, "-storetype", "PKCS12", "-alias", ALIAS,
         "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
         "-storepass", pw, "-keypass", pw, "-dname", "CN=Fermentati, O=Fulvio Forlani, C=IT"])
    print("  keystore creato:", KS)
    return pw


def main():
    for p in (exe("aapt2"), exe("zipalign"), bat("d8"), bat("apksigner"), ANDROID_JAR):
        if not os.path.exists(p):
            sys.exit(f"Manca {p}: installa build-tools 34.0.0 e platforms;android-34 in {SDK}")
    shutil.rmtree(OUT, ignore_errors=True)
    for d in ("gen", "classes", "dex"):
        os.makedirs(os.path.join(OUT, d))
    print("1) network security config"); network_security_config()
    print("2) risorse (aapt2)")
    run([exe("aapt2"), "compile", "--dir", os.path.join(ROOT, "res"), "-o", os.path.join(OUT, "res.zip")])
    run([exe("aapt2"), "link", "-o", os.path.join(OUT, "base.apk"), "-I", ANDROID_JAR,
         "--manifest", os.path.join(ROOT, "AndroidManifest.xml"), "-A", os.path.join(ROOT, "assets"),
         "--java", os.path.join(OUT, "gen"), "--min-sdk-version", "26", "--target-sdk-version", "34",
         "--version-code", "1", "--version-name", "1.0", os.path.join(OUT, "res.zip")])
    print("3) java (javac)")
    srcs = glob.glob(os.path.join(ROOT, "src", "**", "*.java"), recursive=True) + \
        glob.glob(os.path.join(OUT, "gen", "**", "*.java"), recursive=True)
    run(["javac", "--release", "8", "-encoding", "UTF-8", "-Xlint:-options", "-classpath", ANDROID_JAR,
         "-d", os.path.join(OUT, "classes")] + srcs)
    print("4) dex (d8)")
    classes = glob.glob(os.path.join(OUT, "classes", "**", "*.class"), recursive=True)
    run([bat("d8"), "--release", "--min-api", "26", "--lib", ANDROID_JAR, "--output", os.path.join(OUT, "dex")] + classes)
    print("5) apk")
    unaligned = os.path.join(OUT, "unaligned.apk")
    shutil.copy(os.path.join(OUT, "base.apk"), unaligned)
    with zipfile.ZipFile(unaligned, "a", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(OUT, "dex", "classes.dex"), "classes.dex")
    aligned = os.path.join(OUT, "aligned.apk")
    run([exe("zipalign"), "-p", "-f", "4", unaligned, aligned])
    print("6) firma (apksigner)")
    pw = keystore()
    final = os.path.join(ROOT, "Fermentati.apk")
    run([bat("apksigner"), "sign", "--ks", KS, "--ks-key-alias", ALIAS, "--ks-pass", "file:" + KS_PASS, "--out", final, aligned])
    print(run([bat("apksigner"), "verify", "--verbose", final]).strip().splitlines()[0])
    print(f"\nOK: {final}  ({os.path.getsize(final) // 1024} KB)")


if __name__ == "__main__":
    main()
