import express, { Request, Response, NextFunction } from "express";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, "..", "qa.db");
const PORT = parseInt(process.env.PORT ?? "3456", 10);
const ADMIN_PIN = process.env.ADMIN_PIN ?? "1234";

// ─── Database ────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    text        TEXT    NOT NULL,
    author      TEXT    NOT NULL DEFAULT 'Anonyme',
    status      TEXT    NOT NULL DEFAULT 'pending',
    votes       INTEGER NOT NULL DEFAULT 0,
    is_pinned   INTEGER NOT NULL DEFAULT 0,
    category    TEXT,
    ai_note     TEXT,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    answered_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS voter_fingerprints (
    question_id INTEGER NOT NULL,
    fingerprint TEXT    NOT NULL,
    PRIMARY KEY (question_id, fingerprint)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL DEFAULT 'Conférence',
    is_open     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Ensure at least one session exists
const sessionCount = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c;
if (sessionCount === 0) {
  db.prepare("INSERT INTO sessions (title, is_open) VALUES (?, 1)").run(
    process.env.CONFERENCE_TITLE ?? "Conférence"
  );
}

// ─── Claude AI ───────────────────────────────────────────────────────────────

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic()
  : null;

interface AiResult {
  approved: boolean;
  category: string;
  note: string;
}

async function moderateQuestion(text: string): Promise<AiResult> {
  if (!anthropic) {
    return { approved: true, category: "Général", note: "" };
  }

  const stream = anthropic.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 256,
    thinking: { type: "adaptive" },
    system: `Tu es un modérateur pour une conférence. Analyse la question soumise par un participant.
Réponds UNIQUEMENT avec un JSON valide de cette forme :
{"approved": true/false, "category": "string", "note": "string"}

Règles :
- approved=false si : spam, insulte, hors-sujet total, doublon évident.
- category : un mot ou deux mots (ex: "Technique", "Organisation", "Produit", "Général", "Démonstration").
- note : courte remarque (max 80 caractères) pour le modérateur, ou vide "".`,
    messages: [{ role: "user", content: `Question: ${text}` }],
  });

  const message = await stream.finalMessage();
  const raw = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as AiResult;
  } catch {
    // fall through
  }
  return { approved: true, category: "Général", note: "" };
}

// ─── SSE broadcasting ─────────────────────────────────────────────────────────

const sseClients = new Set<Response>();

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSession() {
  return db.prepare("SELECT * FROM sessions ORDER BY id DESC LIMIT 1").get() as {
    id: number;
    title: string;
    is_open: number;
  };
}

function getPublicQuestions() {
  return db
    .prepare(
      `SELECT id, text, author, votes, is_pinned, category, created_at
       FROM questions
       WHERE status IN ('approved','answered')
       ORDER BY is_pinned DESC, votes DESC, created_at ASC`
    )
    .all();
}

function getAllQuestions() {
  return db
    .prepare(
      `SELECT * FROM questions ORDER BY is_pinned DESC, votes DESC, created_at ASC`
    )
    .all();
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Admin auth middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const pin = req.headers["x-admin-pin"] ?? req.query["pin"];
  if (pin !== ADMIN_PIN) {
    res.status(401).json({ error: "PIN incorrect" });
    return;
  }
  next();
}

// ── Public routes ──────────────────────────────────────────────────────────

// SSE endpoint for real-time updates
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial data
  res.write(`event: init\ndata: ${JSON.stringify({
    questions: getPublicQuestions(),
    session: getSession(),
  })}\n\n`);

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

// Get public questions
app.get("/api/questions", (_req, res) => {
  res.json({
    session: getSession(),
    questions: getPublicQuestions(),
  });
});

