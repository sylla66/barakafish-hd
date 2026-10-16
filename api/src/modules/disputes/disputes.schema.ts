import { z } from 'zod';

import { DISPUTE_REASONS, DISPUTE_STATUSES } from './disputes.types';

// Ouverture d'un litige (multipart : reason/description + photo obligatoire).
export const createDisputeSchema = z.object({
  reason: z.enum(DISPUTE_REASONS, {
    errorMap: () => ({ message: 'Motif de litige invalide.' }),
  }),
  description: z
    .string({ required_error: 'La description est obligatoire.' })
    .trim()
    .min(10, 'Decrivez le probleme en au moins 10 caracteres.')
    .max(2000, 'La description est limitee a 2000 caracteres.'),
});

export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;

// Ajout d'une preuve (message et/ou photo) par l'acheteur ou le vendeur.
export const addEvidenceSchema = z.object({
  message: z
    .string()
    .trim()
    .max(1000, 'Le message est limite a 1000 caracteres.')
    .optional(),
});

export type AddEvidenceInput = z.infer<typeof addEvidenceSchema>;

export const listDisputesQuerySchema = z.object({
  status: z
    .enum(DISPUTE_STATUSES, {
      errorMap: () => ({ message: 'Statut de litige invalide.' }),
    })
    .optional(),
});

export type ListDisputesQuery = z.infer<typeof listDisputesQuerySchema>;

export const resolveDisputeSchema = z
  .object({
    decision: z.enum(['refund', 'partial', 'release'], {
      errorMap: () => ({ message: 'Decision invalide : refund, partial ou release.' }),
    }),
    refund_amount: z.coerce
      .number({ invalid_type_error: 'Le montant rembourse doit etre un nombre.' })
      .int('Le montant rembourse doit etre un entier en FCFA.')
      .positive('Le montant rembourse doit etre superieur a 0.')
      .optional(),
    note: z.string().trim().max(1000, 'La note est limitee a 1000 caracteres.').optional(),
  })
  .refine((value) => value.decision !== 'partial' || value.refund_amount !== undefined, {
    message: 'Un montant de remboursement est requis pour une decision partielle.',
    path: ['refund_amount'],
  });

export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
