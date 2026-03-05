// ============================================================
//  server.js  —  Middleware SocialBuzz → Roblox
//  Deploy di: Railway (railway.app)
//  Node.js >= 18
//
//  ENDPOINT:
//  POST /webhook/socialbuzz  ← terima donasi dari SocialBuzz
//  GET  /donations/poll      ← Roblox ambil donasi baru
//  GET  /                    ← health check
// ============================================================

const express = require('express');
const crypto  = require('crypto');
const app     = express();

// ── Environment Variables (isi di Railway → Variables) ────
const SOCIALBUZZ_SECRET = process.env.SOCIALBUZZ_SECRET || 'sbwhook-wda4ocnahy9odjklpwrt7et0';
const ROBLOX_API_KEY    = process.env.ROBLOX_API_KEY    || 'MOUNTGRIVELA_3698754210.Aa#@_2026';

// ── Antrian donasi (in-memory, max 500) ───────────────────
let donationQueue = [];

// ── Verifikasi tanda tangan HMAC dari SocialBuzz ──────────
function verifySignature(rawBody, signatureFromHeader) {
	try {
		const expected = crypto
			.createHmac('sha256', SOCIALBUZZ_SECRET)
			.update(rawBody)
			.digest('hex');
		return crypto.timingSafeEqual(
			Buffer.from(expected),
			Buffer.from(signatureFromHeader)
		);
	} catch {
		return false;
	}
}

// ── Format Rupiah ─────────────────────────────────────────
function formatRupiah(angka) {
	return new Intl.NumberFormat('id-ID', {
		style               : 'currency',
		currency            : 'IDR',
		minimumFractionDigits: 0,
	}).format(angka);
}

// ══════════════════════════════════════════════════════════
//  ENDPOINT 1 — Webhook dari SocialBuzz
//  SocialBuzz → POST https://DOMAIN_KAMU/webhook/socialbuzz
//  Pastikan URL ini diisi di dashboard SocialBuzz kamu
//  sebagai Webhook URL.
// ══════════════════════════════════════════════════════════
app.post(
	'/webhook/socialbuzz',
	express.raw({ type: '*/*' }),
	(req, res) => {
		const signature = req.headers['x-socialbuzz-signature'] || '';

		// Verifikasi tanda tangan — tolak jika tidak valid
		if (!verifySignature(req.body, signature)) {
			console.warn('❌ Webhook ditolak: tanda tangan tidak valid');
			return res.status(401).json({ error: 'Unauthorized' });
		}

		let payload;
		try {
			payload = JSON.parse(req.body.toString('utf8'));
		} catch {
			return res.status(400).json({ error: 'Format JSON tidak valid' });
		}

		const trx = payload.transaction || {};

		// Hanya proses donasi yang sudah lunas (settlement)
		if (trx.status !== 'settlement') {
			console.log('ℹ️ Webhook diabaikan, status:', trx.status);
			return res.status(200).json({ message: 'Diabaikan: status ' + trx.status });
		}

		const amount = parseInt(trx.amount) || 0;

		// Nama SocialBuzz donatur langsung dipakai sebagai username Roblox.
		// Donatur harus mendaftarkan nama SocialBuzz mereka
		// sama dengan username Roblox mereka.
		const donorName = (payload.donor && payload.donor.name) ? payload.donor.name.trim() : 'Anonim';

		const donationItem = {
			id        : String(trx.id || Date.now()),
			donorName : donorName,
			robloxUser: donorName,        // nama SocialBuzz = username Roblox
			amount    : amount,
			amountStr : formatRupiah(amount),
			message   : String(payload.message || ''),
			timestamp : Date.now(),
		};

		donationQueue.push(donationItem);
		if (donationQueue.length > 500) donationQueue.shift();  // batasi antrian

		console.log(`✅ Donasi masuk: ${donationItem.donorName} → ${donationItem.amountStr}`);
		return res.status(200).json({ message: 'OK' });
	}
);

// ══════════════════════════════════════════════════════════
//  ENDPOINT 2 — Poll dari Roblox (GET /donations/poll)
//  Roblox server memanggil ini setiap PollInterval detik.
//  Header wajib: x-roblox-key: <ROBLOX_API_KEY>
//  Mengembalikan max 10 donasi per request, lalu dihapus.
// ══════════════════════════════════════════════════════════
app.get('/donations/poll', (req, res) => {
	const key = req.headers['x-roblox-key'] || '';

	if (key !== ROBLOX_API_KEY) {
		console.warn('❌ Poll ditolak: API key salah');
		return res.status(401).json({ error: 'Unauthorized' });
	}

	// Ambil max 10, hapus dari antrian (sudah terproses)
	const batch = donationQueue.splice(0, 10);
	return res.status(200).json({ donations: batch });
});

// ══════════════════════════════════════════════════════════
//  ENDPOINT 3 — Health Check
//  Buka https://DOMAIN_KAMU/ di browser → harus tampil OK
// ══════════════════════════════════════════════════════════
app.get('/', (_, res) => {
	res.send('Middleware SocialBuzz → Roblox OK 🟢');
});

// ── Jalankan Server ───────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`🚀 Middleware berjalan di port ${PORT}`);
	console.log(`   Webhook URL : POST /webhook/socialbuzz`);
	console.log(`   Roblox Poll : GET  /donations/poll`);
});