// Submit a question
app.post("/api/questions", async (req, res) => {
  const session = getSession();
  if (!session.is_open) {
    res.status(403).json({ error: "Les questions sont fermées pour l'instant." });
    return;
  }

  const text = (req.body.text ?? "").trim() as string;
  const author = (req.body.author ?? "Anonyme").trim() as string;

  if (!text || text.length < 5) {
    res.status(400).json({ error: "La question est trop courte." });
    return;
  }
  if (text.length > 500) {
    res.status(400).json({ error: "La question est trop longue (max 500 caractères)." });
    return;
  }

  // AI moderation (non-blocking for UX — we insert then moderate)
  const inserted = db
    .prepare(
      `INSERT INTO questions (text, author, status) VALUES (?, ?, 'pending') RETURNING id`
    )
    .get(text, author) as { id: number };

  const questionId = inserted.id;

  // Broadcast to admin immediately
  broadcast("question:new", {
    id: questionId,
    text,
    author,
    status: "pending",
    votes: 0,
    is_pinned: 0,
    category: null,
    created_at: Math.floor(Date.now() / 1000),
  });

  res.json({ id: questionId, message: "Question soumise ! Elle sera visible après modération." });

  // Run AI moderation asynchronously
  moderateQuestion(text).then((ai) => {
    const status = ai.approved ? "approved" : "rejected";
    db.prepare(
      "UPDATE questions SET status=?, category=?, ai_note=? WHERE id=?"
    ).run(status, ai.category, ai.note, questionId);

    broadcast("question:updated", {
      id: questionId,
      status,
      category: ai.category,
      ai_note: ai.note,
    });

    if (status === "approved") {
      const q = db.prepare("SELECT * FROM questions WHERE id=?").get(questionId);
      broadcast("question:approved", q);
    }
  }).catch(console.error);
});

// Vote for a question (fingerprint-based dedup)
app.post("/api/questions/:id/vote", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fingerprint = (req.body.fingerprint ?? "") as string;

  if (!fingerprint) {
    res.status(400).json({ error: "Fingerprint manquant." });
    return;
  }

  const q = db.prepare("SELECT * FROM questions WHERE id=? AND status='approved'").get(id);
  if (!q) {
    res.status(404).json({ error: "Question non trouvée." });
    return;
  }

  try {
    db.prepare("INSERT INTO voter_fingerprints (question_id, fingerprint) VALUES (?,?)").run(id, fingerprint);
  } catch {
    res.status(409).json({ error: "Vous avez déjà voté pour cette question." });
    return;
  }

  db.prepare("UPDATE questions SET votes = votes + 1 WHERE id=?").run(id);
  const updated = db.prepare("SELECT votes FROM questions WHERE id=?").get(id) as { votes: number };

  broadcast("question:voted", { id, votes: updated.votes });
  res.json({ votes: updated.votes });
});

// ── Admin routes ────────────────────────────────────────────────────────────

app.get("/api/admin/questions", requireAdmin, (_req, res) => {
  res.json({
    session: getSession(),
    questions: getAllQuestions(),
  });
});

app.patch("/api/admin/questions/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status, is_pinned } = req.body as {
    status?: string;
    is_pinned?: number;
  };

  const q = db.prepare("SELECT * FROM questions WHERE id=?").get(id);
  if (!q) {
    res.status(404).json({ error: "Question non trouvée." });
    return;
  }

  if (status !== undefined) {
    const answeredAt = status === "answered" ? Math.floor(Date.now() / 1000) : null;
    db.prepare("UPDATE questions SET status=?, answered_at=? WHERE id=?").run(
      status,
      answeredAt,
      id
    );
  }

  if (is_pinned !== undefined) {
    db.prepare("UPDATE questions SET is_pinned=? WHERE id=?").run(
      is_pinned ? 1 : 0,
      id
    );
  }

  const updated = db.prepare("SELECT * FROM questions WHERE id=?").get(id);
  broadcast("question:updated", updated);
  res.json(updated);
});

app.delete("/api/admin/questions/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare("DELETE FROM questions WHERE id=?").run(id);
  db.prepare("DELETE FROM voter_fingerprints WHERE question_id=?").run(id);
  broadcast("question:deleted", { id });
  res.json({ ok: true });
});

app.patch("/api/admin/session", requireAdmin, (req, res) => {
  const { title, is_open } = req.body as { title?: string; is_open?: number };
  const session = getSession();

  if (title !== undefined) {
    db.prepare("UPDATE sessions SET title=? WHERE id=?").run(title, session.id);
  }
  if (is_open !== undefined) {
    db.prepare("UPDATE sessions SET is_open=? WHERE id=?").run(
      is_open ? 1 : 0,
      session.id
    );
  }

  const updated = getSession();
  broadcast("session:updated", updated);
  res.json(updated);
});

// Admin verify PIN
app.post("/api/admin/verify", requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🎤 Conference Q&A démarré sur http://localhost:${PORT}`);
  console.log(`   📱 Public  → http://localhost:${PORT}/`);
  console.log(`   🖥️  Écran   → http://localhost:${PORT}/display.html`);
  console.log(`   🔧 Admin   → http://localhost:${PORT}/admin.html`);
  console.log(`   🔑 PIN admin : ${ADMIN_PIN}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`   ⚠️  ANTHROPIC_API_KEY manquant — modération IA désactivée`);
  }
  console.log();
});
