# Générateur de QR-Code Moderne

Un générateur de QR-code élégant et moderne créé avec HTML, CSS et JavaScript pur.

## ✨ Fonctionnalités

- 🎨 **Design moderne** avec effets glassmorphism et animations fluides
- 🚀 **Génération instantanée** de QR-codes à partir d'URLs
- 📱 **Interface responsive** adaptée à tous les appareils
- 💾 **Téléchargement** du QR-code en image PNG haute qualité
- ✅ **Validation en temps réel** des URLs
- 🎯 **UX optimisée** avec micro-animations et feedback visuel
- ♿ **Accessible** avec support clavier et ARIA labels

## 🚀 Utilisation

1. Démarrez le backend sur le port dédié : `.\env\Scripts\python.exe manage.py runserver 127.0.0.1:8003`
   (avec `QR_SHORT_BASE_URL=http://127.0.0.1:8003` dans `.env`, voir `.env.example`)
2. Générateur : `http://127.0.0.1:8003/`
3. **Page stats dédiée : `http://127.0.0.1:8003/stats/`** — cartes (titre, lien,
   image QR, scans) + fiche par QR (`/stats/<id>/`, historique par jour)
   + analytique : courbe 30 jours vs période précédente, heatmap heures × jours,
   top 5, répartition par catégorie ; fiche : objectif avec progression,
   appareils (estimation), annotations
4. Entrez une URL dans le champ de saisie, donnez-lui un **titre** (affiché sur
   la page stats), raccourcissez puis cliquez sur "Générer le QR-Code"
5. Cliquez sur "Télécharger" pour sauvegarder l'image

### 🔗 Raccourcisseur d'URL intégré (anti URL longues)

Au-delà de ~500 caractères, l'aperçu auto est différé pour garder la page
fluide. En 3 temps : 1) collez le lien, 2) cliquez sur
**« Raccourcir + QR court suivi »** (le lien court s'affiche, réutilisé s'il
existe déjà), 3) cliquez sur **« Générer le QR Code »** : le QR encode la
version courte (petit, fiable, compté), avec boutons « Copier le lien court »
et « Voir les scans ».
La même URL re-soumise réutilise le même lien court. Sans serveur, le bouton
« Générer » reste disponible avec l'URL longue (fallback offline).

### 🏷️ Catégories

Classez chaque QR (tous types) via le champ **Catégorie** du générateur :
tapez un nom existant (suggestions) ou inédit pour le créer à la volée.
Retrouvez vos QR sur `http://127.0.0.1:8003/stats/?cat=<nom>` (chips par
catégorie, badge sur cartes et fiche), gérez-les sur
`http://127.0.0.1:8003/categories/` (renommer, supprimer — les QR sont
conservés en « Sans catégorie ») ou dans l'admin Django.

### 📊 Suivi des scans dans l'interface

Après « Générer » avec un lien court, une carte **« QR suivi »** affiche le
compteur (`Actualiser` manuel + auto toutes les 20 s, `Copier`, `Voir les
scans` avec tableau par jour). La section **« Mes QR suivis »** persiste en
local et survit au rechargement. Les QR sans lien court affichent un badge
« statique — sans stats ». Compte : 1 fois par heure et par visiteur, robots
exclus.

⚠️ Les liens courts figent le domaine dans les QR imprimés : en production,
renseignez un domaine HTTPS pérenne via `QR_SHORT_BASE_URL` (voir
`.env.example`). Purge RGPD des événements anciens :
`manage.py purge_scanevents` (`QR_RETENTION_DAYS`, défaut 180 j).

## 📋 Prérequis

- Python 3.12+ avec environnement virtuel `env/` : `python -m venv env`
- Backend : `.\env\Scripts\python.exe -m pip install -r requirements.txt` (Django, segno)
- Frontend : HTML5/CSS3/JS vanilla + CDN (Tailwind, `qrcode`, `qr-code-styling`) ; tests JS : `npm install` puis `npm test` (Jest)

## ⚙️ Démarrage

```powershell
Copy-Item .env.example .env   # puis renseignez DJANGO_SECRET_KEY et QR_IP_HASH_SALT
.\env\Scripts\python.exe manage.py migrate
.\env\Scripts\python.exe manage.py test qr_tracker
.\env\Scripts\python.exe manage.py runserver 127.0.0.1:8003
```

- Générateur : `http://127.0.0.1:8003/` · Stats : `/stats/` · Catégories : `/categories/` · Admin : `/admin/`
- Variables : voir `.env.example` (jamais de `.env` dans git). En prod : `DJANGO_DEBUG=False`,
  `DJANGO_ALLOWED_HOSTS`, `QR_SHORT_BASE_URL=https://…`, `manage.py check --deploy`.
- Purge RGPD : `manage.py purge_scanevents` (`QR_RETENTION_DAYS`, défaut 180 j).
- Sécurité : API sans auth, usage local uniquement — ne pas exposer sur internet tel quel
  (rate-limit seul garde-fou) ; mots de passe WiFi stockés en clair dans `payload`.

## 🎨 Caractéristiques du design

- **Glassmorphism** : Effet de verre dépoli avec backdrop-filter
- **Dégradés animés** : Fond avec animation de dégradé fluide
- **Micro-animations** : Transitions et effets sur tous les éléments interactifs
- **Responsive** : Design adaptatif pour mobile, tablette et desktop
- **Accessibilité** : Support des lecteurs d'écran et navigation au clavier

## 🔧 Technologies utilisées

- **HTML5** : Structure sémantique
- **CSS3** : Animations, transitions, glassmorphism
- **JavaScript ES6+** : Logique de génération et interactions
- **QRCode.js** : Bibliothèque de génération de QR-codes (CDN)

## 📝 Notes

- Les URLs sont automatiquement normalisées (ajout de https:// si nécessaire)
- Le QR-code utilise un niveau de correction d'erreur élevé (H) pour une meilleure lisibilité
- Les noms de fichiers de téléchargement sont générés intelligemment à partir de l'URL

## 🌐 Compatibilité

Testé et compatible avec :
- Chrome/Edge (dernières versions)
- Firefox (dernières versions)
- Safari (dernières versions)
- Navigateurs mobiles modernes

---

Créé avec ❤️ pour une expérience utilisateur moderne et élégante.





