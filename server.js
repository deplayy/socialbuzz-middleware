// ============================================================
//  server.js  —  Middleware SocialBuzz → Roblox
//
//  Tugas server ini:
//  1. Menerima notifikasi (webhook) dari SocialBuzz
//     setiap kali ada donasi yang berhasil dibayar
//  2. Menyimpan donasi ke dalam antrian sementara
//  3. Memberikan data antrian itu ke Roblox yang
//     datang mengambil (polling) setiap beberapa detik
//
//  CATATAN PENTING:
//  Nama yang dipakai untuk mencocokkan pemain Roblox
//  adalah nama yang tertera di akun SocialBuzz donatur
//  (donor.name). Tidak ada field tambahan di form.
//
//  Deploy di: Railway (railway.app) — GRATIS
//  Node.js versi 18 ke atas
// ============================================================

const express = require('express');
const crypto  = require('crypto');
const app     = express();

// ── Konfigurasi dari Environment Variable ────────────────
// Nilai ini JANGAN ditulis langsung di sini.
// Isi melalui fitur "Variables" di Railway (lihat README).
const SOCIALBUZZ_SECRET = process.env.SOCIALBUZZ_SECRET || 'sbwhook-wda4ocnahy9odjklpwrt7et0';
const ROBLOX_API_KEY    = process.env.ROBLOX_API_KEY    || 'MOUNTGRIVELA_3698754210.Aa#@_2026';

// ── Antrian donasi (tersimpan di memori) ──────────────────
// Maksimal 500 item agar tidak memenuhi RAM
let donationQueue = [];

// ── Fungsi verifikasi tanda tangan dari SocialBuzz ────────
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

// ── Fungsi format angka ke Rupiah ─────────────────────────
function formatRupiah(angka) {
	return new Intl.NumberFormat('id-ID', {
		style              : 'currency',
		currency           : 'IDR',
		minimumFractionDigits: 0,
	}).format(angka);
}

// ══════════════════════════════════════════════════════════
//  ENDPOINT 1: Menerima Webhook dari SocialBuzz
//  Method : POST
//  URL    : https://DOMAIN_KAMU/webhook/socialbuzz
// ══════════════════════════════════════════════════════════
app.post(
	'/webhook/socialbuzz',
	express.raw({ type: '*/*' }),
	(req, res) => {
		const signature = req.headers['x-socialbuzz-signature'] || '';

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

		// Hanya proses donasi yang statusnya "settlement"
		if (trx.status !== 'settlement') {
			console.log('ℹ️ Webhook diabaikan, status:', trx.status);
			return res.status(200).json({ message: 'Diabaikan: status ' + trx.status });
		}

		const amount = parseInt(trx.amount) || 0;

		// ── Nama SocialBuzz langsung dipakai sebagai username Roblox ──
		// Donatur cukup mendaftarkan nama mereka di SocialBuzz
		// dengan nama yang sama seperti username Roblox mereka.
		// Tidak ada field tambahan yang perlu diisi saat donasi.
		const donorName = payload.donor?.name || 'Anonim';

		const donationItem = {
			id        : String(trx.id || Date.now()),
			donorName : donorName,
			robloxUser: donorName,   // ← langsung pakai nama SocialBuzz
			amount    : amount,
			amountStr : formatRupiah(amount),
			message   : String(payload.message || ''),
			timestamp : Date.now(),
		};

		donationQueue.push(donationItem);
		if (donationQueue.length > 500) donationQueue.shift();

		console.log(`✅ Donasi masuk: ${donationItem.donorName} → ${donationItem.amountStr}`);
		return res.status(200).json({ message: 'OK' });
	}
);

// ══════════════════════════════════════════════════════════
//  ENDPOINT 2: Diakses oleh Roblox untuk mengambil donasi
//  Method : GET
//  URL    : https://DOMAIN_KAMU/donations/poll
//  Header : x-roblox-key: (nilai ROBLOX_API_KEY kamu)
// ══════════════════════════════════════════════════════════
app.get('/donations/poll', (req, res) => {
	const key = req.headers['x-roblox-key'] || '';

	if (key !== ROBLOX_API_KEY) {
		console.warn('❌ Poll ditolak: API key salah');
		return res.status(401).json({ error: 'Unauthorized' });
	}

	const batch = donationQueue.splice(0, 10);
	return res.status(200).json({ donations: batch });
});

// ══════════════════════════════════════════════════════════
//  ENDPOINT 3: Health check
//  Buka URL ini di browser → harus muncul "Middleware OK 🟢"
// ══════════════════════════════════════════════════════════
app.get('/', (_, res) => {
	res.send('Middleware OK 🟢');
});

// ── Jalankan Server ───────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`🚀 Server middleware berjalan di port ${PORT}`);
});

