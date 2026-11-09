# Peta Coverage & BTS

Aplikasi Node.js tanpa dependency tambahan untuk mengecek coverage dari dua API yang digunakan di `cek.php` dan menampilkan BTS pada peta Leaflet.

## Screenshot

![Tampilan peta Coverage & BTS](<./Browser Screenshot.png>)

## Menjalankan

Gunakan Node.js 18 atau lebih baru:

```powershell
npm start
```

Buka `http://localhost:3000`, lalu klik lokasi pada peta. Port dapat diubah dengan environment variable `PORT`.

Server mengirim koordinat ke API Starlite dan Internet Rakyat. Setiap BTS di peta dan setiap lokasi yang dipilih memiliki lingkaran coverage beradius 1 km. Semua BTS unik yang pernah muncul dalam respons disimpan secara lokal di browser dengan IndexedDB dan tetap tersedia setelah halaman dimuat ulang. Daftar **BTS Seen** menampilkan seluruh riwayat dan waktu terakhir terlihat; klik BTS untuk fokus pada peta. Tombol **Export CSV** mengunduh semua riwayat beserta ID, nama, kapasitas, koordinat, layanan, serta waktu pertama dan terakhir terlihat. Riwayat recent yang tersimpan dari versi sebelumnya dimigrasikan otomatis.
