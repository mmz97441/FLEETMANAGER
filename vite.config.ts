import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY)
    },
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
  }
})