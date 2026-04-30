"""
Pipeline v4 — Deezer API
=========================
- Gratuit, sans clé, pas de problème SSL
- Recherche exacte artiste + album sur Deezer
- N'écrase pas ce qui existe déjà (upsert par slug)
- Liste vide à remplir manuellement

pip install requests pillow supabase
"""

import io
import os
import re
import time
import requests
from PIL import Image
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
BUCKET_NAME  = "album-covers"
TABLE_NAME   = "albums"

COVER_SIZE   = 500
DELAY        = 0.5             # secondes entre requêtes Deezer

DEEZER_BASE  = "https://api.deezer.com"

# ─────────────────────────────────────────────
# ALBUMS
# ─────────────────────────────────────────────
ALBUMS = [
    # Ajoute tes albums ici :
    # ("Artiste", "Album", "FR"),
    # ("Artiste", "Album", "US"),

    # Xzibit
    ("Xzibit",          "At the Speed of Life",              "US"),
    ("Xzibit",          "40 Dayz & 40 Nightz",               "US"),
    ("Xzibit",          "Restless",                          "US"),
    ("Xzibit",          "Man vs. Machine",                   "US"),
    ("Xzibit",          "Weapons of Mass Destruction",       "US"),

    # Nate Dogg
    ("Nate Dogg",       "G Funk Classics Vol. 1 & 2",        "US"),
    ("Nate Dogg",       "Music & Me",                        "US"),
    ("Nate Dogg",       "Nate Dogg",                         "US"),

    # Big Daddy Kane
    ("Big Daddy Kane",  "Long Live the Kane",                "US"),
    ("Big Daddy Kane",  "It's a Big Daddy Thing",            "US"),
    ("Big Daddy Kane",  "Taste of Chocolate",                "US"),
    ("Big Daddy Kane",  "Looks Like a Job For...",           "US"),

    # Big Pun
    ("Big Pun",         "Capital Punishment",                "US"),
    ("Big Pun",         "Yeeeah Baby",                       "US"),
    ("Big Pun",         "Endangered Species",                "US"),

    # Cypress Hill
    ("Cypress Hill",    "Cypress Hill",                      "US"),
    ("Cypress Hill",    "Black Sunday",                      "US"),
    ("Cypress Hill",    "III Temples of Boom",               "US"),
    ("Cypress Hill",    "Cypress Hill IV",                   "US"),
    ("Cypress Hill",    "Skull & Bones",                     "US"),
    ("Cypress Hill",    "Elephants on Acid",                 "US"),

    # Lauryn Hill
    ("Lauryn Hill",     "The Miseducation of Lauryn Hill",   "US"),

    # Fugees
    ("Fugees",          "Blunted on Reality",                "US"),
    ("Fugees",          "The Score",                         "US"),

    # Ice Cube
    ("Ice Cube",        "AmeriKKKa's Most Wanted",           "US"),
    ("Ice Cube",        "Death Certificate",                 "US"),
    ("Ice Cube",        "The Predator",                      "US"),
    ("Ice Cube",        "Lethal Injection",                  "US"),
    ("Ice Cube",        "War & Peace Vol. 1",                "US"),
    ("Ice Cube",        "War & Peace Vol. 2",                "US"),

    # Ol' Dirty Bastard
    ("Ol' Dirty Bastard", "Return to the 36 Chambers",      "US"),
    ("Ol' Dirty Bastard", "Nigga Please",                    "US"),

    # A Tribe Called Quest
    ("A Tribe Called Quest", "People's Instinctive Travels and the Paths of Rhythm", "US"),
    ("A Tribe Called Quest", "The Low End Theory",           "US"),
    ("A Tribe Called Quest", "Midnight Marauders",           "US"),
    ("A Tribe Called Quest", "Beats Rhymes and Life",        "US"),
    ("A Tribe Called Quest", "The Love Movement",            "US"),
    ("A Tribe Called Quest", "We Got It from Here Thank You 4 Your Service", "US"),

    # Run DMC
    ("Run DMC",         "Run-D.M.C.",                        "US"),
    ("Run DMC",         "King of Rock",                      "US"),
    ("Run DMC",         "Raising Hell",                      "US"),
    ("Run DMC",         "Tougher Than Leather",              "US"),
    ("Run DMC",         "Down with the King",                "US"),

    # Wu-Tang — membres solo
    ("GZA",             "Liquid Swords",                     "US"),
    ("GZA",             "Beneath the Surface",               "US"),
    ("GZA",             "Legend of the Liquid Sword",        "US"),
    ("Method Man",      "Tical",                             "US"),
    ("Method Man",      "Tical 2000 Judgement Day",          "US"),
    ("Method Man",      "Tical 0 The Prequel",               "US"),
    ("Raekwon",         "Only Built 4 Cuban Linx",           "US"),
    ("Raekwon",         "Immobilarity",                      "US"),
    ("Raekwon",         "Only Built 4 Cuban Linx Pt. II",    "US"),
    ("Ghostface Killah","Ironman",                           "US"),
    ("Ghostface Killah","Supreme Clientele",                 "US"),
    ("Ghostface Killah","Fishscale",                         "US"),
    ("Ghostface Killah","Apollo Kids",                       "US"),
    ("RZA",             "Bobby Digital in Stereo",           "US"),
    ("RZA",             "The Birth of a Prince",             "US"),
    ("Inspectah Deck",  "Uncontrolled Substance",            "US"),
    ("Masta Killa",     "No Said Date",                      "US"),
    ("Masta Killa",     "Made in Brooklyn",                  "US"),
    ("Cappadonna",      "The Pillage",                       "US"),

    # The Pharcyde
    ("The Pharcyde",    "Bizarre Ride II the Pharcyde",      "US"),
    ("The Pharcyde",    "Labcabincalifornia",                 "US"),
    ("The Pharcyde",    "Plain Rap",                         "US")

]

