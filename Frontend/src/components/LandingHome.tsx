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
          <h1>Побеждай знаниями<br/>на <em>Legend Games</em></h1>
          <p>
            Соревновательная платформа интеллектуальных турниров.
            Участвуйте, демонстрируйте эрудицию
            и получайте вознаграждения за победы.
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

      <section className="landing-how-it-works">
        <h2>Как это работает</h2>
        <div className="landing-steps">
          <div className="landing-step">
            <div className="landing-step-number">1</div>
            <h3>Зарегистрируйтесь</h3>
            <p>Создайте аккаунт за минуту и получите доступ к личному кабинету со всем функционалом платформы.</p>
          </div>
          <div className="landing-step-arrow">&#10132;</div>
          <div className="landing-step">
            <div className="landing-step-number">2</div>
            <h3>Пополните баланс</h3>
            <p>Внесите средства через ЮKassa — быстро и безопасно. Суммы от 100 ₽ до 10 000 ₽.</p>
          </div>
          <div className="landing-step-arrow">&#10132;</div>
          <div className="landing-step">
            <div className="landing-step-number">3</div>
            <h3>Участвуйте в турнирах</h3>
            <p>Соревнуйтесь с другими участниками в формате 4 игроков. Турнир формируется автоматически.</p>
          </div>
          <div className="landing-step-arrow">&#10132;</div>
          <div className="landing-step">
            <div className="landing-step-number">4</div>
            <h3>Получайте вознаграждения</h3>
            <p>Побеждайте и выводите средства от 100 ₽. Выплата — до 3 рабочих дней.</p>
          </div>
        </div>
      </section>

      <section className="landing-features">
        <h2>Почему Legend Games?</h2>
        <div className="landing-features-grid">
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#127942;</div>
            <h3>Вознаграждения за победы</h3>
            <p>Получайте вознаграждения за участие и победу в соревновательных мероприятиях. Выводите средства удобным способом.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#129504;</div>
            <h3>Соревнования навыков</h3>
            <p>Результат зависит только от ваших знаний и навыков. Никакой случайности — побеждает сильнейший.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#9878;</div>
            <h3>Прозрачные правила</h3>
            <p>Результаты формируются автоматически на основе действий участников. Равные условия для каждого.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#9889;</div>
            <h3>Мгновенные результаты</h3>
            <p>Итоги турниров доступны сразу после завершения. Вознаграждение начисляется на баланс автоматически.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#128274;</div>
            <h3>Безопасные платежи</h3>
            <p>Пополнение и вывод средств через сертифицированные платёжные системы. Данные карт защищены.</p>
          </div>
          <div className="landing-feature-card">
            <div className="landing-feature-icon">&#128187;</div>
            <h3>Удобный личный кабинет</h3>
            <p>Статистика, управление балансом, история турниров и запрос на вывод средств — всё в одном месте.</p>
          </div>
        </div>
      </section>

      <section className="landing-rewards-banner">
        <div className="landing-rewards-content">
          <h2>Выигрывайте и выводите средства</h2>
          <p>Минимальная сумма для вывода — <strong>100 ₽</strong>. Срок обработки — до <strong>3 рабочих дней</strong>. Пополнение баланса от 100 ₽ до 10 000 ₽ через ЮKassa.</p>
          <button type="button" className="landing-hero-cta" onClick={() => switchTab('register')}>
            Начать играть
          </button>
        </div>
      </section>
    </LandingLayout>
  );
};

export default LandingHome;
