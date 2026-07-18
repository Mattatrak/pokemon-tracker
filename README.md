# 🎴 Pokémon Collection Tracker

Une application web simple pour gérer votre collection de cartes Pokémon.

## Installation & Démarrage

### Option 1 : Ouverture simple (la plus facile) ⭐

1. Téléchargez le fichier `index.html`
2. Double-cliquez dessus pour l'ouvrir dans votre navigateur
3. C'est tout ! L'app est prête à utiliser

### Option 2 : Avec un serveur local (recommandé)

#### Prérequis
- Installez **Node.js** : https://nodejs.org (version LTS)
- Ouvrez le terminal/invite de commande

#### Étapes

1. **Créez un dossier pour le projet**
   ```
   mkdir pokemon-tracker
   cd pokemon-tracker
   ```

2. **Mettez le fichier `index.html` dans ce dossier**

3. **Installez un serveur simple** :
   ```
   npm init -y
   npm install --save-dev http-server
   ```

4. **Lancez le serveur** :
   ```
   npx http-server
   ```

5. **Ouvrez votre navigateur** et allez à : `http://localhost:8080`

---

## Comment utiliser

### Ajouter une carte
1. Remplissez les champs du formulaire :
   - **Nom** : Ex: "Pikachu Holographique"
   - **Série** : Ex: "Base Set"
   - **Numéro** : Ex: "25/102"
   - **État** : Choisissez entre NM, LP, MP, HP
   - **Valeur** : Le prix en euros

2. Cliquez sur **"Ajouter la carte"**

### Chercher une carte
- Utilisez la barre de recherche pour trouver par nom ou série
- Filtrez par état pour voir seulement certaines conditions

### Supprimer une carte
- Cliquez sur l'icône 🗑️ à droite de la carte

---

## Vos données sont protégées 🔒

Toutes vos données sont sauvegardées **localement** dans votre navigateur.
- Elles ne sont jamais envoyées à un serveur
- Elles restent même après fermeture du navigateur
- Si vous videz l'historique, vous les perdrez

---

## Prochaines étapes possibles

Si vous voulez améliorer l'app, on peut :
- ✅ Ajouter des images des cartes
- ✅ Synchroniser les données avec une base de données
- ✅ Créer une version mobile
- ✅ Exporter votre collection en PDF/Excel

---

## Problèmes courants

### "Le serveur n'est pas accessible"
Vérifiez que vous êtes dans le bon dossier et relancez la commande `npx http-server`

### "Les données ont disparu"
Si vous avez vidé l'historique du navigateur, les données locales sont supprimées. 
Pour l'avenir, envisagez une sauvegarde cloud.

---

**Amusez-vous ! 🎮**
