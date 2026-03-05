// ============================================================
//  MIDDLEWARE  —  SocialBuzz → Roblox
//  Deploy: Railway / Render / VPS  |  Node.js >= 18
//  npm install  →  npm start
// ============================================================

const express = require("express");
const crypto  = require("crypto");
const app     = express();

// ── ENV (isi di hosting kamu, jangan hardcode) ────────────
const SOCIALBUZZ_SECRET = process.env.SOCIALBUZZ_SECRET || "GANTI_SECRET_SOCIALBUZZ";
const ROBLOX_API_KEY    = process.env.ROBLOX_API_KEY    || "GANTI_KEY_ROBLOX_SERVER";

// ── Antrian donasi in-memory (max 500) ────────────────────
let queue = [];

// ── Verifikasi HMAC SHA-256 dari SocialBuzz ───────────────
function verifyHmac(rawBody, sigHeader) {
  try {
    const expected = crypto
      .createHmac("sha256", SOCIALBUZZ_SECRET)
      .update(rawBody)
      .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
  } catch {
    return false;
  }
}

function formatIDR(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", minimumFractionDigits: 0
  }).format(n);
}

// ── POST /webhook/socialbuzz ──────────────────────────────
// Daftarkan URL ini di dashboard SocialBuzz → Webhook:
//   https://DOMAIN_KAMU/webhook/socialbuzz
//
// Payload yang dikirim SocialBuzz:
// {
//   "transaction": { "id": "...", "status": "settlement", "amount": 50000 },
//   "donor":       { "name": "Budi", "roblox_user": "BudiRoblox" },
//   "message":     "Semangat!"
// }
// Header: x-socialbuzz-signature: <hmac-sha256-hex>

app.post("/webhook/socialbuzz", express.raw({ type: "*/*" }), (req, res) => {
  const sig = req.headers["x-socialbuzz-signature"] || "";

  if (!verifyHmac(req.body, sig)) {
    console.warn("❌ Signature tidak valid");
    return res.status(401).json({ error: "Unauthorized" });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const trx = payload.transaction || {};

  // Hanya proses donasi yang sudah settlement (berhasil dibayar)
  if (trx.status !== "settlement") {
    return res.status(200).json({ message: "Ignored: " + trx.status });
  }

  const amount = parseInt(trx.amount) || 0;
  const item = {
    id         : String(trx.id || Date.now()),
    donorName  : payload.donor?.name        || "Anonim",
    robloxUser : payload.donor?.roblox_user || "",
    amount,
    amountStr  : formatIDR(amount),
    message    : String(payload.message || ""),
    timestamp  : Date.now(),
  };

  queue.push(item);
  if (queue.length > 500) queue.shift();

  console.log(`✅ ${item.donorName} (${item.robloxUser}) → ${item.amountStr}`);
  return res.status(200).json({ message: "OK" });
});

// ── GET /donations/poll ───────────────────────────────────
// Dipanggil oleh Roblox server setiap beberapa detik.
// Header: x-roblox-key: ROBLOX_API_KEY
// Response: { "donations": [ ...max 10... ] }
// Item yang dikirim langsung dihapus dari antrian.

app.get("/donations/poll", (req, res) => {
  if ((req.headers["x-roblox-key"] || "") !== ROBLOX_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const batch = queue.splice(0, 10);
  return res.status(200).json({ donations: batch });
});

// ── Health check ──────────────────────────────────────────
app.get("/", (_, res) => res.send("Middleware OK 🟢"));

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Listening on port ${PORT}`));