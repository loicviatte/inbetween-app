# Publier InBetween en test Android (Play Store internal testing = équivalent TestFlight)

Objectif : des testeurs installent l'app depuis le Play Store via un lien d'opt-in,
comme sur TestFlight. Voici les étapes dans l'ordre.

> Rappel : c'est le **même code / même branche** que iOS. On ne fait que builder
> pour Android et le déposer sur le Play Store.

---

## Vue d'ensemble (une seule fois, puis ~10 min par mise à jour)

| Bloc | Ce que ça fait | Récurrent ? |
|---|---|---|
| 0. Comptes | Compte Google Play Developer (25 $ une fois) | Une fois |
| 1. Créer l'app dans Play Console | Déclare l'app + fiche minimale | Une fois |
| 2. Déclarations obligatoires | Politique de confidentialité, data safety, classification | Une fois |
| 3. Build AAB (EAS) | Génère le fichier signé `.aab` | À chaque version |
| 4. Signing | Google gère la clé (Play App Signing), EAS la clé d'upload | Auto |
| 5. Track "Internal testing" | Upload + liste de testeurs + lien | À chaque version |
| 6. (auto) Service account | Permet `eas submit` sans upload manuel | Une fois |

---

## Étape 0 — Compte développeur (une fois, 25 $)

1. Va sur https://play.google.com/console
2. Crée un compte développeur (**25 $, paiement unique, pas d'abonnement**).
3. Choisis un compte **Organisation** si c'est pour une entreprise (sinon perso).
   La validation d'identité peut prendre 1–2 jours.

## Étape 1 — Créer l'application dans la Play Console (une fois)

1. Play Console → **Create app**.
2. Renseigne : nom (`InBetween`), langue par défaut, type = **App**, **Free**.
3. Accepte les déclarations.
4. Le **package name** doit être `com.loicviatte.inbetweenapp` (déjà mis dans `app.json`).
   ⚠️ Il est **définitif** une fois la première release publiée — ne pas le changer.

## Étape 2 — Remplir les déclarations obligatoires (une fois)

Play Console bloque la publication tant que ce n'est pas fait (menu **App content**) :

- **Privacy policy URL** : une URL publique. Le contenu existe déjà dans
  `docs/legal/privacy.md` — il faut l'héberger quelque part (site, GitHub Pages…)
  et coller le lien.
- **Data safety** : formulaire déclarant les données collectées. Pour InBetween :
  micro/audio (enregistrement), email/compte (auth Supabase), éventuellement
  notifications. À remplir honnêtement.
- **Content rating** : questionnaire (l'app n'a pas de contenu sensible → note basse).
- **Target audience** : public visé (adultes).
- **Ads** : déclarer « pas de pub » si c'est le cas.

> Pour l'**internal testing** uniquement, certaines de ces sections peuvent être
> allégées, mais autant les faire tout de suite — elles seront exigées ensuite.

## Étape 3 — Générer le build Android signé (AAB)

Le Play Store exige un **`.aab`** (Android App Bundle), pas un APK.

Sur ta machine, dans le projet, sur la branche à jour :

```bash
npm install -g eas-cli      # si besoin
eas login
eas build --platform android --profile production
```

- EAS build dans le cloud (~10–15 min) et te donne un fichier **`.aab`** à télécharger.
- **La toute première fois**, EAS te demande de générer un **keystore** (la clé de
  signature). Réponds **oui, laisse EAS le gérer** — il le stocke et le réutilise.
  ⚠️ Ne perds jamais ce keystore : c'est lui qui permet de mettre à jour l'app.

## Étape 4 — Signature (rien à faire, juste comprendre)

- **Play App Signing** : Google détient la clé finale de l'app, EAS ne fournit
  qu'une **clé d'upload**. C'est le mode par défaut recommandé, activé
  automatiquement au premier upload. Aucune action manuelle.

## Étape 5 — Créer la release "Internal testing" et inviter les testeurs

Dans Play Console :

1. Menu **Testing → Internal testing**.
2. **Create new release**.
3. **Upload** le fichier `.aab` généré à l'étape 3.
4. Renseigne un nom de version + notes de version.
5. **Save → Review release → Start rollout to Internal testing**.
6. Onglet **Testers** :
   - Crée une liste d'emails (jusqu'à **100 testeurs**) ou un Google Group.
   - Chaque testeur doit avoir un **compte Google** (l'email d'invitation = son
     compte Play Store).
7. Copie le **lien d'opt-in** ("Copy link") et envoie-le aux testeurs.
   - Ils ouvrent le lien → "Become a tester" → installent InBetween depuis le
     Play Store, exactement comme TestFlight.

> L'internal testing est **quasi instantané** : pas de revue Google (contrairement
> à la production). La build est dispo pour les testeurs en quelques minutes.

## Étape 6 (recommandé) — Automatiser les uploads avec `eas submit`

Pour ne plus uploader le `.aab` à la main à chaque version :

1. Play Console → **Setup → API access** → crée un **service account** (via Google
   Cloud), donne-lui le rôle **Release manager**, télécharge le **JSON**.
2. Place le JSON hors du repo (ne jamais le committer) et référence-le dans `eas.json` :
   ```json
   "submit": {
     "production": {
       "android": {
         "serviceAccountKeyPath": "./play-service-account.json",
         "track": "internal"
       }
     }
   }
   ```
3. Ensuite, publier une version =
   ```bash
   eas build --platform android --profile production
   eas submit --platform android --profile production
   ```

---

## Notifications push (à faire en parallèle — voir aussi ce repo)

Le test fonctionne **sans** ça, mais les push n'arriveront pas tant que **FCM**
n'est pas configuré :
1. Projet Firebase + app Android `com.loicviatte.inbetweenapp`.
2. Télécharger `google-services.json`.
3. L'ajouter au projet (`app.json` → `android.googleServicesFile`) + uploader la clé
   FCM V1 dans EAS (`eas credentials`).
→ Donne-moi le `google-services.json` et je câble cette partie.

---

## Résumé "chemin le plus court vers des testeurs"

1. Payer le compte Google Play (25 $) — **toi**
2. Créer l'app + package `com.loicviatte.inbetweenapp` — **toi**
3. Remplir privacy policy + data safety — **toi** (contenu privacy déjà écrit)
4. `eas build --platform android --profile production` → `.aab` — **toi**
5. Internal testing → upload `.aab` → ajouter emails testeurs → partager le lien — **toi**

Le code est déjà prêt côté build. Les blocages restants sont **administratifs**
(compte, déclarations), pas techniques.
