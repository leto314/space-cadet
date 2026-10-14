# Système de statistiques — Space Cadet

Document de référence : ce qui est décidé, ce qui reste à valider (marqué **À VALIDER**), et où c'est codé.
Code : `formulas.js` (calculs purs), `records.js` (formats de données), `storage.js` (stockage local de test).

---

## 1. Vue d'ensemble

Deux systèmes **séparés**, qui ne s'influencent pas :

| | Radar (6 compétences) | Cadet score |
|---|---|---|
| Alimenté par | l'entraînement quotidien uniquement | l'entraînement quotidien **et** la daily mission |
| Échelle | 0 à 1000 par compétence | cumul de points, sans maximum |
| Évolution | moyenne mobile : monte et descend | ne fait que monter |
| Ce qu'il dit | ton niveau actuel dans chaque compétence | ton engagement + tes performances dans la durée |

Jamais comptés : Full Clearance (jeux libres) et Mission Mode. Ils sont enregistrés pour l'historique personnel,
mais n'influencent ni le radar ni le cadet score. Seule la **première** session du jour compte.

Deux façons de voir ses stats (plus tard, besoin d'un serveur) : en nombres (scores, cadet score) et en
comparaisons (position dans la distribution du jour, amis, joueurs d'ancienneté comparable…).

---

## 2. L'entraînement quotidien

- **6 jeux par jour, un par compétence**, choisis de façon pseudo-aléatoire à partir de la date : identiques
  pour tout le monde, jamais le même jeu deux jours de suite dans une compétence.
- **Durée visée : environ 1,5 à 2,5 min par jeu**, soit 10 à 15 min au total. Chaque version quotidienne est
  réglée pour donner assez de mesures dans ce temps (plus d'essais pour un jeu rapide, moins pour un jeu long
  comme les rotations de cube). **À VALIDER jeu par jeu.**
- Contenu tiré de la graine du jour (même contenu pour tous les joueurs d'un même palier).

### Difficulté : deux familles, décidées jeu par jeu

| Famille | Principe | Choix du joueur |
|---|---|---|
| Adaptative | la difficulté s'ajuste pendant la partie (là où ça ne déstabilise pas) | aucun |
| À paliers | Simple / Standard / Experienced, contenu fixe par palier | le joueur choisit sa vitesse de progression |

Pas d'adaptatif pour les jeux où changer en cours de partie perturbe (N-back par exemple).
L'app pourra **suggérer** un palier selon le score actuel ; ce n'est qu'une suggestion.

---

## 3. Le score d'un jeu (0 à 1000)

Chaque jeu quotidien convertit sa partie en une **note du jour de 0 à 1000**, avec sa propre grille (précision,
vitesse, niveau atteint…). La grille intègre la difficulté propre au jeu, donc **aucune pondération entre jeux**
n'est nécessaire : un 800 au cube et un 800 au N-back veulent dire la même chose.

- La grille est définie **jeu par jeu, ensemble** (prochaine étape).
- Option par jeu : corriger le hasard (`chanceCorrected`), pour qu'une réponse au hasard ne rapporte rien en
  moyenne. Utile seulement pour les questions à choix multiples ; décidé au cas par cas.

---

## 4. La mise à jour d'une compétence

Formule (`updateCompetence` dans `formulas.js`) :

```
S_new = S_old + a · (S_today − S_old)
a     = min(1, max(0.1, 1/n) · w)
```

- `n` : nombre de jours où cette compétence a été entraînée, aujourd'hui compris.
  Les 10 premiers jours, c'est la moyenne simple des notes ; ensuite une moyenne mobile (α = 0,1, l'effet d'un
  jour est divisé par deux en ~7 jours).
- `w` : poids du palier. Il ne multiplie pas la note, il multiplie **le pas** (l'ampleur du changement) :

| Palier | w si la note du jour est au-dessus du score | w si elle est en dessous |
|---|---|---|
| Simple | 0,5 | 0,25 |
| Standard | 1 | 0,5 |
| Experienced | 1,5 | 0,75 |

**À VALIDER** (les valeurs ; les deux colonnes se règlent séparément).

Pourquoi les pertes pèsent moitié moins que les gains : près du sommet, un score a beaucoup plus de place pour
descendre que pour monter (à 850, il peut gagner 150 au plus mais perdre 850). Avec des poids égaux, un seul
mauvais jour effaçait plusieurs bons jours. Contrepartie assumée : le score se place un peu au-dessus de la
moyenne des notes, plutôt du côté de tes bons jours.

Pourquoi le pas et pas la note : multiplier la note (`β · S_today`) déplace la cible. Avec 850 de score et
1000 en Simple, β = 0,75 vise 750, donc le score **descend** malgré la réussite. En multipliant le pas :

- une note au-dessus du score le fait **toujours** monter, quel que soit le palier, plus ou moins vite ;
- une note en dessous le fait toujours baisser, moins en Simple, plus en Experienced (petit enjeu / gros enjeu) ;
- une note **égale** au score ne change rien, quel que soit le palier : le score est confirmé.

| Score 850, note du jour | Simple | Standard | Experienced |
|---|---|---|---|
| 1000 (réussite) | +7,5 | +15 | +22,5 |
| 850 (égal) | 0 | 0 | 0 |
| 600 (moins bien) | −6,3 | −12,5 | −18,8 |
| 500 (échec) | −8,8 | −17,5 | −26,3 |
| 0 (désastre) | −21,3 | −42,5 | −63,8 |

Ce que ça donne dans la durée (joueur qui fait toujours 900, parti de 500) :

| Après | Simple | Standard | Experienced |
|---|---|---|---|
| 10 jours | 759 | 860 | 893 |
| 30 jours | 849 | 895 | 900 |
| 60 jours | 889 | 900 | 900 |

Propriétés : le score reste toujours entre 0 et 1000 ; un jour non joué ne change rien (pas de décroissance,
l'inactivité se voit dans le streak).

**Point ouvert** : un joueur qui ne joue qu'en Simple et réussit tout finit par atteindre le même score, environ
deux fois plus lentement. Si on veut l'en empêcher, frein possible : le `w` du Simple diminue quand le score monte
(par exemple 0,5 à 0 point, 0,15 à 1000).

---

## 5. Le cadet score

Cumul des **points du jour** = points d'entraînement + points de mission.

| Source | Calcul (`formulas.js`) | Maximum par jour |
|---|---|---|
| Entraînement | moyenne des 6 notes, chacune × facteur du palier | 1000 en Standard, 1200 tout en Experienced |
| Daily mission | note de la mission × facteur du format | 1000 en Regular, 700 en Short |

Facteurs de palier : Simple 0,7 · Standard 1 · Experienced 1,2. Formats : Short 0,7 · Regular 1. **À VALIDER.**
Un entraînement partiel rapporte sa part (3 jeux sur 6 = la moitié).

---

## 6. La note d'une daily mission (0 à 1000)

- On part de 1000 et on perd des points sur les erreurs.
- Chaque module reçoit une **part** des 1000 points (aujourd'hui la charge du module ; demain sa difficulté).
- Chaque module convertit sa performance en points selon son type :

| Type de module | Ce qui coûte des points |
|---|---|
| Événements | chaque erreur ou oubli |
| Continus | le temps passé hors de la bonne zone |
| « Quand tu as le temps » | des paliers par rapport au nombre de réponses attendu pour la durée |

- 1000 doit être atteignable sans être facile : une petite tolérance par module (par exemple une erreur gratuite,
  tous les points au-dessus de ~95 % de performance).
- Les 0 sont rares : un plancher dès que la mission est menée jusqu'au bout ; 0 seulement si abandon.
- Une seule tentative comptée par jour. **Barème détaillé à définir module par module.**

---

## 7. Ce qu'on enregistre (`records.js`)

Règle : **stocker plus que ce qu'on affiche, sans excès**. On garde les mesures brutes (pour les récaps, les
points forts et faibles, ou pour recalculer si un barème change), jamais de données image par image.

| Enregistrement | Contenu |
|---|---|
| `session` (un jeu joué) | source (daily / clearance), jour, jeu, compétence, palier, graine, réglages, début, durée, terminé ?, note 0–1000, mesures, essais (optionnel) |
| `mission` (une mission jouée) | source (daily / mode), jour, format, graine, modules, durée, progressif ?, note, détail par module (part, performance, points, mesures) |
| `competence` (un point par jour et par compétence) | compétence, jour, score, n, note du jour, palier |
| `cadet-day` (un par jour) | points d'entraînement, points de mission, total |

**Mesures** (`metrics`), selon le jeu : précision, temps de réaction moyen et médian, fausses alertes,
oublis, niveau atteint, résultats par type de question…

**Essais** (`trials`, optionnel) : une liste compacte, par exemple `[{ ok: 1, rt: 640 }]`, limitée à 200
entrées par session. Ordre de grandeur : 1 à 3 Ko par session, soit quelques Mo par an pour un joueur assidu.

Chaque enregistrement porte `schemaVersion` : si un format change, on sait quoi convertir.

---

## 8. Stockage

- **Phase de test (maintenant)** : `storage.js`, sur AsyncStorage (localStorage dans le navigateur). Tout est
  rangé sous le profil de test `leo314`, que chaque enregistrement porte (`playerId`) pour pouvoir être rattaché
  au bon compte lors de l'envoi vers le serveur.
- **Ensuite** : comptes + Supabase, avec les mêmes formats (une table par type d'enregistrement). La migration
  consiste à envoyer les données locales.
- Le jour vient toujours de l'heure du serveur (minuit à Paris), jamais de l'horloge du téléphone.

---

## 9. Prochaines étapes

1. Valider les chiffres marqués **À VALIDER**.
2. Jeu par jeu, en commençant par Spatial Orientation : version quotidienne, nombre d'essais, palier ou
   adaptatif, grille de note 0–1000, mesures enregistrées.
3. Barème des modules de mission.
4. Brancher l'accueil, le radar et l'écran Stats sur les vraies données.
5. Comptes et Supabase.
