# Plan de travail — Rendre InBetween disponible sur Android (depuis la v1.7.0)

> État au moment de l'analyse : l'app est une app Expo / React Native (SDK 54,
> RN 0.81.5) **livrée uniquement sur iOS** (TestFlight). Le code JS est en
> grande partie cross-platform, mais tout le cœur « métier » de l'enregistrement
> repose sur **4 modules natifs Swift iOS-only**, et la chaîne de build/CI/submit
> est exclusivement Apple.

## 1. Constat — pourquoi Android n'est pas livrable en l'état

### 1.1 Bonne nouvelle : le socle JS ne crashe pas
Les ~17 branches `Platform.OS` du code sont correctement gérées (KeyboardAvoiding,
LayoutAnimation, canaux de notification, événements clavier). 3 des 4 modules
natifs renvoient `null` / no-op proprement hors iOS et sont enveloppés de
`try/catch` côté écran. **Donc l'app boote et se navigue sur Android.**

### 1.2 Mauvaise nouvelle : l'enregistrement (le cœur produit) ne marche pas
| Brique | Module / fichier | Comportement Android actuel |
|---|---|---|
| Capture continue | `continuous-audio-recorder` | `nativeModule()` **throw** hors iOS → fallback automatique vers `expo-audio` (pas de crash, mais voir §1.3) |
| Sélection du micro | `audio-route-picker` | renvoie `null` / `[]` → **picker de micro vide**, pas de sélection BT/USB |
| Widgets live | `live-activities` | renvoie `null` → pas de Dynamic Island (dégradation acceptable) |
| Import DJI (micro externe) | `local-recording-files` | `copyFileToCache()` / `transcodeToM4A()` **throw** hors iOS → **crash à l'upload** |

### 1.3 Enregistrement en arrière-plan : bloqueur de fond
- iOS : `UIBackgroundModes: ["audio"]` + `allowsBackgroundRecording: true`
  permettent d'enregistrer écran verrouillé.
- Android : il faut un **Foreground Service de type `microphone`** + les
  permissions associées, sinon l'OS coupe la capture dès que l'app passe en
  arrière-plan (Android 12+). **Rien de tout ça n'existe aujourd'hui.**

