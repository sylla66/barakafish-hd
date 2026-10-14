import { Link } from 'react-router-dom';

// Page d'accueil : squelette mobile first.
export default function Home() {
  return (
    <main className="page">
      <header className="page__entete">
        <h1>Baraka Fish HD</h1>
        <p>Poissons et fruits de mer frais et congeles en mer, au Senegal.</p>
      </header>

      <nav className="accueil__actions">
        <Link className="bouton" to="/connexion">
          Se connecter
        </Link>
        <Link className="bouton bouton--secondaire" to="/profil">
          Mon profil
        </Link>
        <Link className="bouton bouton--secondaire" to="/vendeur/inscription">
          Devenir vendeur
        </Link>
      </nav>

      <section className="page__contenu">
        <p>La plateforme arrive bientot. Catalogue, commandes et paiement securise.</p>
      </section>
    </main>
  );
}
