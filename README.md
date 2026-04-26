# Cover Quiz 🎵

Jeu de reconnaissance de pochettes rap — 2 minutes, autant que possible.

## Stack
- **Next.js 14** (App Router)
- **Supabase** (Storage + DB)
- Zéro dépendance UI — CSS pur, esthétique VHS/arcade

## Setup

### 1. Installer les dépendances
```bash
npm install
```

### 2. Variables d'environnement
Ouvre `.env.local` et remplis :
```
NEXT_PUBLIC_SUPABASE_URL=https://XXXX.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```
Ces deux valeurs se trouvent dans **Supabase → Settings → API**.

> ⚠️ Utilise la clé **anon** ici (pas service_role), elle est publique.

### 3. Lancer en dev
```bash
npm run dev
```
→ http://localhost:3000

### 4. Pré-requis Supabase
- Le script `pipeline_pochettes.py` doit avoir tourné (pochettes dans Storage)
- La table `albums` doit exister (voir `supabase_setup.sql`)
- Le bucket `album-covers` doit être **public**

## Scoring
| Action | Points |
|---|---|
| Artiste trouvé | +1 |
| Album trouvé | +2 |
| Maximum théorique | `nb albums × 3` |

## Fonctionnalités
- Filtre FR / US / Tout
- Countdown 3-2-1 avant le jeu
- Tolérance aux fautes de frappe et accents
- Passage automatique quand artiste + album trouvés
- Récap visuel en fin de partie