### 1.4 Bloqueurs de build / distribution
- `app.json` → section `android` **sans `package` ni `versionCode`**, permissions
  incomplètes (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`,
  `POST_NOTIFICATIONS` manquants).
- `eas.json` → **aucun `submit.production.android`** (pas de service account Play).
- CI → seul `.github/workflows/testflight.yml` (iOS, runner macOS). Aucun pipeline
  Android.
- `featureFlags.js` → `isLocalRecordingMode()` gaté par **email seulement** :
  si Loïc/Tanya se connectent sur Android, ils déclenchent le flux DJI qui crashe.

---

## 2. Décisions produit à trancher avant de coder

1. **Niveau de parité visé pour le MVP Android ?**
   - **Option A (recommandée)** : parité fonctionnelle sur l'enregistrement
     « téléphone » (capture micro intégré + Bluetooth standard), **sans** DJI ni
     Live Activities au lancement. → la plus rapide vers un build testable.
   - **Option B** : parité totale (DJI/SAF + équivalent Live Activities). →
     beaucoup plus long, voir §6.
2. **Canal de test Android** : EAS internal distribution (APK, gratuit, immédiat)
   pour démarrer, puis Play Store internal testing track (compte dev 25 $ one-shot).
3. **Stratégie recorder Android** : porter `continuous-audio-recorder` en Kotlin
   (qualité, contrôle des chunks) **ou** s'appuyer sur `expo-audio` + foreground
   service au début ? → recommandation : **expo-audio + foreground service** pour
   le MVP, port natif Kotlin en phase 2 si la rotation de chunks pose problème.

---

## 3. Phase 0 — Fondations build & garde-fous (≈ 3–5 j)

Objectif : produire un APK Android qui **boote, se navigue et ne crashe jamais**,
même si l'enregistrement n'est pas encore complet.

- [ ] `app.json` → ajouter `android.package` (`com.loicviatte.inbetweenapp`),
      `android.versionCode`, et les permissions :
      `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`.
- [ ] `featureFlags.js` → **gater `isLocalRecordingMode()` par `Platform.OS === 'ios'`**
      (sinon crash DJI pour Loïc/Tanya sur Android).
- [ ] Auditer chaque appel à `local-recording-files` et `audio-route-picker` :
      garantir un fallback explicite (pas seulement « renvoie null »), notamment
      `LocalUploadScreen`, `DjiSetupBanner`, `UploadFlowModal`, `useDjiAutoSync`.
- [ ] `eas.json` → vérifier que les profils `preview`/`development` produisent un
      APK Android (`distribution: internal`).
- [ ] Build EAS Android `preview` et installer l'APK sur un appareil réel.
- [ ] QA navigation complète (login, dashboard, écrans coach/élève) sans toucher
      à l'enregistrement.

**Livrable :** APK installable, app stable, DJI/Live Activities masqués sur Android.

---

## 4. Phase 1 — Enregistrement « téléphone » Android (MVP cœur) (≈ 2–4 sem)

Objectif : un coach peut enregistrer une classe sur Android, y compris écran
verrouillé, et les chunks remontent à `finalize-class` comme sur iOS.

- [ ] **Foreground Service microphone** (le bloqueur clé) :
      service natif Android (`foregroundServiceType="microphone"`) + notification
      persistante « Enregistrement en cours ». Via config plugin Expo
      (`expo-build-properties` / config plugin custom) ou module natif léger.
- [ ] **Permission `POST_NOTIFICATIONS`** demandée au runtime (Android 13+) dans
      `notifications.js`.
- [ ] **Backend de capture** : valider `expo-audio` sur Android avec rotation de
      chunks (start/stop) en foreground service. Mesurer si le bug type
      expo#21782 se reproduit ; sinon, planifier le port Kotlin (§5).
- [ ] **Sélection micro** : fallback Android pour `audio-route-picker` —
      a minima micro intégré + bascule Bluetooth via `AudioManager`
      (`startBluetoothSco`) ou liste système. UI de picker simplifiée.
- [ ] **Live Activities → dégradation** : sur Android, remplacer par la
      notification du foreground service (déjà présente). Vérifier que tous les
      `laStart/Update/End*` no-op proprement.
- [ ] QA terrain : classe complète, app en arrière-plan, écran verrouillé, appel
      entrant, casque BT branché/débranché en cours d'enregistrement.

**Livrable :** enregistrement fonctionnel bout-en-bout sur Android (micro téléphone/BT).

---

## 5. Phase 2 — Port natif du recorder (optionnel, si Phase 1 insuffisante) (≈ 4–6 sem)

À déclencher **seulement si** `expo-audio` + foreground service perd des chunks
ou dégrade la qualité.

- [ ] Module Kotlin `continuous-audio-recorder/android/` :
      `AudioRecord` (PCM brut) + `MediaCodec` (encodage AAC) + `HandlerThread`
      dédié à l'écriture fichier (équivalent de la `writeQueue` iOS).
- [ ] Rotation de chunks au niveau fichier (jamais arrêter `AudioRecord`).
- [ ] Gestion interruptions (appel entrant, changement de route) via
      `AudioManager.AudioRecordingCallback` / `BroadcastReceiver`.
- [ ] Aligner l'API JS (`start/stop/isRecording/chunkReady/error`) et déclarer
      `"platforms": ["ios", "android"]` dans `expo-module.config.json`.

**Livrable :** capture native robuste, parité qualité iOS.

---

## 6. Phase 3 — Import DJI / micro externe sur Android (optionnel, coûteux) (≈ 6–9 sem)

Uniquement si le mode local-recording doit exister sur Android.

- [ ] Port `local-recording-files/android/` via **Storage Access Framework**
      (`ACTION_OPEN_DOCUMENT_TREE`, `DocumentFile`) — équivalent des
      security-scoped bookmarks iOS (persistance via URI permission).
- [ ] Transcode WAV→M4A via `MediaCodec` / `MediaMuxer`.
- [ ] Détection branchement micro USB-C (`UsbManager` / route audio).
- [ ] Réactiver `isLocalRecordingMode()` sur Android (retirer le garde §3).

> ⚠️ SAF est nettement plus verbeux et fragile que l'API iOS ; à ne lancer que si
> le besoin métier Android est confirmé.

---

## 7. Phase 4 — CI/CD, store & rollout (≈ 1 sem, en parallèle)

- [ ] `eas.json` → `submit.production.android` (service account Play Store).
- [ ] Nouveau workflow `.github/workflows/play-store.yml` (runner `ubuntu-latest`,
      `eas build --platform android` + `eas submit`). Secret
      `PLAY_STORE_SERVICE_ACCOUNT_JSON`.
- [ ] Keystore : laisser EAS gérer (recommandé) ou keystore custom + secrets.
- [ ] Compte Google Play Developer (25 $ une fois) + fiche store + assets.
- [ ] Démarrer en **internal testing track**, puis closed → open.

---

## 8. Récapitulatif effort & séquencement recommandé

| Phase | Contenu | Effort | Bloquant pour livrer ? |
|---|---|---|---|
| 0 | Build + garde-fous | 3–5 j | ✅ oui |
| 1 | Enregistrement téléphone + foreground service | 2–4 sem | ✅ oui (cœur produit) |
| 4 | CI/CD + Play Store | ~1 sem (//) | ✅ oui (distribution) |
| 2 | Port natif Kotlin du recorder | 4–6 sem | ⚠️ conditionnel |
| 3 | DJI / SAF | 6–9 sem | ❌ optionnel |

**Chemin le plus court vers un MVP Android livrable : Phases 0 → 1 → 4**
(≈ 4–6 semaines pour 1 dev maîtrisant Expo + un peu de natif Android),
en repoussant DJI et le port natif du recorder.

---

## 9. Fichiers clés à toucher

| Fichier | Phase | Raison |
|---|---|---|
| `app.json` | 0 | `package`, `versionCode`, permissions Android |
| `src/services/featureFlags.js` | 0 | gater `isLocalRecordingMode` par plateforme |
| `eas.json` | 0/4 | profils APK + submit Play Store |
| `src/services/notifications.js` | 1 | permission `POST_NOTIFICATIONS` runtime |
| `src/screens/coach/StartClassScreen.js` | 1/2 | foreground service, fallback picker micro, recorder |
| `modules/continuous-audio-recorder/android/*` | 2 | port Kotlin (AudioRecord + MediaCodec) |
| `modules/audio-route-picker` | 1 | fallback Android sélection micro |
| `modules/local-recording-files/android/*` | 3 | import DJI via SAF |
| `.github/workflows/play-store.yml` | 4 | pipeline Android |
