/**
 * API DIAGNOSTIC
 * 
 * Outil de diagnostic pour vérifier la configuration des APIs
 * Accessible uniquement au Président
 */

import React, { useState } from 'react';
import { db } from '../firebaseConfig';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { getGoogleMapsApiKey, geocodeAddress, isGMPROConfigured } from '../services/gmproService';
import {
  Wifi, WifiOff, CheckCircle, XCircle, Loader2, AlertTriangle,
  RefreshCw, Server, Map, Database, Key, Globe, Zap, Clock
} from 'lucide-react';

interface TestResult {
  name: string;
  status: 'pending' | 'running' | 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
  duration?: number;
}

const ApiDiagnostic: React.FC = () => {
  const [tests, setTests] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const updateTest = (name: string, update: Partial<TestResult>) => {
    setTests(prev => prev.map(t => t.name === name ? { ...t, ...update } : t));
  };

  const runAllTests = async () => {
    setIsRunning(true);

    const initialTests: TestResult[] = [
      { name: 'firebase_connection', status: 'pending', message: 'Connexion Firestore' },
      { name: 'firebase_read', status: 'pending', message: 'Lecture Firestore (vehicles)' },
      { name: 'firebase_collections', status: 'pending', message: 'Collections missions' },
      { name: 'env_google_key', status: 'pending', message: 'Clé API Google Maps' },
      { name: 'env_project_id', status: 'pending', message: 'Google Cloud Project ID' },
      { name: 'geocoding_api', status: 'pending', message: 'API Geocoding Google' },
      { name: 'geocoding_reunion', status: 'pending', message: 'Geocoding La Réunion' },
      { name: 'hubs_coordinates', status: 'pending', message: 'Coordonnées des hubs' },
      { name: 'route_optimization', status: 'pending', message: 'API Route Optimization (GMPRO)' },
      { name: 'vercel_env', status: 'pending', message: 'Variables Vercel' },
    ];

    setTests(initialTests);

    // --- Test 1: Firebase Connection ---
    updateTest('firebase_connection', { status: 'running' });
    const t1Start = Date.now();
    try {
      await getDocs(query(collection(db, 'vehicles'), limit(1)));
      updateTest('firebase_connection', {
        status: 'success',
        message: 'Connexion Firestore OK',
        duration: Date.now() - t1Start
      });
    } catch (err: any) {
      updateTest('firebase_connection', {
        status: 'error',
        message: 'Connexion Firestore échouée',
        detail: err.message,
        duration: Date.now() - t1Start
      });
    }

    // --- Test 2: Firebase Read (vehicles) ---
    updateTest('firebase_read', { status: 'running' });
    const t2Start = Date.now();
    try {
      const snap = await getDocs(collection(db, 'vehicles'));
      const count = snap.docs.length;
      const withDriver = snap.docs.filter(d => d.data().driverId).length;
      updateTest('firebase_read', {
        status: count > 0 ? 'success' : 'warning',
        message: `${count} véhicules trouvés, ${withDriver} avec chauffeur assigné`,
        detail: count === 0 ? 'Aucun véhicule en base' : undefined,
        duration: Date.now() - t2Start
      });
    } catch (err: any) {
      updateTest('firebase_read', {
        status: 'error',
        message: 'Lecture véhicules échouée',
        detail: err.message,
        duration: Date.now() - t2Start
      });
    }

    // --- Test 3: Collections missions ---
    updateTest('firebase_collections', { status: 'running' });
    const t3Start = Date.now();
    try {
      const cols = ['missions', 'packages', 'hubs', 'import_batches'];
      const results: string[] = [];
      for (const col of cols) {
        const snap = await getDocs(query(collection(db, col), limit(1)));
        results.push(`${col}: ${snap.size > 0 ? '✓' : '∅'}`);
      }
      updateTest('firebase_collections', {
        status: 'success',
        message: results.join(' | '),
        duration: Date.now() - t3Start
      });
    } catch (err: any) {
      updateTest('firebase_collections', {
        status: 'error',
        message: 'Erreur lecture collections',
        detail: err.message,
        duration: Date.now() - t3Start
      });
    }

    // --- Test 4: Google Maps API Key ---
    updateTest('env_google_key', { status: 'running' });
    const apiKey = getGoogleMapsApiKey();
    if (apiKey) {
      const masked = apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4);
      updateTest('env_google_key', {
        status: 'success',
        message: `Clé configurée: ${masked}`,
        detail: `Longueur: ${apiKey.length} caractères`
      });
    } else {
      updateTest('env_google_key', {
        status: 'error',
        message: 'VITE_GOOGLE_MAPS_API_KEY non définie',
        detail: 'Ajouter dans Vercel > Settings > Environment Variables > VITE_GOOGLE_MAPS_API_KEY'
      });
    }

    // --- Test 5: Google Cloud Project ID ---
    updateTest('env_project_id', { status: 'running' });
    const projectId = import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_ID;
    if (projectId) {
      updateTest('env_project_id', {
        status: 'success',
        message: `Project ID: ${projectId}`
      });
    } else {
      updateTest('env_project_id', {
        status: 'warning',
        message: 'VITE_GOOGLE_CLOUD_PROJECT_ID non défini',
        detail: 'Fallback sur "fleetgenius-app". Ajouter dans Vercel si nécessaire.'
      });
    }

    // --- Test 6: Geocoding API ---
    updateTest('geocoding_api', { status: 'running' });
    const t6Start = Date.now();
    if (!apiKey) {
      updateTest('geocoding_api', {
        status: 'error',
        message: 'Test impossible sans clé API',
        duration: 0
      });
    } else {
      try {
        const result = await geocodeAddress('1 rue de la gare', 'Le Port', '97420', apiKey);
        if (result) {
          updateTest('geocoding_api', {
            status: 'success',
            message: `Geocoding OK — Le Port: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`,
            duration: Date.now() - t6Start
          });
        } else {
          updateTest('geocoding_api', {
            status: 'error',
            message: 'Geocoding échoué pour adresse test (Le Port 97420)',
            detail: 'Vérifier que l\'API Geocoding est activée dans Google Cloud Console > APIs & Services',
            duration: Date.now() - t6Start
          });
        }
      } catch (err: any) {
        updateTest('geocoding_api', {
          status: 'error',
          message: 'Erreur appel Geocoding',
          detail: err.message,
          duration: Date.now() - t6Start
        });
      }
    }

    // --- Test 7: Geocoding La Réunion ---
    updateTest('geocoding_reunion', { status: 'running' });
    const t7Start = Date.now();
    if (!apiKey) {
      updateTest('geocoding_reunion', {
        status: 'error',
        message: 'Test impossible sans clé API',
        duration: 0
      });
    } else {
      try {
        const result = await geocodeAddress('1 rue Maréchal Leclerc', 'Saint-Denis', '97400', apiKey);
        if (result && result.lat > -22 && result.lat < -20 && result.lng > 55 && result.lng < 56) {
          updateTest('geocoding_reunion', {
            status: 'success',
            message: `La Réunion OK — Saint-Denis: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`,
            duration: Date.now() - t7Start
          });
        } else if (result) {
          updateTest('geocoding_reunion', {
            status: 'warning',
            message: `Coordonnées hors La Réunion: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`,
            detail: 'L\'API renvoie un résultat mais pas à La Réunion — vérifier les adresses',
            duration: Date.now() - t7Start
          });
        } else {
          updateTest('geocoding_reunion', {
            status: 'error',
            message: 'Geocoding échoué pour Saint-Denis (97400)',
            detail: 'L\'API ne trouve pas les adresses de La Réunion',
            duration: Date.now() - t7Start
          });
        }
      } catch (err: any) {
        updateTest('geocoding_reunion', {
          status: 'error',
          message: 'Erreur geocoding Réunion',
          detail: err.message,
          duration: Date.now() - t7Start
        });
      }
    }

    // --- Test 8: Hubs coordinates ---
    updateTest('hubs_coordinates', { status: 'running' });
    try {
      const hubSnap = await getDocs(collection(db, 'hubs'));
      const hubs = hubSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const activeHubs = hubs.filter(h => h.isActive);
      const withCoords = activeHubs.filter(h => h.coordinates?.lat && h.coordinates?.lng);
      const withoutCoords = activeHubs.filter(h => !h.coordinates?.lat || !h.coordinates?.lng);

      if (activeHubs.length === 0) {
        updateTest('hubs_coordinates', {
          status: 'warning',
          message: 'Aucun hub actif trouvé',
          detail: 'Créez un hub dans Missions > Hubs'
        });
      } else if (withoutCoords.length > 0) {
        const names = withoutCoords.map((h: any) => h.name).join(', ');
        updateTest('hubs_coordinates', {
          status: 'warning',
          message: `${withCoords.length}/${activeHubs.length} hubs ont des coordonnées`,
          detail: `Sans coordonnées: ${names} — Re-sauvegardez ces hubs pour déclencher le géocodage`
        });
      } else {
        updateTest('hubs_coordinates', {
          status: 'success',
          message: `${activeHubs.length} hub(s) actif(s), tous avec coordonnées GPS`
        });
      }
    } catch (err: any) {
      updateTest('hubs_coordinates', {
        status: 'error',
        message: 'Erreur lecture hubs',
        detail: err.message
      });
    }

    // --- Test 9: Route Optimization API ---
    updateTest('route_optimization', { status: 'running' });
    const t9Start = Date.now();
    if (!apiKey) {
      updateTest('route_optimization', {
        status: 'error',
        message: 'Test impossible sans clé API',
        duration: 0
      });
    } else {
      try {
        const testRequest = {
          model: {
            shipments: [{
              deliveries: [{
                arrivalLocation: { latLng: { latitude: -20.88, longitude: 55.45 } },
                duration: '300s'
              }]
            }],
            vehicles: [{
              startLocation: { latLng: { latitude: -20.90, longitude: 55.53 } },
              endLocation: { latLng: { latitude: -20.90, longitude: 55.53 } }
            }]
          }
        };
        const gmproProjectId = import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_ID || 'fleetgenius-app';
        const gmproResp = await fetch(
          `https://routeoptimization.googleapis.com/v1/projects/${gmproProjectId}:optimizeTours`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey
            },
            body: JSON.stringify(testRequest)
          }
        );
        
        if (gmproResp.ok) {
          const gmproData = await gmproResp.json();
          const hasRoute = gmproData.routes && gmproData.routes.length > 0;
          updateTest('route_optimization', {
            status: 'success',
            message: `Route Optimization OK${hasRoute ? ' — route calculée' : ''}`,
            duration: Date.now() - t9Start
          });
        } else {
          const errData = await gmproResp.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${gmproResp.status}`;
          const isNotEnabled = errMsg.includes('not been used') || errMsg.includes('disabled') || errMsg.includes('PERMISSION_DENIED');
          updateTest('route_optimization', {
            status: 'error',
            message: isNotEnabled 
              ? 'Route Optimization API non activée'
              : `Route Optimization échoué: ${errMsg.substring(0, 100)}`,
            detail: isNotEnabled
              ? 'Google Cloud Console → APIs & Services → Library → chercher "Route Optimization API" → Enable'
              : `Réponse: ${errMsg.substring(0, 200)}`,
            duration: Date.now() - t9Start
          });
        }
      } catch (err: any) {
        updateTest('route_optimization', {
          status: 'error',
          message: 'Erreur appel Route Optimization',
          detail: err.message,
          duration: Date.now() - t9Start
        });
      }
    }

    // --- Test 10: Vercel Environment ---
    updateTest('vercel_env', { status: 'running' });
    const firebaseKey = import.meta.env.VITE_FIREBASE_API_KEY;
    const firebaseProject = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const envVars = [
      { name: 'FIREBASE_API_KEY', ok: !!firebaseKey },
      { name: 'FIREBASE_PROJECT_ID', ok: !!firebaseProject },
      { name: 'GOOGLE_MAPS_API_KEY', ok: !!apiKey },
      { name: 'GOOGLE_CLOUD_PROJECT_ID', ok: !!projectId },
    ];
    const missing = envVars.filter(v => !v.ok);
    if (missing.length === 0) {
      updateTest('vercel_env', {
        status: 'success',
        message: 'Toutes les variables d\'environnement sont configurées'
      });
    } else {
      updateTest('vercel_env', {
        status: missing.some(m => m.name.includes('FIREBASE')) ? 'error' : 'warning',
        message: `${envVars.length - missing.length}/${envVars.length} variables configurées`,
        detail: `Manquantes: ${missing.map(m => 'VITE_' + m.name).join(', ')}`
      });
    }

    setIsRunning(false);
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'pending': return <div className="w-5 h-5 rounded-full border-2 border-slate-300" />;
      case 'running': return <Loader2 size={20} className="text-blue-500 animate-spin" />;
      case 'success': return <CheckCircle size={20} className="text-green-500" />;
      case 'warning': return <AlertTriangle size={20} className="text-amber-500" />;
      case 'error': return <XCircle size={20} className="text-red-500" />;
    }
  };

  const getStatusBg = (status: TestResult['status']) => {
    switch (status) {
      case 'success': return 'bg-green-50 border-green-200';
      case 'warning': return 'bg-amber-50 border-amber-200';
      case 'error': return 'bg-red-50 border-red-200';
      default: return 'bg-white border-slate-200';
    }
  };

  const successCount = tests.filter(t => t.status === 'success').length;
  const warningCount = tests.filter(t => t.status === 'warning').length;
  const errorCount = tests.filter(t => t.status === 'error').length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Server size={22} className="text-brand-500" />
            Diagnostic API & Services
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Vérifiez que toutes les connexions et APIs fonctionnent correctement
          </p>
        </div>
        <button
          onClick={runAllTests}
          disabled={isRunning}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
        >
          {isRunning ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Tests en cours...
            </>
          ) : (
            <>
              <Zap size={18} />
              Lancer le diagnostic
            </>
          )}
        </button>
      </div>

      {/* Résumé */}
      {tests.length > 0 && !isRunning && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-xl p-4 text-center border border-green-200">
            <CheckCircle size={24} className="mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold text-green-700">{successCount}</p>
            <p className="text-xs text-green-600">OK</p>
          </div>
          <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-200">
            <AlertTriangle size={24} className="mx-auto text-amber-500 mb-1" />
            <p className="text-2xl font-bold text-amber-700">{warningCount}</p>
            <p className="text-xs text-amber-600">Attention</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4 text-center border border-red-200">
            <XCircle size={24} className="mx-auto text-red-500 mb-1" />
            <p className="text-2xl font-bold text-red-700">{errorCount}</p>
            <p className="text-xs text-red-600">Erreurs</p>
          </div>
        </div>
      )}

      {/* Résultats */}
      {tests.length > 0 ? (
        <div className="space-y-3">
          {tests.map((test) => (
            <div
              key={test.name}
              className={`rounded-xl border p-4 transition-all ${getStatusBg(test.status)}`}
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(test.status)}
                <div className="flex-1">
                  <p className="font-medium text-slate-800">{test.message}</p>
                  {test.detail && (
                    <p className="text-sm text-slate-600 mt-1">{test.detail}</p>
                  )}
                </div>
                {test.duration !== undefined && (
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock size={12} />
                    {test.duration}ms
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Server size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500 mb-2">Cliquez sur "Lancer le diagnostic" pour vérifier</p>
          <p className="text-sm text-slate-400">
            Firebase, Google Maps API, Geocoding, Hubs, Variables d'environnement
          </p>
        </div>
      )}

      {/* Guide de résolution */}
      {errorCount > 0 && (
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
          <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
            <Key size={18} />
            Guide de résolution
          </h3>
          <div className="space-y-3 text-sm text-slate-700">
            <div className="flex gap-3">
              <Globe size={16} className="shrink-0 mt-0.5 text-blue-500" />
              <div>
                <p className="font-medium">Clé API Google Maps manquante</p>
                <p className="text-slate-500">
                  1. Aller sur <span className="font-mono bg-slate-200 px-1 rounded">console.cloud.google.com</span><br/>
                  2. APIs & Services → Credentials → Create API Key<br/>
                  3. Ajouter dans Vercel: Settings → Environment Variables → <span className="font-mono bg-slate-200 px-1 rounded">VITE_GOOGLE_MAPS_API_KEY</span><br/>
                  4. Redéployer
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Map size={16} className="shrink-0 mt-0.5 text-green-500" />
              <div>
                <p className="font-medium">APIs Google à activer</p>
                <p className="text-slate-500">
                  Dans Google Cloud Console → APIs & Services → Library, activer :<br/>
                  • <strong>Geocoding API</strong> (conversion adresse → coordonnées)<br/>
                  • <strong>Route Optimization API</strong> (optimisation des tournées)<br/>
                  • <strong>Directions API</strong> (optionnel, pour le calcul de distance)
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Database size={16} className="shrink-0 mt-0.5 text-purple-500" />
              <div>
                <p className="font-medium">Hubs sans coordonnées</p>
                <p className="text-slate-500">
                  Allez dans Missions → Hubs → Ouvrir chaque hub → Sauvegarder.<br/>
                  Le géocodage se fait automatiquement à chaque sauvegarde.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiDiagnostic;
