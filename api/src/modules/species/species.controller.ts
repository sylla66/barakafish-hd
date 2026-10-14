import type { Request, Response } from 'express';

import { listSpecies } from './species.service';

export async function listSpeciesHandler(_req: Request, res: Response): Promise<void> {
  const species = await listSpecies();
  res.status(200).json({ species });
}
