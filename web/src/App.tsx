import { Route, Routes } from 'react-router-dom';

import Home from './pages/Home';

// Routes de base. Les ecrans des etapes suivantes (auth, annonces, commandes...)
// viendront s'ajouter ici.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
