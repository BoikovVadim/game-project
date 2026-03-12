import React from 'react';
import { useSearchParams } from 'react-router-dom';
import Login from './Login.tsx';
import Register from './Register.tsx';
import LandingLayout from './LandingLayout.tsx';

interface LandingHomeProps {
  onLogin: (token: string) => void;
}

const LandingHome: React.FC<LandingHomeProps> = ({ onLogin }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'register' ? 'register' : 'login';

  const switchTab = (tab: 'login' | 'register') => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'login') {
      next.delete('tab');
    } else {
      next.set('tab', 'register');
    }
    setSearchParams(next, { replace: true });
  };

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
        </div>

        <div className="landing-hero-form">
          <div className="landing-form-tabs">
            <button
              type="button"
              className={`landing-form-tab${activeTab === 'login' ? ' active' : ''}`}
              onClick={() => switchTab('login')}
            >
              Вход
            </button>
            <button
              type="button"
              className={`landing-form-tab${activeTab === 'register' ? ' active' : ''}`}
              onClick={() => switchTab('register')}
            >
              Регистрация
            </button>
          </div>
          {activeTab === 'login' ? <Login onLogin={onLogin} /> : <Register />}
        </div>
      </section>

      <section className="landing-features">
        <h2>Почему Legend Games?</h2>
        <div className="landing-features-grid">
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#128187;</div>
            <h3>Информационный онлайн-сервис</h3>
            <p>Цифровая платформа с полным функционалом: личный кабинет, статистика, управление балансом — всё в одном месте.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#128218;</div>
            <h3>Соревнования навыков и знаний</h3>
            <p>Мероприятия основаны на пользовательских навыках, знаниях и действиях. Результат зависит только от вас.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#9878;</div>
            <h3>Прозрачные правила</h3>
            <p>Результаты формируются автоматически на основе действий участников. Равные условия для каждого пользователя.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#9889;</div>
            <h3>Мгновенные результаты</h3>
            <p>Итоги соревновательных мероприятий доступны сразу после завершения. Автоматическое определение победителей.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#128274;</div>
            <h3>Безопасные платежи</h3>
            <p>Пополнение внутреннего баланса через сертифицированные платёжные системы. Данные карт не хранятся на платформе.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#127942;</div>
            <h3>Цифровые услуги</h3>
            <p>Все услуги оказываются исключительно в электронном виде. Доступ к функционалу платформы через личный кабинет.</p>
          </div>
        </div>
      </section>
    </LandingLayout>
  );
};

export default LandingHome;
