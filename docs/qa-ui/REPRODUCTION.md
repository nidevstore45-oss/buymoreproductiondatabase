# Reproduksi QA dan batasnya

Tes yang ikut repository: `npm test` dan `npm run check:source`. Keduanya tetap berjalan di pipeline existing setelah dependency asli terinstal. `npm run build` tidak diubah menjadi transpile-only.

`browser-components.json` berasal dari harness lokal terisolasi yang mengekstrak AppShell, ResponsiveTable, FullSuiteInput dan FullSuiteModal aktual serta helper mereka. React/ReactDOM 18.2.0 lokal, TypeScript transpiler, dan Chromium digunakan; tidak ada pengganti Supabase atau vendor test yang dimasukkan ke runtime aplikasi. Policy menolak HTTP navigation lokal, sehingga fixture dirender inline. Lihat QA_UI_UPDATE.md sebelum menafsirkan screenshot atau hasil browser.

Untuk acceptance melalui build sesungguhnya, jalankan project dengan dependency asli dan project Supabase staging existing. Periksa seluruh 46 perilaku DOM/layout yang dinamai dalam JSON, lalu login dan kunjungi semua menu dengan tiga role. Periksa filter/reload cache, pergantian Factory/role, expiry lease, kegagalan jaringan, mutasi gagal, dan ekspor live. Ini adalah pemeriksaan lanjutan yang **belum dinyatakan lulus** oleh paket.

File berakhiran red dan log integration lama merekam kegagalan pengembangan sebelum perbaikan. `tests-final.log`, `source-check.json`, `browser-components.json`, `typecheck-final.log`, dan `build-final.log` adalah hasil run akhir pada revisi ini.
