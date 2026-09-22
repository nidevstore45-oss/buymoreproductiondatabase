# PRODUCTION BUYMORE — pengembangan repository existing

## Basis dan batas verifikasi
Seluruh 14 file unggahan telah dibaca. Entry UI adalah main.tsx (9.724 baris), bukan index.ts; index.ts adalah Deno Edge Function laporan lama. React 18, TypeScript, Vite, Tailwind 3, Supabase JS dan SheetJS dipertahankan. Tidak ada screenshot, schema dump, migration history, maupun koneksi database terotorisasi dalam unggahan. Nama tabel/RPC dapat dibuktikan dari kode; tipe SQL, policy dan trigger production tidak dapat disimpulkan sebagai fakta. Migration wajib memeriksa kontrak tabel sebelum perubahan dan tidak boleh membuat ulang tabel inti yang hilang.

## Tujuan
Operator mencatat produksi; supervisor mengesahkan atau menolak dan mengoreksi dengan alasan; admin mengelola pengguna, akses Factory dan master data. Dashboard dan Analisis membaca agregasi server, bukan seluruh transaksi. Production Plan memperluas production_targets, tidak membuat tabel rencana tandingan.

## Keputusan desain
- Pertahankan header, latar #E3E1E1, mode gelap, bahasa ID/CN, Card, Button, INPUT_CLASS, badge, typography dan breakpoint existing. Navigasi mengikuti delapan modul yang diminta.
- Gunakan master_items kategori FACTORY untuk Factory, bukan tabel Factory duplikat. Relasi Factory memakai kode immutable; tabel buymore_user_factories diperlukan untuk penugasan banyak Factory per pengguna.
- Pertahankan kolom snapshot product/color/shift; tambahkan referensi kode master agar perubahan nama tidak mengubah pencocokan target historis. Migrasi tidak melakukan backfill otomatis. Admin memetakan data lama melalui Koreksi; Factory atau pemilik tidak ditebak berdasarkan nama.
- Transaksi lama ditandai LEGACY, tidak dianggap sudah diverifikasi. Total tercatat mempertahankan sejarah. Actual rencana hanya transaksi VERIFIED yang tepat cocok tanggal, Factory, produk, warna dan shift. Koreksi mengembalikan status ke SUBMITTED. Tidak ada target wildcard atau penggandaan antara target harian dan shift.
- Jumlah target harian adalah penjumlahan rencana shift. Angka progress tidak dibatasi 100%; hanya lebar progress bar dibatasi untuk layout. Target nol menghasilkan progress tidak tersedia, bukan pembagian nol.
- Semua mutasi inti melalui RPC dengan autentikasi, izin, validasi, row lock/version dan audit dalam transaksi yang sama. Audit semantik tetap menggunakan activity_logs. Trigger logging lama tidak digandakan; catatan row-level existing dapat berdampingan dengan event workflow yang lebih rinci.
- RLS ditegakkan pada tabel, view invoker dan RPC. Profil yang hilang/gagal dimuat tidak diberi role operator secara otomatis. Pengguna baru tidak memperoleh role berprivilege dari user_metadata.
- Tidak membangun alert otomatis, trend analysis, produktivitas operator, downtime atau cost. Grafik/ranking operator dan tren lama dihapus dari halaman Analisis. Tidak memperluas laporan eksternal lama.
- Ekspor Excel membaca hasil filter melalui batch terkontrol, bukan hanya halaman tabel; kegagalan tidak menghasilkan pesan berhasil atau file parsial. Ekspor besar meminta filter lebih sempit secara eksplisit.
- Offline queue menyimpan request ID stabil, tidak menganggap semua unique-constraint error sebagai sukses. Cache transaksi lintas-sesi tidak ditampilkan sebelum izin dikonfirmasi.

## Kriteria pemeriksaan
Uji logika tanggal Jakarta, rentang 7/30 hari, qty integer positif, progress 110%, pemisahan scope, idempotency, filter dan rekonsiliasi antrean. Jalankan parser TypeScript, typecheck/build bila dependency tersedia; SQL perlu dieksekusi pada clone Supabase dengan schema sebenarnya. Laporan QA harus membedakan hasil nyata, inspeksi statis, dan pengujian live yang belum berjalan.
