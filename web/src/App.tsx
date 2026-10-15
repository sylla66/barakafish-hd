import { Route, Routes } from 'react-router-dom';

import BecomeSeller from './pages/BecomeSeller';
import CreateListing from './pages/CreateListing';
import Home from './pages/Home';
import Login from './pages/Login';
import MyListings from './pages/MyListings';
import MyOrders from './pages/MyOrders';
import OrderCreate from './pages/OrderCreate';
import OrderDetail from './pages/OrderDetail';
import Profile from './pages/Profile';
import SellerStatusPage from './pages/SellerStatus';

// Routes de base. Les ecrans des etapes suivantes (annonces, commandes...)
// viendront s'ajouter ici.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/connexion" element={<Login />} />
      <Route path="/profil" element={<Profile />} />
      <Route path="/vendeur/inscription" element={<BecomeSeller />} />
      <Route path="/vendeur/statut" element={<SellerStatusPage />} />
      <Route path="/vendeur/annonces" element={<MyListings />} />
      <Route path="/vendeur/annonces/nouvelle" element={<CreateListing />} />
      <Route path="/commandes" element={<MyOrders />} />
      <Route path="/commandes/:id" element={<OrderDetail />} />
      <Route path="/commander/:listingId" element={<OrderCreate />} />
    </Routes>
  );
}
