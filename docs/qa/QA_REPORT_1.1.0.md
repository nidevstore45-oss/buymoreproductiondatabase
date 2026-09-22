# PRODUCTION BUYMORE — Laporan QA

Tanggal: 21 September 2026. Status: **KANDIDAT IMPLEMENTASI — BELUM SIAP PRODUCTION**.

## Keputusan rilis

**Definition of Done belum terpenuhi.** Source telah dimodifikasi berdasarkan file unggahan, tetapi full typecheck dan build belum berhasil. Migrasi belum dijalankan atau divalidasi oleh PostgreSQL. Tidak ada klaim bahwa login, permission, workflow database, atau deployment production sudah lolos pengujian end-to-end.

Bukti terstruktur tersedia di `docs/qa/results.json`; output perintah asli ada di folder yang sama. Tidak ada mock database atau fallback data pada aplikasi. Transport pengujian hanya digunakan untuk menguji helper API secara terisolasi.

## Hasil perintah yang benar-benar dijalankan

| Pemeriksaan | Hasil nyata | Bukti dan cakupan |
|---|---|---|
| Instalasi dependency awal | Gagal: `EAI_AGAIN registry.npmjs.org` | `docs/qa/install-baseline.log`. |
| Instalasi dependency akhir | Batas eksekusi 30 detik tercapai; exit **124** | `docs/qa/install-final.log` dan `.exit`; tidak menghasilkan dependency tree yang siap atau lockfile baru. Log final dapat kosong karena proses berhenti sebelum npm menulis hasil. |
| `npm test` | **49 lulus, 0 gagal, 0 dilewati**; exit **0** | `docs/qa/tests-final.log`. Termasuk kompilasi TypeScript helper domain/API/config dan Node unit/source-contract tests. Bukan 49 skenario browser/live database. |
| `npm run check:source` | **Lulus**, exit **0** | 10 file TypeScript/TSX/JavaScript diparse; import relatif statis diperiksa; tidak menggantikan module resolution dependency atau typecheck penuh. |
| Kontrak SQL secara statis | **25 nama routine unik**, 13 nama RPC baru yang direferensikan ditemukan | Pemeriksaan nama, delimiter, dan larangan DDL destructive tertentu; **bukan validasi sintaks PostgreSQL, RLS, atau fungsi runtime**. |
| Identitas komponen visual | **8 deklarasi shared component/style cocok persis** dengan source unggahan | Hash teks: `docs/EXISTING_UI_FINGERPRINTS.json`. Ini tidak membuktikan kesamaan screenshot, layout seluruh halaman, atau responsive behavior. |
| `npm run typecheck` | **Gagal**, exit **2** | `docs/qa/typecheck-final.log`; React, ReactDOM, Supabase, SheetJS dan tipe terkait tidak terpasang, disertai error JSX/type inference. Error lain belum dapat dikesampingkan sampai dependency asli tersedia. |
| `npm run build` | **Gagal**, exit **2** | `docs/qa/build-final.log`. Berhenti pada mandatory typecheck; tahap bundling Vite belum berjalan. Tidak ada `dist` siap deploy. |
| Pemeriksaan CLI CSS terpisah | **Gagal**, exit **1** | `docs/qa/tailwind-final.log`. Tailwind global adalah 4.1.10 dan tidak menyediakan CLI Tailwind 3 yang digunakan project. Versi global tidak dipaksakan menggantikan stack existing. |
| JSON config | Parse berhasil | `package.json`, ketiga tsconfig, `vercel.json`, dan manifest PWA dibaca sebagai JSON. Ini bukan hasil validasi platform Vercel. |
| ESLint | Tidak dijalankan | Tidak ada konfigurasi/dependency ESLint existing; source check tidak dilabeli sebagai ESLint. |
| SQL integration dan catalog tests | **Belum dijalankan** | PostgreSQL/psql, schema existing, dan koneksi staging tidak tersedia. Script nyata tersedia di `supabase/tests/`. |
| Edge Function | Parse source saja | Deno check, deployment, undangan email, dan integrasi Auth belum diuji. |

Runtime pengujian: Node 22.16.0, npm 10.9.2, TypeScript preinstalled 5.8.3. Dependency project tidak diganti dengan shim untuk menghilangkan error.

