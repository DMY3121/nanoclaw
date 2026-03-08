# Conference Q&A

Application temps réel pour permettre au public de poser des questions lors d'une conférence.

## Fonctionnalités

- **Page public** (mobile-friendly) — les participants soumettent et votent pour les questions
- **Panneau admin** — modération : approuver, rejeter, épingler, marquer comme répondue
- **Écran de présentation** — affichage en grand pour projecteur/écran de scène
- **Modération IA** — Claude classe automatiquement les questions et détecte le spam
- **Temps réel** — mises à jour instantanées via Server-Sent Events (SSE)

## Démarrage rapide

```bash
cd conference-qa
npm install

# Local uniquement
ANTHROPIC_API_KEY=sk-ant-... ADMIN_PIN=monpin npm start

# Local + tunnel Cloudflare (qa.dmy.me)
ANTHROPIC_API_KEY=sk-ant-... ADMIN_PIN=monpin npm run start:tunnel
```

## URLs

| Page | URL |
|------|-----|
| Public (participants) | `http://localhost:3456/` ou `https://qa.dmy.me/` |
| Écran de présentation | `http://localhost:3456/display.html` |
| Admin / modération | URL secrète affichée dans la **console au démarrage** |

> Le panneau admin n'est accessible qu'à une URL secrète (`/admin-<token>`) générée au démarrage.
> Pas d'URL connue = pas d'accès. Définir `ADMIN_SECRET=...` pour une URL stable entre redémarrages.

## Cloudflare Tunnel (qa.dmy.me)

```bash
# 1. Setup une seule fois (authentification + DNS)
npm run setup:tunnel

# 2. Lancer app + tunnel
ADMIN_PIN=monpin ADMIN_SECRET=monsecret ANTHROPIC_API_KEY=sk-ant-... npm run start:tunnel
```

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3456` | Port du serveur |
| `ADMIN_PIN` | `1234` | PIN du panneau admin |
| `ANTHROPIC_API_KEY` | — | Clé API Claude (optionnel) |
| `CONFERENCE_TITLE` | `Conférence` | Titre affiché |
| `DB_PATH` | `./qa.db` | Chemin de la base SQLite |
| `ADMIN_SECRET` | *(aléatoire)* | Token secret de l'URL admin (stable si défini) |
| `PUBLIC_HOST` | — | Domaine public affiché dans la console (ex: `qa.dmy.me`) |

## Flux de travail

1. Démarrez le serveur, ouvrez `display.html` sur le projecteur et `admin.html` sur votre ordi.
2. Partagez l'URL `/` avec le public (QR code ou affichage sur écran secondaire).
3. Les participants soumettent des questions → Claude les modère automatiquement.
4. Dans le panneau admin : approuvez, épinglez ou marquez comme répondues.
5. L'écran de présentation se met à jour en temps réel.
