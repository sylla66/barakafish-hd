-- Migration 004 : catalogue d'especes courantes au Senegal.
-- Le nom wolof n'est renseigne que lorsqu'il est connu avec certitude ; sinon NULL.
-- ON CONFLICT rend la migration rejouable sans creer de doublon.

INSERT INTO species (name_fr, name_wo, category) VALUES
  -- Poissons
  ('Thiof',              'Thiof',  'poisson'),
  ('Dorade royale',      NULL,     'poisson'),
  ('Capitaine',          NULL,     'poisson'),
  ('Sole',               NULL,     'poisson'),
  ('Rouget',             NULL,     'poisson'),
  ('Barracuda',          NULL,     'poisson'),
  ('Sardinelle',         'Yaboye', 'poisson'),
  ('Thon',               NULL,     'poisson'),
  ('Maquereau',          NULL,     'poisson'),
  ('Mérou',              NULL,     'poisson'),
  ('Carpe rouge (denti)', NULL,    'poisson'),
  ('Machoiron',          NULL,     'poisson'),
  ('Congre',             NULL,     'poisson'),
  ('Raie',               NULL,     'poisson'),
  ('Requin',             NULL,     'poisson'),
  ('Mulet',              NULL,     'poisson'),
  ('Courbine',           NULL,     'poisson'),
  ('Pageot',             NULL,     'poisson'),
  ('Espadon',            NULL,     'poisson'),
  ('Chinchard',          NULL,     'poisson'),
  -- Crustacés
  ('Crevette',           NULL,     'crustacé'),
  ('Crevette géante',    NULL,     'crustacé'),
  ('Langouste',          NULL,     'crustacé'),
  ('Crabe',              NULL,     'crustacé'),
  -- Céphalopodes
  ('Poulpe',             NULL,     'céphalopode'),
  ('Seiche',             NULL,     'céphalopode'),
  ('Calmar',             NULL,     'céphalopode'),
  -- Mollusques
  ('Huître',             NULL,     'mollusque'),
  ('Moule',              NULL,     'mollusque'),
  ('Palourde',           NULL,     'mollusque'),
  ('Cymbium',            NULL,     'mollusque')
ON CONFLICT (name_fr) DO NOTHING;