## Cakupan 49 pengujian

**16 pengujian domain** mencakup keberadaan implementasi, progress 110% dan surplus, target nol, Qty positif integer tanpa pembulatan diam-diam, tanggal valid, batas hari Jakarta, rolling 7/30 hari, identitas lima dimensi plan, antrean hanya dihapus setelah acknowledgment, role tidak dikenal/nonaktif, teks Excel aman, batas filter/page, serta resolver master dengan code precedence, inactive code, nama ambigu, dan mixed-case code.

**16 pengujian helper API** mencakup keberadaan modul, filter database, pagination, penolakan tanggal/Qty tidak valid sebelum request, kegagalan simpan dan acknowledgment kosong, alasan penolakan, koreksi dengan expected_version tanpa mutasi optimistis, ekspor 1.250 baris dalam halaman terbatas, snapshot berubah, duplikat, data kosong, pembatasan 50.000 baris, serta respons snapshot tidak valid. Transport dikontrol pada unit test; tidak ada transaksi Supabase sungguhan pada pengujian ini.

**6 pengujian konfigurasi** mencakup modul, environment kosong, penolakan service-role JWT/secret key, URL berisi credential, batas HTTP lokal, dan perbedaan key public dengan bukti autentikasi.

**11 assertion kontrak source/security** memeriksa pemakaian tabel existing, nama RPC, pola pembatasan akses/version, larangan routine anonim tertentu, absennya ranking/tren terlarang, guard profil/legacy, model Factory incompatible, optimistic version, canonical references, authorization pada replay, refresh realtime, dan tombol MFA supervisor. Assertion teks tersebut **tidak membuktikan RLS tahan bypass**.

## Status implementasi menurut modul

| Requirement | Ada di source hasil perubahan | Bukti produksi/end-to-end |
|---|---|---|
| Analisis seluruh file unggahan | Ya; inventory dan audit repository disertakan | Schema live dan riwayat GitHub tidak tersedia. |
| Mempertahankan stack dan visual | React/Vite/Supabase/SheetJS dan delapan shared style/component dipertahankan | Perbandingan screenshot/mobile/tablet belum dilakukan. |
| Dashboard | Query agregat, filter periode/Factory, total/target/actual/progress dan ringkasan plan | Belum diuji dengan data Supabase nyata. |
| Input Produksi | Form existing, field lanjutan, Factory, submit ber-ID stabil, queue/error | Simpan, replay, dan data reload live belum diuji. |
| Data Produksi | Filter tanggal/produk/warna/shift/Factory/search/status, pagination database, total hasil filter | Query/RLS live dan browser belum diuji. |
| Verifikasi dan penolakan | Supervisor/Admin, alasan penolakan, expected_version, audit | Eksekusi SQL dan race antar pengguna belum diuji. |
| Koreksi | Alasan wajib, before/after, version check, kembali SUBMITTED untuk verifikasi ulang | Transaksi/audit live belum diuji. |
| Production Plan | Tanggal/Factory/produk/warna/shift/Qty/catatan, edit/nonaktif, pagination | Constraint unik dan matching live belum diuji. |
| Target harian, per shift, progress | Agregasi server, exact matching, actual VERIFIED; percentage tidak dipotong 100% | Aturan numerik unit lulus; agregat SQL belum dieksekusi. |
| Analisis Hari Ini/7/30/Per Produk | Satu fungsi AnalyticsPage existing diperbarui; tidak ada tren/ranking operator | Browser dan data live belum diuji. |
| Factory | Memakai kategori FACTORY pada master existing, status aktif/nonaktif dan assignment | Schema Factory asli harus dipastikan belum mempunyai model lain. |
| Pengguna | Admin role/status/Factory assignment, undangan native Supabase, akses MFA | Native invitation, Auth hook, MFA dan permission live belum diuji. |
| Log Aktivitas | Audit semantik transaksi, before/after, session event dengan identitas server | Trigger/policy existing dan immutability live belum diuji. |
| Produk/Warna/Shift/Factory | Master existing, code immutable, nama/status, metadata jam shift | FK/constraint dan historical reference live belum diuji. |
| Export Excel | Library XLSX existing, seluruh hasil filter dalam batas, kolom wajib dan advanced | Helper batching/unit lulus; actual browser download dan buka workbook belum diuji. |
| Migration/RLS/security | SQL implementasi, preflight catalog, guards, test catalog dan rollback workflow | **Belum divalidasi PostgreSQL atau Supabase**. |
| README/CHANGELOG/source/SQL | File nyata disertakan | Ketersediaan file bukan kelulusan build/deployment. |

