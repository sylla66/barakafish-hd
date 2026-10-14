# Marketplace de poissons et fruits de mer (Sénégal)

## Contexte produit
Application qui met en relation des vendeurs et des acheteurs de poissons et fruits de mer, frais ou congelés en mer.
- La qualité de la marchandise est sous la responsabilité du vendeur (voir CGU.md).
- La plateforme est un intermédiaire : elle sécurise le paiement (séquestre) et gère les litiges.
- Revenus : commission sur chaque commande, abonnements vendeurs (Pro/Premium), abonnements acheteurs B2B, annonces sponsorisées, marge sur la livraison réfrigérée.
- Marché de lancement : une seule zone (Dakar et environs), vendeurs et acheteurs professionnels d'abord.
- Devise : FCFA (XOF), montants stockés en entiers (pas de décimales).
- Langue de l'interface : français (prévoir l'i18n pour le wolof plus tard).

## Stack
- Front : React + TypeScript + Vite, en PWA (mobile first, connexions faibles, photos compressées côté client)
- Back : Node.js + TypeScript (Express ou NestJS), API REST
- Base de données : PostgreSQL (schéma dans `schema.sql`)
- Auth : téléphone + OTP (SMS ou WhatsApp), JWT
- Paiement : agrégateur de paiement mobile (Wave / Orange Money) derrière une interface `PaymentProvider` pour pouvoir changer de fournisseur
- Stockage photos : S3 compatible ou Cloudinary
- Tests : Vitest/Jest pour le back, Testing Library pour le front

## Règles d'architecture
1. Tout changement d'état d'une commande passe par une seule fonction de service `transitionOrder(orderId, newStatus, actor)` qui vérifie les transitions autorisées et écrit dans `order_status_history`. Aucune mise à jour directe du champ `status` ailleurs.
2. Le séquestre est une machine à états :
   `pending_payment -> paid -> shipped -> delivered -> confirmed -> released`
   avec les branches `disputed`, `refunded`, `cancelled`.
3. Les fonds ne sont libérés au vendeur que lorsque l'acheteur confirme la réception, ou automatiquement après 48 h sans litige.
4. La commission est calculée au moment du paiement et figée dans la commande (`commission_rate_bps`, `commission_amount`). Ne jamais la recalculer après coup.
5. Les webhooks de paiement doivent être idempotents (clé `provider_reference` unique).
6. Les rôles : `buyer`, `seller`, `admin`. Un utilisateur peut être acheteur et vendeur.
7. Aucune donnée sensible en clair dans les logs (téléphone, pièces d'identité).
8. Les pièces d'identité et documents sanitaires des vendeurs ne sont accessibles qu'aux admins.

## Modèle de données
Voir `schema.sql`. Tables principales : `users`, `seller_profiles`, `species`, `listings`, `listing_photos`, `orders`, `order_status_history`, `payments`, `reviews`, `disputes`, `subscription_plans`, `subscriptions`, `notifications`.

## Plan de développement (MVP, ordre à suivre)
Faire une étape à la fois, avec des tests, avant de passer à la suivante.

1. **Initialisation** : monorepo (`/api`, `/web`), configuration TypeScript, ESLint, variables d'environnement, connexion PostgreSQL, migrations à partir de `schema.sql`.
2. **Authentification** : inscription et connexion par téléphone + OTP, JWT, rôles.
3. **Profil vendeur** : création du profil, envoi des documents, validation par l'admin (badge « Vérifié »).
4. **Annonces** : création, modification, suppression, photos, champs obligatoires (espèce, état frais/congelé, date de pêche ou de congélation, quantité, prix/kg, zone, conditions de conservation).
5. **Recherche et filtres** : espèce, état, zone, prix, pagination.
6. **Commande** : création, calcul de la commission, machine à états.
7. **Paiement séquestre** : interface `PaymentProvider`, implémentation du fournisseur choisi, webhooks idempotents, libération et remboursement.
8. **Réception et avis** : confirmation avec photo, notes de 1 à 5 et commentaire, un seul avis par commande.
9. **Litiges** : ouverture par l'acheteur dans le délai, preuves (photos), décision admin (remboursement total, partiel, ou libération au vendeur).
10. **Notifications** : SMS/WhatsApp pour nouvelle commande, paiement reçu, livraison, litige.
11. **Back-office admin** : validation des vendeurs, suivi des commandes, litiges, commissions, export CSV.
12. **Pilote** : données de démonstration, déploiement, sauvegardes quotidiennes, monitoring des erreurs.

## Hors périmètre du MVP (V2)
Abonnements facturés automatiquement, annonces sponsorisées, livraison intégrée avec suivi de température, commandes récurrentes B2B, factures PDF, multi-villes, application mobile native.

## Conventions
- Noms de code (variables, tables, fonctions) en anglais, textes visibles par l'utilisateur en français.
- Validation de toutes les entrées côté serveur (Zod ou équivalent).
- Messages d'erreur clairs et en français pour l'utilisateur.
- Chaque endpoint a au moins un test de succès et un test d'erreur.
- Commits courts et atomiques, un par fonctionnalité.
