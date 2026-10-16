import { Route, Routes } from 'react-router-dom';

import AdminDisputeDetailPage from './pages/AdminDisputeDetail';
import AdminDisputes from './pages/AdminDisputes';
import BecomeSeller from './pages/BecomeSeller';
import CreateListing from './pages/CreateListing';
import Home from './pages/Home';
import Login from './pages/Login';
import MyListings from './pages/MyListings';
import MyOrders from './pages/MyOrders';
import OrderCreate from './pages/OrderCreate';
import OrderDetail from './pages/OrderDetail';
import PaymentReturn from './pages/PaymentReturn';
import Profile from './pages/Profile';
import SellerProfile from './pages/SellerProfile';
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
      <Route path="/vendeurs/:id" element={<SellerProfile />} />
      <Route path="/commander/:listingId" element={<OrderCreate />} />
      <Route path="/paiement/:reference" element={<PaymentReturn />} />
      <Route path="/admin/litiges" element={<AdminDisputes />} />
      <Route path="/admin/litiges/:id" element={<AdminDisputeDetailPage />} />
    </Routes>
  );
}
