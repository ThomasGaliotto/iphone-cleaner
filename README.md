# Nettoyeur — nettoyage de la photothèque iPhone

App Expo (React Native) qui analyse toute la photothèque, directement sur l'iPhone. Aucune photo ne quitte l'appareil.

- **Stockage** : stockage de l'iPhone (utilisé / libre) et place prise par catégorie (photos, Live Photos, captures d'écran, vidéos).
- **Doublons** : copies visuellement identiques (hash perceptuel dHash), où qu'elles soient dans la photothèque.
- **Photos similaires** : rafales et prises répétées à moins de 2 minutes d'intervalle.
- **Photos floues** : variance du Laplacien, avec trois niveaux de sensibilité.
- **Photos trop sombres**, **captures d'écran** et **grosses vidéos** (plus de 50 Mo).
- Dans chaque groupe, l'app suggère la meilleure version à garder (meilleure résolution, puis meilleure netteté).
- Suppression en lot : iOS demande confirmation, puis les éléments vont dans « Supprimés récemment ».

## Ouvrir l'app depuis n'importe où (EAS Update)

L'app est publiée sur les serveurs d'Expo. Elle s'ouvre dans Expo Go, quel que soit le réseau, même PC éteint :

1. Dans Expo Go, connecte-toi avec le compte Expo propriétaire du projet (`thomasgal`).
2. Scanne ce QR code avec l'app Appareil photo de l'iPhone :

   ![QR code Expo Go](docs/expo-go-qr.png)

   Lien direct : `exp://u.expo.dev/17d81bd2-4cdc-4660-acf5-ec94ac2c1551?channel-name=main&runtime-version=exposdk:58.0.0`

Pour publier une nouvelle version après une modification du code :

```bash
npm run deploy
```

Le `runtimeVersion` vaut `exposdk:58.0.0` dans `app.json` : c'est la valeur qu'Expo Go accepte. En cas de passage à un autre SDK Expo, il faut la mettre à jour, ainsi que le lien ci-dessus.

## Lancer en développement (même Wi-Fi)

1. Sur l'iPhone, installe **Expo Go** depuis l'App Store.
2. Sur le PC :
   ```bash
   npm install
   npx expo start
   ```
3. Scanne le QR code avec l'app Appareil photo de l'iPhone. Le projet s'ouvre dans Expo Go.
   - Le PC et l'iPhone doivent être sur le même Wi-Fi. Sinon, ou si un pare-feu bloque le port 8081, utilise `npx expo start --tunnel`.
4. Choisis « Autoriser l'accès complet » aux photos. Avec un accès limité, l'analyse ne porte que sur les photos choisies.

La première analyse lit chaque photo et dure quelques minutes pour plusieurs milliers d'éléments. Les résultats sont ensuite mis en cache sur l'iPhone, donc les analyses suivantes sont rapides.

## Limites connues

- **Photos sur iCloud** : si « Optimiser le stockage » est activé, la taille des originaux restés sur iCloud est **estimée**. Ces photos sont analysées à partir de leur version locale réduite.
- **Live Photos** : seule la partie image est comptée, pas la courte vidéo associée.
- **Espace libéré** : il ne l'est qu'après avoir vidé « Supprimés récemment » dans Photos. Une app ne peut pas le faire.
- **Expo Go** : la fenêtre d'autorisation affiche le texte d'Expo Go, pas celui défini dans `app.json`. Pour une vraie app installée, il faut un build EAS (`npx eas-cli build`) et un compte Apple Developer.
- **Seuils** : les seuils de flou et de similarité ont été réglés sur des images de test. Ils peuvent demander un ajustement sur de vraies photos (`src/lib/findings.ts`).

## Code

| Fichier | Rôle |
| --- | --- |
| `src/lib/imageMetrics.ts` | Calculs purs : dHash, netteté (Laplacien), luminosité |
| `src/lib/findings.ts` | Regroupement des doublons et des photos similaires, détection des flous et des photos sombres, tailles par catégorie |
| `src/lib/scanner.ts` | Lecture de la photothèque, tailles de fichiers, miniatures 256 px, cache, suppression |
| `src/lib/report.ts` | Assemble les résultats affichés |
| `src/screens/` | Écran d'accueil (vue d'ensemble) et écran de revue (sélection et suppression) |

```bash
npm test          # vérifie les algorithmes sur des images de synthèse
npm run typecheck
```
