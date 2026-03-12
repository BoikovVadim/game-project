import React from 'react';
import LandingLayout from './LandingLayout';
import './Offer.css';

const Contacts: React.FC = () => (
  <LandingLayout>
    <div className="offer-page">
      <div className="offer-container">
        <h1>Контакты</h1>

        <section>
          <h2>Связаться с нами</h2>
          <p>Если у вас возникли вопросы о работе платформы, условиях участия в турнирах или технические проблемы — мы всегда на связи.</p>
        </section>

        <section>
          <h2>Электронная почта</h2>
          <p>Основной канал связи для всех обращений:</p>
          <p style={{ fontSize: '18px', fontWeight: 600 }}>
            <a href="mailto:support@legendgames.ru">support@legendgames.ru</a>
          </p>
          <p>Мы стараемся отвечать на обращения в течение 24 часов в рабочие дни.</p>
        </section>

        <section>
          <h2>Техническая поддержка</h2>
          <p>Для зарегистрированных пользователей доступна система обращений прямо из личного кабинета. Это самый быстрый способ получить помощь.</p>
        </section>

        <section>
          <h2>По каким вопросам можно обращаться</h2>
          <ul>
            <li>Регистрация и вход в аккаунт</li>
            <li>Проблемы с участием в турнирах</li>
            <li>Вопросы по пополнению баланса и операциям</li>
            <li>Предложения по улучшению платформы</li>
            <li>Запрос на удаление персональных данных</li>
            <li>Сообщения о нарушениях</li>
          </ul>
        </section>

        <section>
          <h2>Реквизиты</h2>
          <p>Платформа: Legend Games</p>
          <p>Сайт: <a href="/#/">legendgames.ru</a></p>
          <p>Email: <a href="mailto:support@legendgames.ru">support@legendgames.ru</a></p>
        </section>
      </div>
    </div>
  </LandingLayout>
);

export default Contacts;
