import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Firebase est volumineux - on relève la limite
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // === Vendors séparés pour cache navigateur optimal ===
          'vendor-react': ['react', 'react-dom'],
          'vendor-firebase': [
            'firebase/app',
            'firebase/firestore',
            'firebase/auth',
            'firebase/storage',
            'firebase/functions'
          ],
          'vendor-charts': ['recharts'],
          'vendor-maps': ['leaflet', 'react-leaflet'],
          'vendor-xlsx': ['xlsx'],
          'vendor-ui': ['lucide-react'],
          'vendor-scanner': ['html5-qrcode'],
          'vendor-barcode': ['jsbarcode'],
        }
      }
    }
  }
})
