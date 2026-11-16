# Blackjack entre potes

Blackjack multijoueur en ligne, **jetons fictifs uniquement** (aucun argent réel).

## Jouer
1. Ouvre le site et clique **Créer une table**.
2. Choisis ton pseudo. Clique **Inviter** pour envoyer le lien à tes potes.
3. Tes potes ouvrent le lien, choisissent un pseudo et s'assoient. Aucun compte.

## Règles
6 jeux de cartes · le croupier reste à 17 · blackjack payé 3 pour 2 (arrondi en dessous) ·
doubler sur les 2 premières cartes · pas de partage ni d'assurance · 1 000 jetons au départ,
recharge à 1 000 quand on est à sec · 6 joueurs maximum (les suivants regardent).

## Comment ça marche
- Site statique (GitHub Pages). Connexion directe entre navigateurs avec PeerJS (WebRTC).
- Le premier qui ouvre un code de table « tient » la table : il fait tourner le jeu et envoie l'état aux autres.
- Si l'hôte part, un autre joueur reprend la table automatiquement avec le même code (la manche en cours est annulée, personne ne perd sa mise).
- Les jetons sont sauvegardés dans le navigateur de chaque joueur, liés à son pseudo.

## Fichiers
- `engine.js` : règles du blackjack. `host.js` : logique de l'hôte. `app.js` : interface et réseau.
- `peerjs.min.js` : bibliothèque PeerJS 1.5.5 (copie locale).
