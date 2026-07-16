import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_DATE__: JSON.stringify(new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }))
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