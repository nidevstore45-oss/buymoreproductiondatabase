# File original yang dipindahkan/dikeluarkan dari root

Gunakan daftar ini saat menyalin ZIP ke checkout lama. Jangan menghapus data/database.

| File unggahan/logical root lama | Keadaan paket |
|---|---|
| `package-lock.json` | Lockfile tidak cocok; versi asli di `docs/original-package-lock.json`. Jangan mempertahankannya sebagai lockfile aktif. Lockfile baru harus berasal dari `npm install` yang berhasil. |
| `index.ts` | Deno report runner diarsipkan menjadi `legacy/report-runner.ts`; bukan frontend entry dan bukan Edge Function aktif baru. |
| `manifest.webmanifest` | Berkas PWA valid berada di `public/manifest.webmanifest`; file unggahan sebelumnya kosong. |
| `production-sw.js` | Implementasi berada di `public/production-sw.js`; file unggahan sebelumnya kosong. |
| `robot.txt` | Berada di `public/robots.txt`, nama asset standar yang disajikan Vite. |

Suffix unduhan `(1)`/`(4)` dinormalisasi menjadi nama project normal. Upload flatten tidak membuktikan lokasi asli seluruh folder; pemetaan lengkap disimpan pada inventory. Jangan menghapus asset atau file repository lain yang tidak termasuk unggahan hanya karena tidak ada dalam paket ini.
