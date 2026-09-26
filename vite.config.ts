import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }
const { version } = pkg;

// https://vitejs.dev/config/
// Identifiant unique de build (horodatage) → permet à l'app de détecter
// qu'une nouvelle version est en ligne et de se recharger automatiquement.
const BUILD_ID = String(Date.now());

// Plugin : écrit /version.json à la racine du build avec le BUILD_ID courant.
const emitVersionPlugin = () => ({
  name: 'emit-version-json',
  generateBundle() {
    // @ts-ignore - API rollup disponible dans ce hook
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId: BUILD_ID, version }) });
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), emitVersionPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_ID__: JSON.stringify(BUILD_ID),
      __BUILD_DATE__: JSON.stringify(new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }))
    },
    build: {
      // Firebase est volumineux - on relève la limite
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('/node_modules/')) return;
            if (/\/(?:@firebase|firebase)\//.test(id)) return 'vendor-firebase';
            if (/\/(?:react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            if (id.includes('/xlsx/')) return 'vendor-xlsx';
            if (id.includes('/html5-qrcode/')) return 'vendor-scanner';
            if (/\/(?:leaflet|react-leaflet)\//.test(id)) return 'vendor-maps';
          }
        }
      }
    }
  }
})
