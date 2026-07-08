# Play Store — Data safety : réponses à recopier

Aligné sur `docs/legal/privacy.md` (privacy policy live : https://www.useinbetween.com/privacy).
À saisir dans Play Console → **App content → Data safety**.

> Règle Google clé : transférer des données à un **sous-traitant** qui agit pour
> toi sous contrat (Supabase, OpenAI, Anthropic, AssemblyAI, Expo, Resend,
> Apple/Google) **n'est PAS considéré comme « partage »**. Donc partout ci-dessous :
> **Collected = Yes, Shared = No.** (Le Meta Pixel est sur le site web, pas dans
> l'app → hors périmètre Data safety de l'app.)

---

## 1. Questions d'ouverture

| Question | Réponse |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app **encrypted in transit**? | **Yes** (TLS/HTTPS) |
| Do you provide a way for users to **request deletion** of their data? | **Yes** |
| → Méthode de suppression (URL) | `https://www.useinbetween.com/privacy` (voir §8–9) ; demande par email **hello@useinbetween.com** ; suppression du compte sous 30 jours |

Aucune donnée utilisée pour du **suivi publicitaire / advertising** (pas de SDK pub dans l'app).

---

## 2. Types de données à déclarer

Pour **chaque** ligne : **Collected = Yes**, **Shared = No**, **Processed ephemerally = No**
(les données sont stockées). « Required/Optional » et « Purposes » ci-dessous.

### Personal info
| Donnée | Required/Optional | Purposes |
|---|---|---|
| **Name** | Required | App functionality, Account management |
| **Email address** | Required | App functionality, Account management, Developer communications |
| **User IDs** (id Supabase) | Required | App functionality, Account management, Analytics |
| **Other info** (rôle, dance style, studio, fréquence des cours) | Required | App functionality, Personalization |

> Mot de passe : stocké en **hash** pour l'authentification — pas de type dédié
> dans le formulaire Google, couvert par « Account management ». Rien à déclarer à part.

### Messages
| Donnée | Required/Optional | Purposes |
|---|---|---|
| **Other in-app messages** (messages élève↔coach, emails support) | Optional | App functionality |

### Photos and videos
| Donnée | Required/Optional | Purposes |
|---|---|---|
| **Photos** (photo de profil / avatar) | Optional | App functionality |
| **Videos** (clips vidéo dans les notes) | Optional | App functionality |

### Audio files
| Donnée | Required/Optional | Purposes |
|---|---|---|
| **Voice or sound recordings** (enregistrements de cours, notes vocales, audio DJI) | Optional | App functionality |

### App activity
| Donnée | Required/Optional | Purposes |
|---|---|---|
| **App interactions** (app_open / app_close / screen_view → table `user_events`) | Required | Analytics, App functionality |
| **Other user-generated content** (focus points, notes, takeaways, practices, attendance) | Optional | App functionality |

### Device or other IDs
| Donnée | Required/Optional | Purposes |
|---|---|---|
| **Device or other IDs** (token de notification push) | Optional | App functionality |

---

## 3. Ce qu'il ne faut PAS cocher (pour être exact)

- **Location** (approx/precise) — non.
- **Financial info** — non.
- **Health and fitness** — non (la privacy exclut les données de santé ; l'entraînement danse = user-generated content, pas « health/fitness » au sens Google).
- **Web browsing history** — non.
- **App info and performance** (Crash logs / Diagnostics) — **non** : aucun SDK
  de crash/diagnostic tiers dans l'app ; le `RootErrorBoundary` logge seulement
  en console locale, rien n'est envoyé.
- **Calendar, Contacts, Installed apps, Search history** — non.

---

## 4. Récap « Shared » et sécurité

- **Shared = No partout** : tous les destinataires sont des sous-traitants sous contrat.
- **Encryption in transit = Yes.**
- **Deletion = Yes** (email + suppression compte sous 30 jours, cf. privacy §8–9).

> Cohérence : le Data safety doit refléter la privacy policy. Ces réponses en
> sont la traduction directe — si tu modifies l'un, mets l'autre à jour.
