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

# Avec modération IA (recommandé)
ANTHROPIC_API_KEY=sk-ant-... npm start

# Sans IA
npm start
```

## URLs

| Page | URL |
|------|-----|
| Public (participants) | `http://localhost:3456/` |
| Écran de présentation | `http://localhost:3456/display.html` |
| Admin / modération | `http://localhost:3456/admin.html` |

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3456` | Port du serveur |
| `ADMIN_PIN` | `1234` | PIN du panneau admin |
| `ANTHROPIC_API_KEY` | — | Clé API Claude (optionnel) |
| `CONFERENCE_TITLE` | `Conférence` | Titre affiché |
| `DB_PATH` | `./qa.db` | Chemin de la base SQLite |

## Flux de travail

1. Démarrez le serveur, ouvrez `display.html` sur le projecteur et `admin.html` sur votre ordi.
2. Partagez l'URL `/` avec le public (QR code ou affichage sur écran secondaire).
3. Les participants soumettent des questions → Claude les modère automatiquement.
4. Dans le panneau admin : approuvez, épinglez ou marquez comme répondues.
5. L'écran de présentation se met à jour en temps réel.
