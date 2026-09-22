# ANALYZE REPOSITORY — PRODUCTION BUYMORE

## Basis pemeriksaan

Seluruh 14 file unggahan dibaca sebelum perubahan. Inventory ukuran/hash/nama asli ada di `REPOSITORY_INVENTORY.json`. Lampiran terpisah tidak membawa `.git` history, folder structure lengkap, screenshot, schema dump, policies/triggers/RPC SQL, atau akun pengujian Supabase.

`main(4).tsx` adalah source UI monolitik, sekitar 9.724 baris sebelum perubahan. `index.ts` bukan entry browser: file ini adalah Deno/Supabase Edge report runner. `index.html` memuat `/main.tsx`. File yang berakhiran `(1)`/`(4)` merupakan nama upload; paket memakai nama canonical project. Tidak ada clone/push repository GitHub remote yang dilakukan.

## Framework dan build existing

Manifest menyatakan React 18, React DOM, Supabase JS 2, XLSX 0.18.5, Vite 5, TypeScript 5, plugin React 4, Tailwind 3, PostCSS, dan Autoprefixer. Lockfile tidak cocok: project name lain, Vite 7/plugin React 5/Lucide, Supabase tidak ada. Manifest menjadi basis kompatibilitas; framework tidak diganti. XLSX diperbarui memakai distribusi resmi library yang sama.

TypeScript original mengaktifkan `strict`, tetapi script build hanya menjalankan Vite. Config node memakai project reference. Paket memperluas source include, menggunakan module resolution Bundler dan menambahkan full typecheck sebelum build. Instalasi dependency belum dapat diselesaikan karena DNS registry tidak tersedia; tidak ada lockfile pengganti palsu.

## Halaman dan komponen yang ditemukan

| Area original | Implementasi / penanganan |
|---|---|
| ProductionSystem | Shell, login, bahasa, mode gelap, input/tabel/filter/export tetap menjadi root aplikasi. |
| AnalyticsPage | Fungsi yang sama ditingkatkan dengan agregasi server dan dipakai pula oleh Dashboard/Factory; versi all-record/tren/ranking tidak dipertahankan sebagai modul kedua. |
| ProductionTargetsPage | Modul target existing diperluas menjadi Production Plan berdimensi lengkap. |
| MasterDataPage | Tabel master_items yang sama, empat kategori utama termasuk Factory. |
| UsersAndSecurityPage | Role/status/Factory assignment, daftar pengguna paginated, MFA dan undangan native Supabase. |
| RecordDetailModal | Tetap dipakai untuk detail/lampiran/riwayat; menambah Factory, status, dan audit lama/baru. |
| InvitationSignupScreen, PasswordRecoveryScreen, MfaChallengeScreen, MfaManagement | Auth UI existing dibaca dan dipertahankan. Recovery/MFA dipakai; token invitation lama memerlukan review kompatibilitas RPC/hook. |
| QualityControlPage, WorkOrdersPage, ShiftClosingPage, ApprovalsAndTrashPage | Source original tetap ada; tidak diperluas dan tidak diberi menu utama baru. Relasi WO/batch/input lanjutan tetap didukung. |
| SavedFiltersControl, PresenceIndicator, AttachmentManager, AttachmentsLibraryPage | Pendukung original; schema/policies Storage/opsional belum tersedia untuk verifikasi live. |
| ScheduledReportsPage, OperationsOverviewPage, OperationsSuitePage | Source referensi opsional, bukan struktur navigasi delapan modul baru. Jangan mengaktifkan kembali RPC privileged tanpa review. |
| Code128Barcode, QrBarcodeScanner, printBarcodeLabel | Gaya/kemampuan barcode input original tidak diganti library lain. |
| Card, Button, FullSuite*, chart components | Design system existing dipakai kembali. Line chart/tren dan operator-ranking dikeluarkan sesuai larangan fitur. |

## Visual source yang dipertahankan

Root background `#E3E1E1`, putih/slate cards, blue/indigo primary gradient, emerald success/export, radius besar, font/typography original, mode gelap, header sticky horizontal, ID/CN, serta breakpoint kelas responsive menjadi basis implementasi. Tidak dibuat sidebar/template/tema pengganti.

Delapan deklarasi bersama memiliki hash source identik dengan unggahan: `Card`, `Button`, `FullSuiteBadge`, `FullSuiteStat`, `FullSuiteInput`, `FullSuiteModal`, `INPUT_CLASS`, `SMALL_BUTTON`. Ini bukti reuse source, **bukan** bukti seluruh screenshot pixel-identical atau pengujian mobile selesai. Screenshot referensi tidak ada, dan browser aplikasi penuh belum berjalan.