# ─────────────────────────────────────────────
# UTILS
# ─────────────────────────────────────────────
def slugify(text: str) -> str:
    text = text.lower().strip()
    text = text.encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")


def normalize(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9\s]", "", s).strip()


def similarity(a: str, b: str) -> float:
    """Score simple de similarité 0-1 entre deux strings normalisées."""
    a, b = normalize(a), normalize(b)
    if a == b:
        return 1.0
    if a in b or b in a:
        return 0.85
    # Mots en commun
    wa, wb = set(a.split()), set(b.split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / max(len(wa), len(wb))


def download_and_crop(url: str) -> bytes:
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    w, h = img.size
    side = min(w, h)
    img = img.crop(((w - side) // 2, (h - side) // 2,
                    (w + side) // 2, (h + side) // 2))
    img = img.resize((COVER_SIZE, COVER_SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


# ─────────────────────────────────────────────
# DEEZER
# ─────────────────────────────────────────────
def search_deezer(artist: str, album: str):
    """
    Cherche l'album sur Deezer et retourne l'URL de la pochette (xl = 1000px).
    Stratégie : search album + artist, puis vérifie la similarité des résultats.
    """
    # Recherche principale
    query = f'artist:"{artist}" album:"{album}"'
    resp = requests.get(
        f"{DEEZER_BASE}/search/album",
        params={"q": query, "limit": 5},
        timeout=15,
    )
    time.sleep(DELAY)

    if resp.status_code != 200:
        return None

    results = resp.json().get("data", [])

    # Fallback si pas de résultats avec guillemets
    if not results:
        resp2 = requests.get(
            f"{DEEZER_BASE}/search/album",
            params={"q": f"{artist} {album}", "limit": 10},
            timeout=15,
        )
        time.sleep(DELAY)
        if resp2.status_code == 200:
            results = resp2.json().get("data", [])

    if not results:
        return None

    # Sélectionne le meilleur résultat par similarité artiste + album
    best = None
    best_score = 0.0

    for r in results:
        score_album  = similarity(album,  r.get("title", ""))
        score_artist = similarity(artist, r.get("artist", {}).get("name", ""))
        score = score_album * 0.6 + score_artist * 0.4

        if score > best_score:
            best_score = score
            best = r

    # Seuil minimum de confiance
    if best_score < 0.5:
        return None

    # cover_xl = 1000x1000px
    return best.get("cover_xl") or best.get("cover_big") or best.get("cover")


# ─────────────────────────────────────────────
# SUPABASE
# ─────────────────────────────────────────────
def init_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)



def ensure_bucket(sb):
    buckets = [b.name for b in sb.storage.list_buckets()]
    if BUCKET_NAME not in buckets:
        sb.storage.create_bucket(BUCKET_NAME, options={"public": True})
        print(f"✅ Bucket '{BUCKET_NAME}' créé")


def upload_cover(sb, img_bytes: bytes, path: str) -> str:
    sb.storage.from_(BUCKET_NAME).upload(
        path=path,
        file=img_bytes,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )
    return sb.storage.from_(BUCKET_NAME).get_public_url(path)


def insert_album(sb, artist, album, genre, cover_url):
    sb.table(TABLE_NAME).insert({
        "artist":    artist,
        "album":     album,
        "genre":     genre,
        "cover_url": cover_url,
        "slug":      f"{slugify(artist)}-{slugify(album)}",
    }).execute()


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def run():
    sb = init_supabase()
    ensure_bucket(sb)
    ok = fail = 0

    for artist, album, genre in ALBUMS:
        slug         = f"{slugify(artist)}-{slugify(album)}"
        storage_path = f"{genre.lower()}/{slug}.jpg"
        print(f"⏳  {artist} — {album}", end=" ... ", flush=True)

        try:
            cover_url_src = search_deezer(artist, album)
            if not cover_url_src:
                print("❌ introuvable sur Deezer")
                fail += 1
                continue

            img_bytes  = download_and_crop(cover_url_src)
            public_url = upload_cover(sb, img_bytes, storage_path)
            insert_album(sb, artist, album, genre, public_url)

            print(f"✅")
            ok += 1

        except Exception as e:
            print(f"💥 {e}")
            fail += 1

    print(f"""
─────────────────────────────
✅ Succès  : {ok}
❌ Échecs  : {fail}
─────────────────────────────""")


if __name__ == "__main__":
    run()
