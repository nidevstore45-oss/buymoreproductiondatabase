# Production BUYMORE Implementation Plan

**Goal:** Memperluas aplikasi unggahan tanpa mengganti stack, data, atau visual existing.
**Architecture:** Edit modul existing dan tambahkan helper domain/API yang dipakai bersama. Database menyimpan workflow dan melakukan agregasi berizin; frontend hanya merender hasil.
**Tech Stack:** React 18, TypeScript, Vite 5, Tailwind 3, Supabase, SheetJS.
**Spec:** ../specs/2026-09-21-production-design.md

## Global Constraints
Visual ID/CN, field input existing, export Excel, Supabase/GitHub/Vercel dipertahankan. Tidak ada database/cloud alternatif, dummy runtime, secret hardcoded, hard delete untuk koreksi, atau lima fitur yang dilarang.

## Review Focus
1. Data lama belum terpetakan: tetap terlihat oleh admin, tidak diasumsikan Factory atau verified.
2. Dua supervisor mengoreksi bersamaan: expected_version ditolak ketika stale.
3. Koneksi putus setelah commit: retry request ID sama tidak menambah transaksi kedua.
4. Pergantian filter saat request berjalan: respons usang tidak menimpa hasil baru.
5. Pengubahan nama master/nonaktif: riwayat tidak hilang; pencocokan menggunakan kode immutable.

## Tahapan pelaksanaan
- [x] Audit semua file, inventory tabel/RPC/komponen dan konflik dependency.
- [x] Domain: tests/domain.test.mjs, src/domain.ts; `tsc -p tsconfig.test.json && node --test tests/domain.test.mjs`.
- [x] Konfigurasi: src/supabase.ts, src/styles.css, index.html, PWA, package.json, .env.example; hilangkan credential fallback dan satukan Tailwind build.
- [x] Database: supabase/migrations/20260921000100_production_workflow.sql; guarded additive migration, kode master/FKs, scope Factory, RLS, RPC workflow/aggregate, audit, index.
- [x] API: src/production-api.ts; kontrak JSON filter/page/save/verify/correct/plan/master/user/export; validasi respons dan error.
- [x] UI existing: main.tsx; reuse chart/Card, perluas ProductionTargetsPage, MasterDataPage, UsersAndSecurityPage; perbaiki input/tabel/export/log; tambahkan Dashboard dan Factory memakai komponen existing.
- [x] QA lokal (batas dicatat; bukan release gate selesai): tests domain + source contracts, SQL regression script untuk clone Supabase, parser/typecheck/build attempts; catat bukti dan batas pengujian.
- [x] Dokumentasi dan paket kandidat (bukan persetujuan rilis): README_DEPLOYMENT.md, CHANGELOG.md, QA_REPORT.md, migration standalone dan ZIP.

## Catatan pelaksanaan
2026-09-21: npm install gagal EAI_AGAIN registry.npmjs.org; registry tidak terjangkau dari runtime. Jangan mengganti dependency dengan shim/mock atau menandai build lulus. Lanjutkan edit dan pengujian lokal yang tersedia.

2026-09-21 final QA: 49/49 unit/source-contract tests dan structural checks lulus; full typecheck/build gagal karena dependency tidak tersedia. SQL catalog/workflow disediakan tetapi belum dieksekusi. Checkbox Database/UI menunjukkan source ditulis, bukan integrasi production telah disahkan.