Manifest/service-worker unggahan kosong. Asset valid kini berada di `public/`; CDN Tailwind diganti build Tailwind lokal dari dependency original. Perubahan ini tidak mengubah palette/theme token, tetapi hasil render tetap perlu dibandingkan setelah full build.

## Database: fakta source, bukan tebakan DDL

| Tabel/view/bucket yang dipanggil original | Penggunaan source |
|---|---|
| `production_data` | Transaksi: date/time/product/color/shift/quantity/note/created_by, version, soft delete, request ID, WO/batch/machine/line/source/metadata. |
| `production_targets`, `v_production_target_progress` | Target lama dan pembacaan progres; rilis ini memakai production_targets dan RPC yang sama-sama berdasar tabel tersebut. |
| `profiles` | Identitas, email/full_name, role, active, language; role original memuat enam label. |
| `master_items` | Master kategori/code/name/is_active/metadata; tidak ada model Factory terpisah yang dapat dibuktikan dari source. |
| `activity_logs`, `app_login_events` | Audit/peristiwa sesi existing; tidak ada DDL trigger yang disertakan. |
| `app_settings`, `saved_filters`, `user_favorites` | Pengaturan, preset/filter, favorites. |
| `work_orders`, `production_batches`, `production_quality`, `shift_closures` | Modul operasi tambahan original. |
| `change_requests`, `app_invitations` | Workflow perubahan dan custom invitation original. |
| `attachments`, bucket `production-files` | Lampiran metadata/Supabase Storage. |
| `report_schedules`, `report_runs` | Laporan original; tidak diperluas/diaktifkan oleh paket baru. |

Source memanggil RPC seperti `admin_update_profile`, `create_user_invitation`, `get_public_invitation`, `revoke_user_invitation`, `request_production_note_change`, `request_production_delete`, `review_change_request`, `restore_production_record`, `purge_production_record`, `submit_shift_closure`, `set_shift_closure_status`, `run_report_schedules`, dan `update_my_language`. Definisi/ACL mereka **tidak** disertakan. Keberadaan nama dalam frontend bukan bukti keamanan atau keberhasilan server function.

Migration baru menambah kolom/reference pada tabel inti dan satu tabel assignment `buymore_user_factories`. Tidak membuat ulang tabel produksi, target, profile, atau tabel master per kategori. Guard menghentikan migration jika model Factory atau tipe yang nyata berbeda. Tidak ada data master/Factory/target contoh yang disisipkan.

## Authentication dan authorization

Autentikasi existing memakai Supabase Auth email/password, detect-session-in-URL, refresh token dan sessionStorage per tab; tersedia custom invitation/recovery/TOTP MFA. Source lama mempunyai fallback URL/anon key dan fallback profil. Paket menghilangkan fallback credential dan tidak memberi akses saat profile gagal.

Role inti ditetapkan sebagai Admin/Supervisor/Operator. Mapping Factory menjadi izin database; UI tidak digunakan sebagai satu-satunya pembatas. Mutasi memiliki check role/MFA/scope, lock/version, dan audit. Read aggregates memakai invoker/caller RLS. Policies/functions yang sudah terpasang pada database pengguna belum dapat diperiksa atau diuji; report tidak menyatakan live RLS lulus.

## Temuan yang ditangani

1. Lockfile/manifest berbeda dan build original tidak menjalankan typecheck.
2. Analisis mengunduh transaksi batch berulang sampai seluruh hasil terkumpul, kemudian menghitung di browser.
3. Tren produksi, kontribusi/best operator bertentangan dengan scope baru.
4. ProductionTargetsPage belum memuat Factory/Warna dan memakai limit lalu filter di client; target dihapus permanen.
5. Data Produksi/export/perhitungan rentan hanya melibatkan bagian data yang sudah dimuat.
6. Jalur mutasi dan permission perlu konsisten di database, bukan tombol saja; DDL existing belum tersedia.
7. Profil/cache/draft/queue harus dibatasi akun, dan unique-constraint error tidak boleh otomatis dianggap sukses.
8. Static PWA entry kosong/HTML head tidak rapi dan public-key fallback harus dihapus.

## Belum dapat dibuktikan

Tidak ada klaim bahwa semua tipe, trigger, foreign key, RLS, Auth hooks, Storage policies, data production, atau migration history existing sudah cocok. Tidak ada klaim login/simpan/export browser atau load test telah berhasil. `QA_REPORT.md` memisahkan hasil lokal nyata dari pemeriksaan yang masih terblokir. Paket yang lengkap secara file belum memenuhi release Definition of Done.
