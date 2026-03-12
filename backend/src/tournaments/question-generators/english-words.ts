import { RawQuestion, shuffleOptions, dedup } from './types';

const WORDS: [string, string][] = [
  // --- Еда и напитки ---
  ['apple', 'Яблоко'], ['banana', 'Банан'], ['orange', 'Апельсин'], ['grape', 'Виноград'],
  ['lemon', 'Лимон'], ['cherry', 'Вишня'], ['peach', 'Персик'], ['pear', 'Груша'],
  ['plum', 'Слива'], ['melon', 'Дыня'], ['watermelon', 'Арбуз'], ['strawberry', 'Клубника'],
  ['raspberry', 'Малина'], ['blueberry', 'Черника'], ['pineapple', 'Ананас'],
  ['mango', 'Манго'], ['coconut', 'Кокос'], ['fig', 'Инжир'], ['apricot', 'Абрикос'],
  ['pomegranate', 'Гранат'], ['bread', 'Хлеб'], ['butter', 'Масло'], ['cheese', 'Сыр'],
  ['milk', 'Молоко'], ['egg', 'Яйцо'], ['meat', 'Мясо'], ['chicken', 'Курица'],
  ['fish', 'Рыба'], ['rice', 'Рис'], ['pasta', 'Макароны'], ['soup', 'Суп'],
  ['salad', 'Салат'], ['cake', 'Торт'], ['cookie', 'Печенье'], ['candy', 'Конфета'],
  ['chocolate', 'Шоколад'], ['ice cream', 'Мороженое'], ['sugar', 'Сахар'], ['salt', 'Соль'],
  ['pepper', 'Перец'], ['honey', 'Мёд'], ['jam', 'Варенье'], ['juice', 'Сок'],
  ['tea', 'Чай'], ['coffee', 'Кофе'], ['water', 'Вода'], ['wine', 'Вино'],
  ['beer', 'Пиво'], ['sandwich', 'Бутерброд'], ['pizza', 'Пицца'],
  ['sausage', 'Колбаса'], ['ham', 'Ветчина'], ['mushroom', 'Гриб'],
  ['onion', 'Лук'], ['garlic', 'Чеснок'], ['tomato', 'Помидор'],
  ['cucumber', 'Огурец'], ['potato', 'Картофель'], ['carrot', 'Морковь'],
  ['cabbage', 'Капуста'], ['corn', 'Кукуруза'], ['bean', 'Фасоль'],
  ['pea', 'Горох'], ['nut', 'Орех'], ['flour', 'Мука'],
  ['oil', 'Масло растительное'], ['vinegar', 'Уксус'],

  // --- Животные ---
  ['cat', 'Кот'], ['dog', 'Собака'], ['horse', 'Лошадь'], ['cow', 'Корова'],
  ['pig', 'Свинья'], ['sheep', 'Овца'], ['goat', 'Коза'], ['rabbit', 'Кролик'],
  ['mouse', 'Мышь'], ['rat', 'Крыса'], ['bird', 'Птица'], ['eagle', 'Орёл'],
  ['owl', 'Сова'], ['parrot', 'Попугай'], ['duck', 'Утка'], ['goose', 'Гусь'],
  ['swan', 'Лебедь'], ['penguin', 'Пингвин'], ['bear', 'Медведь'], ['wolf', 'Волк'],
  ['fox', 'Лиса'], ['deer', 'Олень'], ['lion', 'Лев'], ['tiger', 'Тигр'],
  ['elephant', 'Слон'], ['monkey', 'Обезьяна'], ['snake', 'Змея'], ['frog', 'Лягушка'],
  ['turtle', 'Черепаха'], ['whale', 'Кит'], ['dolphin', 'Дельфин'], ['shark', 'Акула'],
  ['butterfly', 'Бабочка'], ['bee', 'Пчела'], ['ant', 'Муравей'], ['spider', 'Паук'],
  ['fly', 'Муха'], ['mosquito', 'Комар'], ['worm', 'Червь'], ['snail', 'Улитка'],
  ['hedgehog', 'Ёж'], ['squirrel', 'Белка'], ['bat', 'Летучая мышь'],
  ['camel', 'Верблюд'], ['giraffe', 'Жираф'], ['zebra', 'Зебра'],
  ['crocodile', 'Крокодил'], ['hippopotamus', 'Бегемот'], ['rhinoceros', 'Носорог'],
  ['kangaroo', 'Кенгуру'], ['panda', 'Панда'], ['leopard', 'Леопард'],
  ['cheetah', 'Гепард'], ['jaguar', 'Ягуар'], ['gorilla', 'Горилла'],
  ['octopus', 'Осьминог'], ['jellyfish', 'Медуза'], ['starfish', 'Морская звезда'],
  ['lobster', 'Омар'], ['crab', 'Краб'], ['rooster', 'Петух'],
  ['pigeon', 'Голубь'], ['crow', 'Ворона'], ['sparrow', 'Воробей'],

  // --- Дом и быт ---
  ['house', 'Дом'], ['door', 'Дверь'], ['window', 'Окно'], ['wall', 'Стена'],
  ['floor', 'Пол'], ['ceiling', 'Потолок'], ['roof', 'Крыша'], ['room', 'Комната'],
  ['kitchen', 'Кухня'], ['bedroom', 'Спальня'], ['bathroom', 'Ванная'],
  ['garden', 'Сад'], ['yard', 'Двор'], ['fence', 'Забор'], ['stairs', 'Лестница'],
  ['table', 'Стол'], ['chair', 'Стул'], ['bed', 'Кровать'], ['sofa', 'Диван'],
  ['lamp', 'Лампа'], ['mirror', 'Зеркало'], ['clock', 'Часы'], ['carpet', 'Ковёр'],
  ['curtain', 'Штора'], ['pillow', 'Подушка'], ['blanket', 'Одеяло'],
  ['towel', 'Полотенце'], ['soap', 'Мыло'], ['shelf', 'Полка'], ['drawer', 'Ящик'],
  ['key', 'Ключ'], ['lock', 'Замок'], ['bell', 'Колокольчик'],
  ['broom', 'Метла'], ['bucket', 'Ведро'], ['plate', 'Тарелка'],
  ['cup', 'Чашка'], ['glass', 'Стакан'], ['fork', 'Вилка'], ['spoon', 'Ложка'],
  ['knife', 'Нож'], ['pan', 'Сковорода'], ['pot', 'Кастрюля'],
  ['bottle', 'Бутылка'], ['box', 'Коробка'], ['bag', 'Сумка'],
  ['basket', 'Корзина'], ['vase', 'Ваза'], ['candle', 'Свеча'],
  ['refrigerator', 'Холодильник'], ['oven', 'Духовка'], ['sink', 'Раковина'],

  // --- Одежда и аксессуары ---
  ['shirt', 'Рубашка'], ['dress', 'Платье'], ['skirt', 'Юбка'], ['pants', 'Брюки'],
  ['jeans', 'Джинсы'], ['jacket', 'Куртка'], ['coat', 'Пальто'], ['sweater', 'Свитер'],
  ['hat', 'Шляпа'], ['cap', 'Кепка'], ['gloves', 'Перчатки'], ['scarf', 'Шарф'],
  ['socks', 'Носки'], ['shoes', 'Туфли'], ['boots', 'Ботинки'], ['tie', 'Галстук'],
  ['belt', 'Ремень'], ['umbrella', 'Зонт'], ['ring', 'Кольцо'], ['necklace', 'Ожерелье'],
  ['watch', 'Наручные часы'], ['glasses', 'Очки'], ['pocket', 'Карман'],
  ['button', 'Пуговица'], ['zipper', 'Молния'], ['sleeve', 'Рукав'],
  ['collar', 'Воротник'], ['helmet', 'Шлем'], ['uniform', 'Форма'],
  ['swimsuit', 'Купальник'],

  // --- Тело ---
  ['head', 'Голова'], ['face', 'Лицо'], ['eye', 'Глаз'], ['ear', 'Ухо'],
  ['nose', 'Нос'], ['mouth', 'Рот'], ['tooth', 'Зуб'], ['tongue', 'Язык'],
  ['lip', 'Губа'], ['hair', 'Волосы'], ['neck', 'Шея'], ['shoulder', 'Плечо'],
  ['arm', 'Рука'], ['hand', 'Кисть'], ['finger', 'Палец'], ['leg', 'Нога'],
  ['knee', 'Колено'], ['foot', 'Ступня'], ['back', 'Спина'], ['chest', 'Грудь'],
  ['heart', 'Сердце'], ['brain', 'Мозг'], ['bone', 'Кость'], ['skin', 'Кожа'],
  ['blood', 'Кровь'], ['muscle', 'Мышца'], ['stomach', 'Желудок'],
  ['elbow', 'Локоть'], ['wrist', 'Запястье'], ['thumb', 'Большой палец'],
  ['chin', 'Подбородок'], ['forehead', 'Лоб'], ['cheek', 'Щека'],
  ['eyebrow', 'Бровь'], ['beard', 'Борода'],

  // --- Природа ---
  ['sun', 'Солнце'], ['moon', 'Луна'], ['star', 'Звезда'], ['sky', 'Небо'],
  ['cloud', 'Облако'], ['rain', 'Дождь'], ['snow', 'Снег'], ['wind', 'Ветер'],
  ['storm', 'Шторм'], ['thunder', 'Гром'], ['lightning', 'Молния'],
  ['rainbow', 'Радуга'], ['river', 'Река'], ['lake', 'Озеро'], ['sea', 'Море'],
  ['ocean', 'Океан'], ['mountain', 'Гора'], ['hill', 'Холм'], ['forest', 'Лес'],
  ['tree', 'Дерево'], ['flower', 'Цветок'], ['grass', 'Трава'], ['leaf', 'Лист'],
  ['stone', 'Камень'], ['sand', 'Песок'], ['island', 'Остров'], ['field', 'Поле'],
  ['earth', 'Земля'], ['fire', 'Огонь'], ['ice', 'Лёд'], ['wave', 'Волна'],
  ['waterfall', 'Водопад'], ['desert', 'Пустыня'], ['cave', 'Пещера'],
  ['volcano', 'Вулкан'], ['swamp', 'Болото'], ['valley', 'Долина'],
  ['cliff', 'Утёс'], ['bush', 'Куст'], ['root', 'Корень'], ['branch', 'Ветка'],
  ['seed', 'Семя'], ['rose', 'Роза'], ['daisy', 'Ромашка'],
  ['tulip', 'Тюльпан'], ['lily', 'Лилия'], ['sunflower', 'Подсолнух'],

  // --- Профессии ---
  ['doctor', 'Врач'], ['teacher', 'Учитель'], ['engineer', 'Инженер'],
  ['lawyer', 'Юрист'], ['pilot', 'Пилот'], ['driver', 'Водитель'],
  ['cook', 'Повар'], ['farmer', 'Фермер'], ['artist', 'Художник'],
  ['singer', 'Певец'], ['actor', 'Актёр'], ['writer', 'Писатель'],
  ['scientist', 'Учёный'], ['nurse', 'Медсестра'], ['policeman', 'Полицейский'],
  ['fireman', 'Пожарный'], ['soldier', 'Солдат'], ['sailor', 'Моряк'],
  ['builder', 'Строитель'], ['mechanic', 'Механик'], ['dentist', 'Стоматолог'],
  ['journalist', 'Журналист'], ['photographer', 'Фотограф'], ['musician', 'Музыкант'],
  ['programmer', 'Программист'], ['accountant', 'Бухгалтер'], ['judge', 'Судья'],
  ['librarian', 'Библиотекарь'], ['waiter', 'Официант'], ['baker', 'Пекарь'],
  ['butcher', 'Мясник'], ['tailor', 'Портной'], ['barber', 'Парикмахер'],
  ['plumber', 'Сантехник'], ['electrician', 'Электрик'],

  // --- Транспорт ---
  ['car', 'Машина'], ['bus', 'Автобус'], ['train', 'Поезд'], ['plane', 'Самолёт'],
  ['ship', 'Корабль'], ['boat', 'Лодка'], ['bicycle', 'Велосипед'],
  ['motorcycle', 'Мотоцикл'], ['helicopter', 'Вертолёт'], ['truck', 'Грузовик'],
  ['taxi', 'Такси'], ['subway', 'Метро'], ['tram', 'Трамвай'],
  ['rocket', 'Ракета'], ['ambulance', 'Скорая помощь'], ['wheel', 'Колесо'],
  ['engine', 'Двигатель'], ['bridge', 'Мост'], ['road', 'Дорога'],
  ['highway', 'Шоссе'], ['airport', 'Аэропорт'], ['station', 'Станция'],
  ['harbor', 'Гавань'], ['fuel', 'Топливо'], ['ticket', 'Билет'],

  // --- Школа и образование ---
  ['school', 'Школа'], ['book', 'Книга'], ['pen', 'Ручка'], ['pencil', 'Карандаш'],
  ['paper', 'Бумага'], ['notebook', 'Тетрадь'], ['desk', 'Парта'],
  ['blackboard', 'Доска'], ['lesson', 'Урок'], ['homework', 'Домашнее задание'],
  ['exam', 'Экзамен'], ['student', 'Студент'], ['pupil', 'Ученик'],
  ['classroom', 'Класс'], ['library', 'Библиотека'], ['dictionary', 'Словарь'],
  ['map', 'Карта'], ['ruler', 'Линейка'], ['eraser', 'Ластик'],
  ['chalk', 'Мел'], ['page', 'Страница'], ['letter', 'Буква'],
  ['word', 'Слово'], ['sentence', 'Предложение'], ['number', 'Число'],
  ['question', 'Вопрос'], ['answer', 'Ответ'], ['knowledge', 'Знание'],
  ['science', 'Наука'], ['history', 'История'], ['geography', 'География'],
  ['mathematics', 'Математика'], ['physics', 'Физика'], ['chemistry', 'Химия'],
  ['biology', 'Биология'], ['literature', 'Литература'], ['language', 'Язык'],
  ['grade', 'Оценка'], ['diploma', 'Диплом'], ['university', 'Университет'],

  // --- Время ---
  ['day', 'День'], ['night', 'Ночь'], ['morning', 'Утро'], ['evening', 'Вечер'],
  ['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год'], ['hour', 'Час'],
  ['minute', 'Минута'], ['second', 'Секунда'], ['today', 'Сегодня'],
  ['tomorrow', 'Завтра'], ['yesterday', 'Вчера'], ['spring', 'Весна'],
  ['summer', 'Лето'], ['autumn', 'Осень'], ['winter', 'Зима'],
  ['Monday', 'Понедельник'], ['Tuesday', 'Вторник'], ['Wednesday', 'Среда'],
  ['Thursday', 'Четверг'], ['Friday', 'Пятница'], ['Saturday', 'Суббота'],
  ['Sunday', 'Воскресенье'], ['January', 'Январь'], ['February', 'Февраль'],
  ['March', 'Март'], ['April', 'Апрель'], ['May', 'Май'], ['June', 'Июнь'],
  ['July', 'Июль'], ['August', 'Август'], ['September', 'Сентябрь'],
  ['October', 'Октябрь'], ['November', 'Ноябрь'], ['December', 'Декабрь'],
  ['century', 'Век'], ['holiday', 'Праздник'], ['birthday', 'День рождения'],
  ['midnight', 'Полночь'], ['noon', 'Полдень'], ['dawn', 'Рассвет'],
  ['sunset', 'Закат'],

  // --- Прилагательные ---
  ['big', 'Большой'], ['small', 'Маленький'], ['long', 'Длинный'], ['short', 'Короткий'],
  ['tall', 'Высокий'], ['wide', 'Широкий'], ['narrow', 'Узкий'], ['thick', 'Толстый'],
  ['thin', 'Тонкий'], ['heavy', 'Тяжёлый'], ['light', 'Лёгкий'], ['fast', 'Быстрый'],
  ['slow', 'Медленный'], ['hot', 'Горячий'], ['cold', 'Холодный'], ['warm', 'Тёплый'],
  ['cool', 'Прохладный'], ['new', 'Новый'], ['old', 'Старый'], ['young', 'Молодой'],
  ['good', 'Хороший'], ['bad', 'Плохой'], ['beautiful', 'Красивый'], ['ugly', 'Некрасивый'],
  ['happy', 'Счастливый'], ['sad', 'Грустный'], ['angry', 'Злой'], ['kind', 'Добрый'],
  ['brave', 'Храбрый'], ['clever', 'Умный'], ['stupid', 'Глупый'], ['rich', 'Богатый'],
  ['poor', 'Бедный'], ['strong', 'Сильный'], ['weak', 'Слабый'], ['loud', 'Громкий'],
  ['quiet', 'Тихий'], ['dark', 'Тёмный'], ['bright', 'Яркий'], ['clean', 'Чистый'],
  ['dirty', 'Грязный'], ['dry', 'Сухой'], ['wet', 'Мокрый'], ['hard', 'Твёрдый'],
  ['soft', 'Мягкий'], ['sharp', 'Острый'], ['smooth', 'Гладкий'], ['rough', 'Шероховатый'],
  ['deep', 'Глубокий'], ['shallow', 'Мелкий'], ['full', 'Полный'], ['empty', 'Пустой'],
  ['round', 'Круглый'], ['flat', 'Плоский'], ['straight', 'Прямой'], ['sweet', 'Сладкий'],
  ['bitter', 'Горький'], ['sour', 'Кислый'], ['fresh', 'Свежий'], ['rotten', 'Гнилой'],
  ['alive', 'Живой'], ['dead', 'Мёртвый'], ['safe', 'Безопасный'], ['dangerous', 'Опасный'],
  ['free', 'Свободный'], ['busy', 'Занятой'], ['lazy', 'Ленивый'],
  ['careful', 'Осторожный'], ['honest', 'Честный'], ['polite', 'Вежливый'],
  ['rude', 'Грубый'], ['shy', 'Застенчивый'], ['proud', 'Гордый'],
  ['jealous', 'Ревнивый'], ['lonely', 'Одинокий'], ['famous', 'Знаменитый'],
  ['strange', 'Странный'], ['funny', 'Смешной'], ['serious', 'Серьёзный'],
  ['important', 'Важный'], ['simple', 'Простой'], ['difficult', 'Трудный'],
  ['possible', 'Возможный'], ['impossible', 'Невозможный'], ['necessary', 'Необходимый'],
  ['useful', 'Полезный'], ['useless', 'Бесполезный'], ['lucky', 'Везучий'],
  ['huge', 'Огромный'], ['tiny', 'Крошечный'], ['ancient', 'Древний'],
  ['modern', 'Современный'], ['favorite', 'Любимый'], ['ordinary', 'Обычный'],

  // --- Глаголы ---
  ['run', 'Бежать'], ['walk', 'Ходить'], ['jump', 'Прыгать'], ['swim', 'Плавать'],
  ['fly', 'Летать'], ['sit', 'Сидеть'], ['stand', 'Стоять'], ['sleep', 'Спать'],
  ['eat', 'Есть'], ['drink', 'Пить'], ['read', 'Читать'], ['write', 'Писать'],
  ['speak', 'Говорить'], ['listen', 'Слушать'], ['sing', 'Петь'], ['dance', 'Танцевать'],
  ['play', 'Играть'], ['work', 'Работать'], ['study', 'Учиться'], ['think', 'Думать'],
  ['know', 'Знать'], ['see', 'Видеть'], ['hear', 'Слышать'], ['feel', 'Чувствовать'],
  ['love', 'Любить'], ['hate', 'Ненавидеть'], ['want', 'Хотеть'], ['need', 'Нуждаться'],
  ['give', 'Давать'], ['take', 'Брать'], ['buy', 'Покупать'], ['sell', 'Продавать'],
  ['open', 'Открывать'], ['close', 'Закрывать'], ['begin', 'Начинать'], ['finish', 'Заканчивать'],
  ['build', 'Строить'], ['break', 'Ломать'], ['fix', 'Чинить'], ['cut', 'Резать'],
  ['draw', 'Рисовать'], ['paint', 'Красить'], ['cook', 'Готовить'], ['wash', 'Мыть'],
  ['clean', 'Убирать'], ['carry', 'Нести'], ['throw', 'Бросать'], ['catch', 'Ловить'],
  ['push', 'Толкать'], ['pull', 'Тянуть'], ['climb', 'Лезть'], ['fall', 'Падать'],
  ['cry', 'Плакать'], ['laugh', 'Смеяться'], ['smile', 'Улыбаться'], ['shout', 'Кричать'],
  ['whisper', 'Шептать'], ['wait', 'Ждать'], ['find', 'Находить'], ['lose', 'Терять'],
  ['hide', 'Прятать'], ['show', 'Показывать'], ['teach', 'Учить'], ['learn', 'Учиться'],
  ['help', 'Помогать'], ['fight', 'Драться'], ['win', 'Побеждать'], ['choose', 'Выбирать'],
  ['try', 'Пытаться'], ['hope', 'Надеяться'], ['believe', 'Верить'], ['dream', 'Мечтать'],
  ['remember', 'Помнить'], ['forget', 'Забывать'], ['promise', 'Обещать'],
  ['invite', 'Приглашать'], ['meet', 'Встречать'], ['leave', 'Уходить'],
  ['return', 'Возвращаться'], ['travel', 'Путешествовать'], ['arrive', 'Прибывать'],
  ['send', 'Отправлять'], ['receive', 'Получать'], ['count', 'Считать'],
  ['measure', 'Измерять'], ['grow', 'Расти'], ['die', 'Умирать'],
  ['breathe', 'Дышать'], ['wake', 'Просыпаться'], ['burn', 'Гореть'],
  ['freeze', 'Замерзать'], ['melt', 'Таять'], ['shine', 'Сиять'],
  ['hang', 'Вешать'], ['dig', 'Копать'], ['pour', 'Лить'],
  ['mix', 'Смешивать'], ['boil', 'Кипятить'], ['bake', 'Печь'],
  ['taste', 'Пробовать'], ['smell', 'Нюхать'], ['touch', 'Трогать'],

  // --- Семья ---
  ['family', 'Семья'], ['mother', 'Мать'], ['father', 'Отец'], ['brother', 'Брат'],
  ['sister', 'Сестра'], ['son', 'Сын'], ['daughter', 'Дочь'], ['husband', 'Муж'],
  ['wife', 'Жена'], ['grandmother', 'Бабушка'], ['grandfather', 'Дедушка'],
  ['uncle', 'Дядя'], ['aunt', 'Тётя'], ['cousin', 'Двоюродный брат'],
  ['nephew', 'Племянник'], ['niece', 'Племянница'], ['baby', 'Малыш'],
  ['child', 'Ребёнок'], ['boy', 'Мальчик'], ['girl', 'Девочка'],
  ['man', 'Мужчина'], ['woman', 'Женщина'], ['friend', 'Друг'],
  ['neighbor', 'Сосед'], ['guest', 'Гость'], ['stranger', 'Незнакомец'],

  // --- Город и места ---
  ['city', 'Город'], ['town', 'Городок'], ['village', 'Деревня'], ['street', 'Улица'],
  ['square', 'Площадь'], ['park', 'Парк'], ['church', 'Церковь'], ['castle', 'Замок'],
  ['museum', 'Музей'], ['theater', 'Театр'], ['cinema', 'Кинотеатр'],
  ['hospital', 'Больница'], ['pharmacy', 'Аптека'], ['bank', 'Банк'],
  ['store', 'Магазин'], ['market', 'Рынок'], ['restaurant', 'Ресторан'],
  ['hotel', 'Гостиница'], ['factory', 'Фабрика'], ['office', 'Офис'],
  ['prison', 'Тюрьма'], ['palace', 'Дворец'], ['tower', 'Башня'],
  ['monument', 'Памятник'], ['fountain', 'Фонтан'], ['stadium', 'Стадион'],
  ['pool', 'Бассейн'], ['zoo', 'Зоопарк'], ['temple', 'Храм'],
  ['cemetery', 'Кладбище'],

  // --- Абстрактные и разные существительные ---
  ['name', 'Имя'], ['age', 'Возраст'], ['life', 'Жизнь'], ['death', 'Смерть'],
  ['health', 'Здоровье'], ['happiness', 'Счастье'], ['truth', 'Правда'],
  ['lie', 'Ложь'], ['peace', 'Мир'], ['war', 'Война'], ['freedom', 'Свобода'],
  ['power', 'Власть'], ['money', 'Деньги'], ['price', 'Цена'], ['job', 'Работа'],
  ['dream', 'Мечта'], ['idea', 'Идея'], ['problem', 'Проблема'], ['mistake', 'Ошибка'],
  ['success', 'Успех'], ['failure', 'Неудача'], ['fear', 'Страх'], ['hope', 'Надежда'],
  ['love', 'Любовь'], ['anger', 'Гнев'], ['joy', 'Радость'], ['pain', 'Боль'],
  ['luck', 'Удача'], ['fate', 'Судьба'], ['secret', 'Тайна'], ['surprise', 'Сюрприз'],
  ['gift', 'Подарок'], ['reward', 'Награда'], ['punishment', 'Наказание'],
  ['rule', 'Правило'], ['law', 'Закон'], ['right', 'Право'],
  ['duty', 'Долг'], ['reason', 'Причина'], ['result', 'Результат'],
  ['example', 'Пример'], ['story', 'История'], ['song', 'Песня'],
  ['game', 'Игра'], ['sport', 'Спорт'], ['team', 'Команда'],
  ['goal', 'Цель'], ['victory', 'Победа'], ['chance', 'Шанс'],
  ['choice', 'Выбор'], ['voice', 'Голос'], ['sound', 'Звук'],
  ['noise', 'Шум'], ['silence', 'Тишина'], ['smell', 'Запах'],
  ['taste', 'Вкус'], ['color', 'Цвет'], ['shape', 'Форма'],
  ['size', 'Размер'], ['weight', 'Вес'], ['speed', 'Скорость'],
  ['distance', 'Расстояние'], ['height', 'Высота'], ['depth', 'Глубина'],
  ['width', 'Ширина'], ['length', 'Длина'], ['beginning', 'Начало'],
  ['end', 'Конец'], ['middle', 'Середина'], ['part', 'Часть'],
  ['whole', 'Целое'], ['half', 'Половина'], ['edge', 'Край'],
  ['corner', 'Угол'], ['center', 'Центр'], ['side', 'Сторона'],
  ['top', 'Верх'], ['bottom', 'Низ'], ['front', 'Перед'],
  ['weather', 'Погода'], ['temperature', 'Температура'], ['degree', 'Градус'],
  ['air', 'Воздух'], ['smoke', 'Дым'], ['dust', 'Пыль'],
  ['shadow', 'Тень'], ['light', 'Свет'], ['darkness', 'Темнота'],
  ['gold', 'Золото'], ['silver', 'Серебро'], ['iron', 'Железо'],
  ['steel', 'Сталь'], ['wood', 'Древесина'], ['cotton', 'Хлопок'],
  ['wool', 'Шерсть'], ['silk', 'Шёлк'], ['leather', 'Кожа'],
  ['diamond', 'Алмаз'], ['pearl', 'Жемчуг'], ['copper', 'Медь'],

  // --- Числительные и местоимения ---
  ['one', 'Один'], ['two', 'Два'], ['three', 'Три'], ['four', 'Четыре'],
  ['five', 'Пять'], ['six', 'Шесть'], ['seven', 'Семь'], ['eight', 'Восемь'],
  ['nine', 'Девять'], ['ten', 'Десять'], ['hundred', 'Сто'], ['thousand', 'Тысяча'],
  ['million', 'Миллион'], ['first', 'Первый'], ['last', 'Последний'],
];

