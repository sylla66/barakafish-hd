import type { Request, Response } from 'express';

import { env } from '../../config/env';
import { AppError } from '../../lib/AppError';
import { getPaymentProvider } from '../../providers/payment';
import type { AuthUser } from '../users/users.types';
import {
  getPaymentWithOrder,
  handlePaymentEvent,
  initiateOrderPayment,
  loadMockPayment,
  retryPayout,
  simulateMockPayment,
} from './payments.service';

function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}

// Premiere origine de CORS = URL publique du front (retour apres paiement).
function webOrigin(): string {
  return env.CORS_ORIGIN.split(',')[0].trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Page de simulation du fournisseur mock : succes ou echec du paiement, puis
// redirection vers la page de retour du front.
function mockPaymentPage(reference: string, amount: number, title: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Paiement - Baraka Fish HD</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f1f5f9; margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
  .carte { background: #ffffff; border-radius: 14px; padding: 24px; width: 100%; max-width: 380px;
           box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14); }
  h1 { font-size: 1.1rem; margin: 0 0 6px; color: #0f172a; }
  p { margin: 4px 0; color: #475569; font-size: 0.9rem; }
  .montant { font-size: 1.75rem; font-weight: 700; color: #0f766e; margin: 16px 0; }
  form { margin-top: 10px; }
  button { width: 100%; padding: 12px; border: 0; border-radius: 8px; font-size: 1rem;
           font-weight: 600; cursor: pointer; }
  .succes { background: #15803d; color: #ffffff; }
  .echec { background: #dc2626; color: #ffffff; }
  .mention { font-size: 0.75rem; color: #94a3b8; margin-top: 16px; }
</style>
</head>
<body>
  <div class="carte">
    <h1>Simulation de paiement</h1>
    <p>${escapeHtml(title)}</p>
    <div class="montant">${amount} FCFA</div>
    <form method="post" action="/payments/mock/${reference}/simulate">
      <input type="hidden" name="outcome" value="succeeded" />
      <button class="succes" type="submit">Payer (succes)</button>
    </form>
    <form method="post" action="/payments/mock/${reference}/simulate">
      <input type="hidden" name="outcome" value="failed" />
      <button class="echec" type="submit">Echouer le paiement</button>
    </form>
    <p class="mention">Fournisseur de simulation : aucun mouvement d'argent reel.</p>
  </div>
</body>
</html>`;
}

// POST /orders/:id/pay : cree un paiement « initiated » et renvoie l'URL.
export async function payOrderHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await initiateOrderPayment(user, req.params.id);
  res.status(201).json(result);
}

// POST /webhooks/payment : corps brut conserve par express.raw (signature).
export async function paymentWebhookHandler(req: Request, res: Response): Promise<void> {
  const raw = req.body;
  if (!Buffer.isBuffer(raw) || raw.length === 0) {
    throw AppError.badRequest('Corps du webhook manquant.');
  }

  const provider = getPaymentProvider();
  const event = provider.verifyWebhook(req.headers, raw);
  const status = await handlePaymentEvent(event);
  res.status(200).json({ received: true, status });
}

// GET /payments/reference/:reference : etat du paiement pour le retour front.
export async function getPaymentHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const payment = await getPaymentWithOrder(user, req.params.reference);
  res.status(200).json({ payment });
}

// GET /payments/mock/:reference : page de simulation (succes / echec).
export async function mockPaymentPageHandler(req: Request, res: Response): Promise<void> {
  const info = await loadMockPayment(req.params.reference);
  if (info.status !== 'initiated') {
    // Deja traite : on renvoie directement sur la page de retour du front.
    res.redirect(302, `${webOrigin()}/paiement/${info.reference}`);
    return;
  }
  res
    .status(200)
    .type('html')
    .send(mockPaymentPage(info.reference, info.amount, info.title));
}

// POST /payments/mock/:reference/simulate : genere l'evenement de paiement.
export async function mockPaymentSimulateHandler(req: Request, res: Response): Promise<void> {
  const outcome = req.body?.outcome === 'failed' ? 'failed' : 'succeeded';
  await simulateMockPayment(req.params.reference, outcome);
  res.redirect(302, `${webOrigin()}/paiement/${req.params.reference}`);
}

// POST /admin/payouts/:id/retry : nouvelle tentative de versement (admin).
export async function retryPayoutHandler(req: Request, res: Response): Promise<void> {
  const payout = await retryPayout(req.params.id);
  res.status(200).json({ payout });
}
