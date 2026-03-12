import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Login from './Login.tsx';
import LandingLayout from './LandingLayout.tsx';

interface LandingHomeProps {
  onLogin: (token: string) => void;
}

const LandingHome: React.FC<LandingHomeProps> = ({ onLogin }) => {
  return (
    <LandingLayout>
      <section className="landing-hero">
        <div className="landing-hero-text">
          <h1>Интеллектуальные<br/>турниры на <em>Legend Games</em></h1>
          <p>
            Соревновательная платформа, где побеждают знания.
            Участвуйте в турнирах, проверяйте свою эрудицию
            и поднимайтесь в рейтинге среди тысяч участников.
          </p>
          <Link to="/register" className="landing-hero-cta">Начать участие</Link>
        </div>

        <div className="landing-hero-form">
          <Login onLogin={onLogin} />
        </div>
      </section>

      <section className="landing-features">
        <h2>Почему Legend Games?</h2>
        <div className="landing-features-grid">
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#128218;</div>
            <h3>Интеллектуальные турниры</h3>
            <p>Проверьте свои знания в формате соревнований с реальными участниками. Вопросы из самых разных областей.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#9878;</div>
            <h3>Честная игра</h3>
            <p>Прозрачная система определения результатов. Каждый участник играет в равных условиях.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#9889;</div>
            <h3>Мгновенные результаты</h3>
            <p>Узнавайте итоги сразу после завершения раунда. Автоматическое определение победителей.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#127942;</div>
            <h3>Лиги и рейтинги</h3>
            <p>Разные уровни участия — от тренировок до соревновательных лиг. Растите вместе с платформой.</p>
          </div>
        </div>
      </section>
    </LandingLayout>
  );
};

export default LandingHome;
