import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Portrait-first camera app. getUserMedia requires a secure context, so the dev
// server runs over HTTPS (self-signed) — that lets a phone on the same LAN reach
// https://<your-lan-ip>:5173 with the camera enabled. The phone will show a
// one-time "connection not private" warning for the self-signed cert; accept it.
// `host: true` binds all interfaces so the LAN URL is printed on `npm run dev`.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
});