## Risiko yang harus ditutup sebelum production

1. **Schema dan permission existing belum diinspeksi langsung.** Migration memakai kontrak yang dapat ditelusuri dari source dan berhenti pada mismatch yang dikenali. Guard tidak menjamin kompatibilitas seluruh constraint, trigger, view, grants, Auth hook, ataupun schema lain yang tidak disertakan.
2. **Perubahan otorisasi memiliki dampak luas.** Policies tujuh tabel inti diganti; akses browser ke RPC public `SECURITY DEFINER` lama dicabut, public views memakai `security_invoker`, dan akses browser ke materialized views dicabut. Fitur optional lama, custom invite links, atau hook yang tergantung kontrak/ACL sebelumnya dapat memerlukan penyesuaian. Source definisi optional masih dipertahankan, tetapi bukan janji kompatibilitas deployment. Jangan regrant RPC lama tanpa review.
3. **Data lama tidak dipalsukan sebagai VERIFIED atau diberi Factory/pemilik tebakan.** Record LEGACY/unmapped tetap tersimpan dan dapat direkonsiliasi Admin; visibility Operator/Supervisor dapat berkurang sampai mapping yang benar tersedia. Tidak ada backfill massal otomatis. Antrean lama yang tidak lengkap tidak dianggap berhasil atau dibuang otomatis.
4. **Role QC/Viewer/Auditor lama tidak otomatis dikonversi.** Core workflow baru membatasi role Admin/Supervisor/Operator. Akun legacy perlu keputusan akses eksplisit, bukan kenaikan role otomatis.
5. **Lockfile baru belum ada dan build gagal.** `docs/original-package-lock.json` hanya bukti, bukan lockfile aktif. Installer harus berhasil dengan dependency asli, menghasilkan lockfile reproducible, lalu full typecheck/build diuji. Pipeline GitHub memiliki gate lockfile, bukan bypass error.
6. **Tidak ada data production atau screenshot yang diuji.** RLS/performance, storage bucket, query lint, double-submit concurrent, multi-admin contention, auth recovery, MIME/download Excel, layout kecil, dan keyboard accessibility perlu pengujian nyata.
7. **Review dilakukan pada source di sesi ini, tanpa reviewer independen.** Tidak ada klaim audit keamanan formal atau hasil subagent yang tidak pernah dijalankan.

## Pengujian SQL yang disertakan tetapi belum dieksekusi

`supabase/preflight.sql` membaca catalog; `supabase/tests/01_catalog.sql` memeriksa objek, grants, RLS, constraints, indexes, dan pinned search_path setelah migration. `supabase/tests/02_workflow.psql` adalah workflow rollback untuk staging dengan empat test user existing yang berbeda; tidak membuat akun produksi, tidak memasukkan dummy data ke UI, dan tidak melakukan commit fixture.

Script workflow menggunakan role/database request claims pada koneksi administrator staging untuk menguji fungsi/RLS. Hal tersebut **bukan pengujian login atau verifikasi tanda tangan JWT**. Keduanya tetap perlu dilakukan dengan Supabase Auth sesungguhnya.

## Release gate yang belum lulus

- [ ] Instalasi dependency asli berhasil dan lockfile baru dikomit.
- [ ] Full TypeScript check dan Vite production build berhasil.
- [ ] Schema, policies, functions, triggers, Auth hook dan Storage existing diverifikasi.
- [ ] Migrasi, catalog assertions, dan rollback workflow lulus pada clone/staging.
- [ ] Login/MFA, seluruh workflow utama, export dan akses lintas Factory diuji end-to-end.
- [ ] Tampilan existing dibandingkan pada desktop, laptop, tablet, dan mobile.
- [ ] GitHub/Vercel Preview teruji sebelum rollout terkoordinasi.

**Tidak ada perubahan langsung pada Supabase production, GitHub remote, atau Vercel yang dilakukan dari sesi ini.**
