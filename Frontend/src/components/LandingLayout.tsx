import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Landing.css';

const LandingLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path ? 'active' : '';

  return (
    <div className="landing-info-page">
      <header className="landing-header">
        <Link to="/" className="landing-logo"><span>Legend Games</span></Link>

        <button className="landing-mobile-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Меню">
          {mobileOpen ? '\u2715' : '\u2630'}
        </button>

        <nav className={`landing-nav${mobileOpen ? ' mobile-open' : ''}`}>
          <Link to="/" className={isActive('/')} onClick={() => setMobileOpen(false)}>Главная</Link>
          <Link to="/about" className={isActive('/about')} onClick={() => setMobileOpen(false)}>О сервисе</Link>
          <div
            className={`landing-nav-dropdown${rulesOpen ? ' open' : ''}`}
            onMouseEnter={() => setRulesOpen(true)}
            onMouseLeave={() => setRulesOpen(false)}
          >
            <button type="button" className="landing-nav-dropdown-toggle" onClick={() => setRulesOpen(!rulesOpen)}>
              Правила &#9662;
            </button>
            <div className="landing-nav-dropdown-menu">
              <Link to="/tournament-rules" onClick={() => { setRulesOpen(false); setMobileOpen(false); }}>Правила турниров</Link>
              <Link to="/balance-rules" onClick={() => { setRulesOpen(false); setMobileOpen(false); }}>Правила баланса</Link>
              <Link to="/reward-rules" onClick={() => { setRulesOpen(false); setMobileOpen(false); }}>Вознаграждения и выплаты</Link>
              <Link to="/verification-rules" onClick={() => { setRulesOpen(false); setMobileOpen(false); }}>Антифрод и верификация</Link>
              <Link to="/disputes-policy" onClick={() => { setRulesOpen(false); setMobileOpen(false); }}>Споры и претензии</Link>
              <Link to="/offer" onClick={() => { setRulesOpen(false); setMobileOpen(false); }}>Публичная оферта</Link>
            </div>
          </div>
          <Link to="/payment-terms" className={isActive('/payment-terms')} onClick={() => setMobileOpen(false)}>Оплата</Link>
          <Link to="/contacts" className={isActive('/contacts')} onClick={() => setMobileOpen(false)}>Контакты</Link>

          <div className="landing-auth-mobile" style={{ display: 'none' }}>
            <Link to="/" className="landing-btn-login" onClick={() => setMobileOpen(false)}>Вход</Link>
            <Link to="/?tab=register" className="landing-btn-register" onClick={() => setMobileOpen(false)}>Регистрация</Link>
          </div>
        </nav>

      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer className="landing-footer">
        <div className="landing-footer-links">
          <Link to="/">Главная</Link>
          <Link to="/about">О сервисе</Link>
          <Link to="/offer">Публичная оферта</Link>
          <Link to="/privacy">Политика конфиденциальности</Link>
          <Link to="/payment-terms">Условия оплаты</Link>
          <Link to="/tournament-rules">Правила турниров</Link>
          <Link to="/balance-rules">Правила баланса</Link>
          <Link to="/reward-rules">Вознаграждения и выплаты</Link>
          <Link to="/verification-rules">Антифрод и верификация</Link>
          <Link to="/disputes-policy">Споры и претензии</Link>
          <Link to="/contacts">Контакты</Link>
        </div>
        <div className="landing-footer-bottom">
          <p>&copy; {new Date().getFullYear()} АО «Ледженд Менеджмент». Все права защищены. Связь: <a href="mailto:LegendGames555@yandex.com">LegendGames555@yandex.com</a></p>
        </div>
      </footer>
    </div>
  );
};

export default LandingLayout;
