import React from 'react';
import LandingLayout from './LandingLayout.tsx';
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
          <h2>Реквизиты</h2>
          <table className="offer-requisites">
            <tbody>
              <tr><td>Наименование организации</td><td>АО «Ледженд Менеджмент»</td></tr>
              <tr><td>ИНН</td><td>3804122300</td></tr>
              <tr><td>ОГРН</td><td>1253800003050</td></tr>
              <tr><td>Юридический адрес</td><td>665730, Иркутская область, г.о. Город Братск, г. Братск, ж/р Энергетик, ул. Юбилейная, д. 53, кв. 42</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Электронная почта</h2>
          <p style={{ fontSize: '18px', fontWeight: 600 }}>
            <a href="mailto:LegendGames555@yandex.com">LegendGames555@yandex.com</a>
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
      </div>
    </div>
  </LandingLayout>
);

export default Contacts;
