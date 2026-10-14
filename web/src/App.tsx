import { Route, Routes } from 'react-router-dom';

import Home from './pages/Home';
import Login from './pages/Login';
import Profile from './pages/Profile';

// Routes de base. Les ecrans des etapes suivantes (annonces, commandes...)
// viendront s'ajouter ici.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/connexion" element={<Login />} />
      <Route path="/profil" element={<Profile />} />
    </Routes>
  );
}
