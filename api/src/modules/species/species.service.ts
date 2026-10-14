import { pool } from '../../db/pool';
import type { Species } from './species.types';

interface SpeciesRow {
  id: number;
  name_fr: string;
  name_wo: string | null;
  category: string;
}

function toSpecies(row: SpeciesRow): Species {
  return {
    id: row.id,
    nameFr: row.name_fr,
    nameWo: row.name_wo,
    category: row.category,
  };
}

// Catalogue d'especes (reference pour le formulaire d'annonce et, plus tard, les
// filtres de recherche). Tri par categorie puis nom francais.
export async function listSpecies(): Promise<Species[]> {
  const result = await pool.query<SpeciesRow>(
    'SELECT id, name_fr, name_wo, category FROM species ORDER BY category ASC, name_fr ASC',
  );
  return result.rows.map(toSpecies);
}

export async function speciesExists(id: number): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM species WHERE id = $1', [id]);
  return result.rowCount !== null && result.rowCount > 0;
}
