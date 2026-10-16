import { pool } from './pool';

// Donnees factices de demonstration : utilisateurs, vendeur verifie, especes,
// annonces et un jeu de commandes couvrant les principaux statuts de la
// machine a etats (dont un litige ouvert pour le back-office).
// IMPORTANT : les plages telephoniques des tests sont reservees
// (70_000_000, 75_000_000, 76_000_000, 77_000_000, 78_000_000, 79_000_000,
// 90_000_000) ; la demo utilise 771_000_000 pour ne jamais entrer en collision.
interface DemoListing {
  id: string;
  pricePerKg: number;
}

function money(quantityKg: number, pricePerKg: number, deliveryFee: number) {
  const subtotal = Math.round(quantityKg * pricePerKg);
  const commissionAmount = Math.round((subtotal * 600) / 10000);
  return {
    subtotal,
    deliveryFee,
    commissionRateBps: 600,
    commissionAmount,
    totalAmount: subtotal + deliveryFee,
    sellerPayout: subtotal - commissionAmount,
  };
}

async function main() {
  await pool.query(`
    INSERT INTO users (phone, full_name, is_buyer, is_seller, is_admin)
    VALUES
      ('+221771000001', 'Awa Diallo', true, false, false),
      ('+221771000002', 'Moussa Sarr', true, true, false),
      ('+221771000099', 'Admin Demo', true, false, true)
    ON CONFLICT (phone) DO NOTHING;
  `);

  const buyer = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE phone = '+221771000001'`,
  );
  const seller = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE phone = '+221771000002'`,
  );
  const admin = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE phone = '+221771000099'`,
  );
  const buyerId = buyer.rows[0].id;
  const sellerId = seller.rows[0].id;

  await pool.query(
    `INSERT INTO seller_profiles (user_id, shop_name, zone, status, verified_at, rating_avg, rating_count)
     VALUES ($1, 'Chez Moussa - Poissons frais', 'Dakar', 'verified', now(), 4.5, 12)
     ON CONFLICT (user_id) DO NOTHING`,
    [sellerId],
  );
  await pool.query(`UPDATE users SET is_admin = TRUE WHERE id = $1`, [admin.rows[0].id]);

  await pool.query(`
    INSERT INTO species (name_fr, name_wo, category)
    VALUES
      ('Thon rouge', 'tuno guej', 'poisson'),
      ('Sardine', 'sar', 'poisson'),
      ('Crevette tigre', 'gargan', 'crustace'),
      ('Langouste', 'langoust', 'crustace')
    ON CONFLICT DO NOTHING;
  `);

  const species = await pool.query<{ id: number; name_fr: string }>(
    `SELECT id, name_fr FROM species WHERE name_fr IN ('Thon rouge', 'Crevette tigre') ORDER BY id`,
  );
  const thon = species.rows.find((s) => s.name_fr === 'Thon rouge') ?? species.rows[0];
  const crevette = species.rows.find((s) => s.name_fr === 'Crevette tigre') ?? species.rows[1];

  await pool.query(
    `INSERT INTO listings (
       seller_id, species_id, title, description, state, caught_or_frozen_on,
       storage_conditions, quantity_kg, min_order_kg, price_per_kg, zone, status, is_sponsored
     )
     VALUES
       ($1, $2, 'Thon rouge frais du jour', 'Thon rouge peche ce matin a Yoff. Decoupe disponible.', 'fresh', CURRENT_DATE - 1, 'Glacons, conserver a moins de 4 C', 120, 5, 3500, 'Dakar', 'active', false),
       ($1, $3, 'Crevettes tigre calibre 16', 'Crevettes congelees en mer, calibre 16/20.', 'frozen', CURRENT_DATE - 30, 'Congelateur a -18 C', 80, 2, 5000, 'Dakar', 'active', true)
     ON CONFLICT DO NOTHING`,
    [sellerId, thon.id, crevette.id],
  );

  const listingResult = await pool.query<{ id: string; price_per_kg: string }>(
    `SELECT id, price_per_kg FROM listings WHERE seller_id = $1 ORDER BY created_at`,
    [sellerId],
  );
  const listings: DemoListing[] = listingResult.rows.map((row) => ({
    id: row.id,
    pricePerKg: Number(row.price_per_kg),
  }));
  if (listings.length < 1) {
    throw new Error('Aucune annonce de demonstration disponible.');
  }
  const thonListing = listings[0];
  const crevetteListing = listings[1] ?? listings[0];

  const alreadySeeded = await pool.query<{ id: string }>(
    `SELECT id FROM orders WHERE buyer_id = $1`,
    [buyerId],
  );

  if (alreadySeeded.rowCount === 0) {
    const rows: Array<{
      listing: DemoListing;
      quantity: number;
      delivery: number;
      status: string;
      note: string;
      deliveredAgo?: string;
      autoReleaseIn?: string;
      released?: boolean;
      confirmed?: boolean;
      cancelled?: boolean;
    }> = [
      {
        listing: thonListing,
        quantity: 10,
        delivery: 1000,
        status: 'delivered',
        note: 'Livree, en attente de confirmation ou de litige',
        deliveredAgo: '1 hour',
        autoReleaseIn: '47 hours',
      },
      {
        listing: crevetteListing,
        quantity: 5,
        delivery: 1000,
        status: 'shipped',
        note: 'Expediee, en cours de livraison',
      },
      {
        listing: thonListing,
        quantity: 8,
        delivery: 1500,
        status: 'paid',
        note: 'Payee, en attente d expedition',
      },
      {
        listing: crevetteListing,
        quantity: 3,
        delivery: 1000,
        status: 'pending_payment',
        note: 'En attente de paiement sequestre',
      },
      {
        listing: thonListing,
        quantity: 20,
        delivery: 2000,
        status: 'released',
        note: 'Recue, confirmee et fonds verses au vendeur',
        deliveredAgo: '4 days',
        released: true,
        confirmed: true,
      },
      {
        listing: crevetteListing,
        quantity: 6,
        delivery: 1000,
        status: 'disputed',
        note: 'Litige ouvert par l acheteur (preuve photo)',
        deliveredAgo: '2 days',
        autoReleaseIn: '46 hours',
      },
      {
        listing: thonListing,
        quantity: 4,
        delivery: 1000,
        status: 'cancelled',
        note: 'Annulee par l acheteur avant paiement',
        cancelled: true,
      },
    ];

    for (const row of rows) {
      const amounts = money(row.quantity, row.listing.pricePerKg, row.delivery);
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO orders (
           buyer_id, seller_id, listing_id, quantity_kg, unit_price, subtotal, delivery_fee,
           commission_rate_bps, commission_amount, total_amount, seller_payout, status,
           delivery_address, delivery_zone, delivered_at, auto_release_at,
           buyer_confirmed_at, released_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 'Capedie, Dakar', 'Dakar',
                 CASE WHEN $13::text IS NULL THEN NULL ELSE now() - ($13 || ' hours')::interval END,
                 CASE WHEN $14::text IS NULL THEN NULL ELSE now() + ($14 || ' hours')::interval END,
                 CASE WHEN $15::boolean THEN now() - interval '3 days' ELSE NULL END,
                 CASE WHEN $16::boolean THEN now() - interval '3 days' ELSE NULL END)
         RETURNING id`,
        [
          buyerId,
          sellerId,
          row.listing.id,
          row.quantity,
          row.listing.pricePerKg,
          amounts.subtotal,
          amounts.deliveryFee,
          amounts.commissionRateBps,
          amounts.commissionAmount,
          amounts.totalAmount,
          amounts.sellerPayout,
          row.status,
          row.deliveredAgo ?? null,
          row.autoReleaseIn ?? null,
          row.confirmed ?? false,
          row.released ?? false,
        ],
      );
      const orderId = inserted.rows[0].id;

      // Historique des transitions, dans l ordre chronologique.
      const history: Array<[string | null, string]> = [
        [null, 'pending_payment'],
      ];
      if (row.status !== 'pending_payment' && row.status !== 'cancelled') {
        history.push(['pending_payment', 'paid']);
      }
      if (['shipped', 'delivered', 'released', 'disputed'].includes(row.status)) {
        history.push(['paid', 'shipped']);
      }
      if (['delivered', 'released', 'disputed'].includes(row.status)) {
        history.push(['shipped', 'delivered']);
      }
      if (row.confirmed) history.push(['delivered', 'confirmed']);
      if (row.released) history.push([row.confirmed ? 'confirmed' : 'delivered', 'released']);
      if (row.status === 'disputed') history.push(['delivered', 'disputed']);
      if (row.status === 'cancelled') history.push(['pending_payment', 'cancelled']);

      for (const [from, to] of history) {
        const actor = to === 'shipped' || to === 'delivered' ? sellerId : buyerId;
        await pool.query(
          `INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, note)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, from, to, actor, row.note],
        );
      }
    }

    // Litige ouvert sur la commande en statut disputed.
    const disputedOrder = await pool.query<{ id: string; listing_id: string }>(
      `SELECT id, listing_id FROM orders WHERE buyer_id = $1 AND status = 'disputed' LIMIT 1`,
      [buyerId],
    );
    if (disputedOrder.rows[0]) {
      await pool.query(
        `INSERT INTO disputes (order_id, opened_by, reason, description, status)
         VALUES ($1, $2, 'produit_avarie', 'Les crevettes sont decongelees a la reception, odeur anormale et glace fondue.', 'open')
         ON CONFLICT DO NOTHING`,
        [disputedOrder.rows[0].id, buyerId],
      );
    }

    // Avis de demonstration sur la commande liberee.
    const releasedOrder = await pool.query<{ id: string }>(
      `SELECT id FROM orders WHERE buyer_id = $1 AND status = 'released' LIMIT 1`,
      [buyerId],
    );
    if (releasedOrder.rows[0]) {
      await pool.query(
        `INSERT INTO reviews (order_id, buyer_id, seller_id, rating, comment)
         VALUES ($1, $2, $3, 5, 'Poisson ultra frais, livraison ponctuelle. Je recommande.')
         ON CONFLICT DO NOTHING`,
        [releasedOrder.rows[0].id, buyerId, sellerId],
      ).catch(() => undefined);
    }
  }

  console.log('seed ok');
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error('seed err', e);
    pool.end().finally(() => process.exit(1));
  });