export function generateEnglish(): RawQuestion[] {
  const items: RawQuestion[] = [];
  const allRussian = WORDS.map(([, r]) => r);

  for (const [eng, rus] of WORDS) {
    const wrong: string[] = [];
    const used = new Set<string>([rus]);
    while (wrong.length < 3) {
      const pick = allRussian[Math.floor(Math.random() * allRussian.length)]!;
      if (!used.has(pick)) {
        used.add(pick);
        wrong.push(pick);
      }
    }
    items.push(
      shuffleOptions(
        'english_translation',
        `Как переводится слово '${eng}'?`,
        rus,
        wrong,
      ),
    );
  }

  for (const [eng, rus] of WORDS) {
    const wrong: string[] = [];
    const used = new Set<string>([rus]);
    while (wrong.length < 3) {
      const pick = allRussian[Math.floor(Math.random() * allRussian.length)]!;
      if (!used.has(pick)) {
        used.add(pick);
        wrong.push(pick);
      }
    }
    items.push(
      shuffleOptions(
        'english_translation',
        `Выберите перевод слова '${eng}':`,
        rus,
        wrong,
      ),
    );
  }

  const allEnglish = WORDS.map(([e]) => e);
  for (const [eng, rus] of WORDS) {
    const wrong: string[] = [];
    const used = new Set<string>([eng]);
    while (wrong.length < 3) {
      const pick = allEnglish[Math.floor(Math.random() * allEnglish.length)]!;
      if (!used.has(pick)) {
        used.add(pick);
        wrong.push(pick);
      }
    }
    items.push(
      shuffleOptions(
        'english_translation',
        `Какое английское слово означает '${rus}'?`,
        eng,
        wrong,
      ),
    );
  }

  return dedup(items);
}
