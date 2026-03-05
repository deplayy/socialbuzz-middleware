// ============================================================
//  server.js  —  Middleware SocialBuzz → Roblox
//  Deploy di Railway (railway.app) — Node.js >= 18
//
//  ENDPOINTS:
//  POST /webhook/socialbuzz  ← terima donasi dari SocialBuzz
//  GET  /donations/poll      ← Roblox ambil donasi baru
//  GET  /                    ← health check
//
//  SETUP RAILWAY VARIABLES:
//  SOCIALBUZZ_SECRET = (token webhook dari dashboard SocialBuzz)
//  ROBLOX_API_KEY    = (kunci rahasia, sama dengan di Settings.lua)
// ============================================================

const express = require('express');
const crypto  = require('crypto');
const app     = express();

// ── Environment Variables ─────────────────────────────────
const SOCIALBUZZ_SECRET = process.env.SOCIALBUZZ_SECRET || 'sbwhook-wda4ocnahy9odjklpwrt7et0';
const ROBLOX_API_KEY    = process.env.ROBLOX_API_KEY    || 'MOUNTGRIVELA_3698754210.Aa#@_2026';

// ── Antrian donasi (in-memory, max 500) ───────────────────
let donationQueue = [];

// ── Verifikasi HMAC dari SocialBuzz ───────────────────────
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
//  Isi di dashboard SocialBuzz:
//  Webhook URL = https://DOMAIN/webhook/socialbuzz
//  Webhook Secret = nilai SOCIALBUZZ_SECRET kamu
// ══════════════════════════════════════════════════════════
app.post(
	'/webhook/socialbuzz',
	express.raw({ type: '*/*' }),
	(req, res) => {
		// Log semua header untuk debug
		console.log('📩 Webhook diterima');
		console.log('Headers:', JSON.stringify(req.headers));

		const signature = req.headers['x-socialbuzz-signature'] || '';

		if (!verifySignature(req.body, signature)) {
			console.warn('❌ Webhook ditolak: tanda tangan tidak valid');
			console.warn('   Signature diterima :', signature);
			console.warn('   Secret dipakai     :', SOCIALBUZZ_SECRET);
			return res.status(401).json({ error: 'Unauthorized' });
		}

		let payload;
		try {
			payload = JSON.parse(req.body.toString('utf8'));
		} catch {
			return res.status(400).json({ error: 'Format JSON tidak valid' });
		}

		console.log('📦 Payload:', JSON.stringify(payload));

		const trx = payload.transaction || {};

		// Hanya proses donasi yang sudah lunas
		if (trx.status !== 'settlement') {
			console.log('ℹ️ Diabaikan — status:', trx.status);
			return res.status(200).json({ message: 'Diabaikan: ' + trx.status });
		}

		const amount = parseInt(trx.amount) || 0;

		// Nama SocialBuzz donatur = yang tampil di leaderboard
		const donorName = (payload.donor && payload.donor.name)
			? payload.donor.name.trim()
			: 'Anonim';

		const donationItem = {
			id        : String(trx.id || Date.now()),
			donorName : donorName,
			robloxUser: donorName,
			amount    : amount,
			amountStr : formatRupiah(amount),
			message   : String(payload.message || ''),
			timestamp : Date.now(),
		};

		donationQueue.push(donationItem);
		if (donationQueue.length > 500) donationQueue.shift();

		console.log(`✅ Donasi masuk: ${donorName} → ${formatRupiah(amount)}`);
		return res.status(200).json({ message: 'OK' });
	}
);

// ══════════════════════════════════════════════════════════
//  ENDPOINT 2 — Poll dari Roblox
//  Header wajib: x-roblox-key: <ROBLOX_API_KEY>
//  Mengembalikan max 10 donasi lalu menghapusnya dari antrian
// ══════════════════════════════════════════════════════════
app.get('/donations/poll', (req, res) => {
	const key = req.headers['x-roblox-key'] || '';

	if (key !== ROBLOX_API_KEY) {
		console.warn('❌ Poll ditolak: API key salah');
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const batch = donationQueue.splice(0, 10);
	if (batch.length > 0) {
		console.log(`📤 Dikirim ke Roblox: ${batch.length} donasi`);
	}
	return res.status(200).json({ donations: batch });
});

// ══════════════════════════════════════════════════════════
//  ENDPOINT 3 — Health Check
// ══════════════════════════════════════════════════════════
app.get('/', (_, res) => {
	res.send('Middleware SocialBuzz → Roblox OK 🟢');
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`🚀 Middleware berjalan di port ${PORT}`);
	console.log(`   Webhook URL : POST /webhook/socialbuzz`);
	console.log(`   Roblox Poll : GET  /donations/poll`);
});
