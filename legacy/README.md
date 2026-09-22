# Source referensi yang tidak di-deploy

`report-runner.ts` berasal dari unggahan `index.ts` (Deno laporan lama). Tidak diimpor frontend, tidak tercantum sebagai Edge Function aktif, dan tidak termasuk deployment `manage-users`. Agregasi/ranking operator dihapus sesuai scope. Integrasi eksternal yang sudah ada dalam source ini tidak diperluas atau diaktifkan.

Nama deployment asli dan trigger/cron database tidak disertakan dalam unggahan. Salinan source ini bukan bukti konfigurasi laporan production telah diubah; tidak ada koneksi live yang digunakan.
