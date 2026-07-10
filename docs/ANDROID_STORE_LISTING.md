# Fiche Play Store — brouillon (à relire / adapter)

Éléments demandés par la Play Console pour la fiche. Les textes ci-dessous sont
des brouillons à ajuster ; les visuels doivent être générés depuis un build
Android réel (voir `ANDROID_PLAY_STORE_TESTING.md`).

## Textes

**Nom de l'app** (30 car. max)
```
InBetween
```

**Description courte** (80 car. max)
```
Vos cours, vos points de travail et vos progrès — suivis au même endroit.
```
> ⚠️ À adapter au positionnement exact (coaching / danse / etc.).

**Description complète** (4000 car. max) — brouillon
```
InBetween relie élèves et coachs autour d'un même fil : ce qui compte entre
deux cours. Notez vos points de travail, suivez vos progrès et gardez une
trace claire de chaque session.

• Suivez vos points de travail (focus points) d'une séance à l'autre
• Retrouvez l'historique de vos cours et vos notes
• Restez connecté à votre coach entre les séances

Pensée pour être simple, rapide et concentrée sur l'essentiel.
```

## Visuels (à produire depuis un appareil Android)

| Asset | Contrainte | Statut |
|---|---|---|
| Icône | 512×512 PNG (déjà : `assets/icon.png` en haute def) | ✅ dispo |
| Feature graphic | 1024×500 PNG | ⏳ à créer |
| Captures téléphone | min. 2, ratio 16:9 ou 9:16, ≥ 320px | ⏳ depuis le build Android |

> Astuce : une fois l'APK installé (étape build), fais 3–4 captures d'écran des
> écrans clés (accueil/TRAIN, un cours, un focus point) directement sur le
> téléphone Android.

## Déclarations (menu App content)

- **Privacy policy URL** : héberger `docs/legal/privacy.md` (ex. GitHub Pages) → coller l'URL.
- **Data safety** : déclarer micro/audio (enregistrement), email/compte (auth).
- **Content rating** : questionnaire → note basse attendue.
- **Target audience** : adultes.
- **Ads** : non.
