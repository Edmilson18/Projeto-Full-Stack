-- Remove exclusivamente os pedidos de demonstração que o seed antigo
-- vinculava ao administrador. Os itens relacionados são removidos pela FK
-- ON DELETE CASCADE; pedidos reais permanecem intactos.
DELETE FROM pedidos
WHERE id IN (
  'ped-demo-1',
  'ped-demo-2',
  'ped-demo-3',
  'ped-demo-4',
  'ped-demo-5',
  'ped-demo-6',
  'ped-demo-7',
  'ped-demo-8'
);
