# Baraka Fish HD - Points a valider (ambiguities / contradictions)

Fichiers de reference : `AGENTS.md`, `CGU.md`, `schema.sql`.
Note : le chemin `db/migrations/001_initial_schema.sql` mentionne dans certaines
instructions n'existe pas. Le schema reel est `schema.sql` a la racine, applique
comme migration `0001_init` par `api/src/db/migrate.ts`.

Statut : a trancher avant les etapes indiquees ([TODO]).

---

## Q1 - Arrondi des montants (etapes 6, 7)
`orders.subtotal = quantity_kg * unit_price` avec `quantity_kg NUMERIC(10,2)` et
`unit_price`/`subtotal` en `INT`. Une quantite decimale (ex. 2,5 kg) donne un
sous-total non entier, ce qui contredit la regle "montants en entiers".
Decisions attendues :
- Arrondi du sous-total : `round`, `floor`, ou `ceil` ?
- `quantity_kg` : limiter a 2 decimales seulement, ou stocker en grammes (int) ?
- Ordre de calcul pour `subtotal`, `commission_amount`, `seller_payout`.

## Q2 - Moment du calcul de la commission (regles 4 vs plan etape 6)
AGENTS règle 4 : commission calculee "au moment du paiement".
Plan etape 6 : commission calculee a la creation de la commande (`pending_payment`).
A trancher : la commission est-elle figee a la creation (statut `pending_payment`),
ou (re)calculee au passage a `paid` ? En cas d'echec de paiement puis expiration de
30 min, que devient la valeur figee ?

## Q3 - Source du taux de commission (etapes 6, 7)
`schema.sql` ne stocke pas de taux par vendeur ; le taux vient de
`subscription_plans.commission_rate_bps`, or les abonnements sont "hors perimetre MVP".
- Quel taux par defaut si le vendeur n'a pas de plan ? (probablement `seller_free` = 600 bps)
- Un plan `buyer_pro` a `commission_rate_bps = NULL` (cote acheteur) : confirmer qu'il ne
  s'applique jamais a la commission vendeur.

## Q4 - Annonces sponsorisees : V2 ou MVP ? (etape 5)
Le contexte liste les annonces sponsorisees comme revenu, mais elles sont classees
"hors perimetre MVP (V2)". Pourtant l'etape 5 (MVP) impose de les trier en tete
(`is_sponsored` + `sponsored_until`). Contradiction a lever.

## Q5 - Documents vendeur (etape 3)
`seller_profiles` stocke les documents en colonnes (`id_document_url`,
`sanitary_doc_url`, `facility_photo_url`) = un seul fichier par type.
Le plan prevoit `POST /sellers/documents` (envois, potentiellement multiples).
- Garder une colonne par type, ou ajouter une table `seller_documents` ?

## Q6 - Motif de rejet vendeur (etape 3)
Le plan attend `POST /admin/sellers/:id/reject { reason }` mais `seller_profiles`
n'a aucune colonne pour stocker le motif de rejet.
- Ajouter `rejection_reason` (migration dediee) ?

## Q7 - `user_role` ENUM et multi-role (regle 6)
Le type `user_role ('buyer','seller','admin')` est defini mais jamais utilise ;
`users` s'appuie sur `is_buyer`/`is_seller`/`is_admin`. Cet enum a valeur unique
contredit la regle "un utilisateur peut etre acheteur et vendeur".
- Supprimer le type inutilise, ou l'employer autrement ?

## Q8 - Litiges : `decision` vs `status` (etape 9)
Le plan envoie `{ decision: 'refund' | 'partial' | 'release', refund_amount?, note }`.
Le schema n'a pas de colonne `decision` : la decision est encodee dans l'enum
`dispute_status` (`resolved_refund`, `resolved_partial`, `resolved_release`).
- Confirmer le mapping decision -> valeur de `dispute_status`.
- Definir qui passe `status` a `under_review` et quand.

## Q9 - Notifications : file et reessais (etape 10)
Le plan demande une file avec `status` et 3 reessais avec delai croissant. Le schema
n'a que `sent_at` et `error` (ni `status`, ni `attempts`).
- Ajouter `status` et `attempts` (migration dediee) ?

## Q10 - `full_name` obligatoire (etape 2)
`users.full_name` est `NOT NULL`. Le plan envoie `full_name?` (optionnel) a
`POST /auth/verify-otp`.
- Obliger `full_name` uniquement lors de la creation du compte (premiere connexion) ?

## Q11 - Taxonomie `species.category` (etape 4)
`category` est `TEXT` libre, sans enum ni CHECK. Le commentaire donne des valeurs
francaises ("poisson, crustace, mollusque, cephalopode") alors que la convention
impose le code en anglais (`fish`, `crustacean`, ...).
- Fixer la liste exacte (valeurs, langue, singulier/pluriel) et la contraindre.

## Q12 - Strategie d'identifiants
`species` et `subscription_plans` sont en `SERIAL` (int), le reste en `UUID`.
- Homogeneiser (tout UUID) ou assumer le melange ?

## Q13 - Champs d'horodatage / reference manquants
`seller_profiles` n'a pas `updated_at` (contrairement a `users`, `listings`, `orders`).
`orders` n'a pas de `reference` lisible (utile pour support et notifications).
- Les ajouter ?

## Q14 - Divers a confirmer
- `payments.status` (`payment_status`) n'a pas de valeur `partially_refunded` : le
  remboursement partiel (etape 9) ne peut pas y etre represente directement
  (`refunded_amount` existe, mais le statut reste `succeeded`/`refunded` ?).
- `payouts.status` est un `TEXT` libre ("pending, sent, failed") alors que le plan
  mentionne aussi des reessais admin : figer l'ensemble des valeurs.
- `notifications.channel` est un `TEXT` libre alors que le reste utilise des enums.
- `orders.delivery_fee` : confirmer qu'il est conserve par la plateforme
  (`seller_payout = subtotal - commission_amount` exclut les frais de livraison).
- Zone de livraison vs zone d'annonce : meme referentiel de valeurs ?
