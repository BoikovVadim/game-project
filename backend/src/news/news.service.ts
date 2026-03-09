import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execSync } from 'child_process';
import { resolve, join } from 'path';
import { News } from './news.entity';

const CW = '[а-яА-ЯёЁa-zA-Z0-9_]';
const CB = `(?<!${CW})`;
const CA = `(?!${CW})`;
function cyr(word: string, flags = 'gi'): RegExp { return new RegExp(`${CB}${word}${CA}`, flags); }

const TECH_TO_HUMAN: [RegExp, string][] = [
  [/\bCSS\b/gi, 'внешний вид'],
  [/\bHTML\b/gi, 'страница'],
  [/\bAPI\b/gi, 'система'],
  [/\bTypeORM\b/gi, ''],
  [/\bSQLite\b/gi, ''],
  [/\bNestJS\b/gi, ''],
  [/\bReact\b/gi, ''],
  [/\bTypeScript\b/gi, ''],
  [/\bCron\b/gi, 'автоматический процесс'],
  [/\btraining[- ]?panel\b/gi, 'раздел тренировки'],
  [/\bgame[- ]?history\b/gi, 'история игр'],
  [/\bhover\b/gi, 'при наведении'],
  [/\btimeout\b/gi, 'ожидание'],
  [/\bworkflow\b/gi, 'процесс'],
  [/\bpush\b/gi, 'отправка'],
  [/\bcommit\b/gi, 'обновление'],
  [/\bsupport\b/gi, 'поддержка'],
  [/\bescrow\b/gi, 'депозит'],
  [/\bsplat\b/gi, ''],
  [/\broute(s|r)?\b/gi, 'навигация'],
  [/\bproxy\b/gi, ''],
  [/\bdev[ -]?server\b/gi, ''],
  [/\bnode_modules\b/gi, ''],
  [/\bgit\b/gi, ''],
  [/\bJSON\b/gi, ''],
  [/\bJWT\b/gi, ''],
  [/\b520px\b/gi, ''],
  [/\btracking\b/gi, 'отслеживание'],
  [/\bGitHub\b/gi, ''],
  [/\bmax-width\b/gi, 'размер'],
  [/\boverflow\b/gi, 'прокрутка'],
  [/\bnormalizeAnswersChosen\b/gi, 'обработка ответов'],
  [/\bKPI[- ]?карточки/gi, 'сводные карточки'],
  [/\bKPI\b/gi, 'сводные показатели'],
  [cyr('автовозврат\\s+эскроу'), 'автоматический возврат средств'],
  [cyr('эскроу'), 'депозит'],
  [cyr('импeрсонаци[яию]\\s+админа'), 'просмотр аккаунта игрока администратором'],
  [cyr('импeрсонаци[яию]'), 'просмотр аккаунта игрока'],
  [cyr('тикетн(ая|ую|ой)\\s+систем[ауы]'), 'система обращений'],
  [cyr('тикет(а|е|ы|ов|ам|ами)?'), 'обращения'],
  [cyr('фронтенд'), 'интерфейс'],
  [cyr('фронт'), 'интерфейс'],
  [cyr('бэкенд'), 'серверная часть'],
  [cyr('бэк'), 'серверная часть'],
  [cyr('баг(и|ов)?'), 'ошибки'],
  [cyr('рефакторинг'), 'оптимизация'],
  [cyr('рефактор'), 'оптимизация'],
  [cyr('хот[- ]?релоад'), 'автообновление'],
  [cyr('таймаут(ы)?'), 'ожидание'],
  [cyr('модалк[аиуе]'), 'всплывающее окно'],
  [cyr('модальн\\w+'), 'всплывающее'],
  [cyr('эндпоинт(ы)?'), 'раздел'],
  [cyr('компонент(ы)?'), 'элемент'],
  [cyr('стейт'), 'данные'],
  [cyr('хук(и)?'), 'механизм'],
  [cyr('пропс(ы)?'), 'настройки'],
  [cyr('рендеринг'), 'отображение'],
  [cyr('рендер'), 'отображение'],
  [cyr('миграци[яию]'), 'обновление'],
  [cyr('схем[ауы]'), 'структура'],
  [cyr('стандартизаци[яию]\\s+таблиц'), 'единый стиль таблиц'],
  [cyr('блока?\\s+поддержка'), 'раздела поддержки'],
  [cyr('контейнеры'), 'области'],
  [cyr('контейнеров'), 'областей'],
  [cyr('контейнер'), 'область'],
  [cyr('флаг(и|ов)?'), 'настройки'],
  [cyr('дебагинг'), 'диагностика'],
  [cyr('дебаг'), 'диагностика'],
  [cyr('логирование'), 'запись событий'],
  [cyr('билд'), 'сборка'],
  [cyr('деплой'), 'публикация'],
  [cyr('мёрж(а|и)?'), 'объединение'],
  [cyr('пулл[- ]?реквест'), 'запрос на изменение'],
  [cyr('сервис'), 'модуль'],
  [cyr('контроллер'), 'обработчик'],
  [cyr('мидлвар[еэ]'), 'обработка'],
  [cyr('пуш'), 'отправка'],
  [cyr('супорт'), 'поддержка'],
  [/\+\s*фикс\b/gi, ''],
  [cyr('фикс'), 'исправление'],
];

const SKIP_PATTERNS = [
  /^chore/i,
  /^ci/i,
  /^build/i,
  /^test/i,
  /^docs/i,
  /initial commit/i,
  /merge branch/i,
  /remove database/i,
  /\.env\b/i,
  /node_modules/i,
  /package-lock/i,
  /\bgit\s*(config|ignore|sync|push|add)\b/i,
  /правило автоматической синхронизации/i,
  /оптимизация workflow/i,
  /Remove.*from tracking/i,
  /админк[аеиу]/i,
  /admin/i,
  /импeрсонаци/i,
  /импeрсонация/i,
  /просмотр аккаунта игрока/i,
];

function shouldSkip(msg: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(msg));
}

function humanize(text: string): string {
  let result = text;
  for (const [pattern, replacement] of TECH_TO_HUMAN) {
    result = result.replace(pattern, replacement);
  }
  result = result
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*,/g, '(')
    .replace(/,\s*\)/g, ')')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.\)])/g, '$1')
    .replace(/^[\s—–\-:,]+/, '')
    .trim();
  return result;
}

const INTROS = [
  'Мы продолжаем работать над улучшением игры, чтобы вам было ещё удобнее и интереснее играть. Вот что нового в этом обновлении:',
  'Команда разработчиков подготовила новую порцию улучшений! Мы стараемся сделать игру лучше с каждым обновлением. Вот что изменилось:',
  'Рады сообщить о свежем обновлении! Мы прислушиваемся к вашим пожеланиям и постоянно дорабатываем игру. Что нового:',
  'Новое обновление уже доступно! Мы поработали над удобством, исправили ряд недочётов и добавили полезные функции:',
  'Привет! Мы выпустили очередное обновление. Делимся подробностями — что стало лучше и что появилось нового:',
];

const OUTROS = [
  'Спасибо, что играете! Если заметите что-то необычное — пишите в поддержку, мы всегда на связи.',
  'Как всегда, будем рады вашей обратной связи. Хорошей игры!',
  'Мы продолжим улучшать игру. Следите за новостями и удачи в матчах!',
  'Приятной игры! Впереди ещё много интересных обновлений.',
  'Спасибо за вашу поддержку! Играйте, побеждайте и делитесь впечатлениями.',
];

@Injectable()
export class NewsService {
  constructor(
    @InjectRepository(News) private readonly repo: Repository<News>,
  ) {}

  async findAll(): Promise<News[]> {
    return this.repo.find({ where: { published: true }, order: { createdAt: 'DESC' } });
  }

  async findAllAdmin(): Promise<News[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async create(topic: string, body: string): Promise<News> {
    let hash: string | null = null;
    try {
      const repoRoot = resolve(join(__dirname, '..', '..', '..'));
      hash = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8', timeout: 3000 }).trim() || null;
    } catch {}
    const item = this.repo.create({ topic, body, published: true, commitHash: hash });
    return this.repo.save(item);
  }

  async update(id: number, data: { topic?: string; body?: string; published?: boolean }): Promise<News | null> {
    const item = await this.repo.findOneBy({ id });
    if (!item) return null;
    if (data.topic !== undefined) item.topic = data.topic;
    if (data.body !== undefined) item.body = data.body;
    if (data.published !== undefined) item.published = data.published;
    return this.repo.save(item);
  }

  async remove(id: number): Promise<boolean> {
    const res = await this.repo.delete(id);
    return (res.affected ?? 0) > 0;
  }

  async generate(): Promise<{ topic: string; body: string }> {
    const repoRoot = resolve(join(__dirname, '..', '..', '..'));

    let lastHash: string | null = null;
    try {
      const rows = await this.repo.find({ order: { createdAt: 'DESC' }, take: 1 });
      lastHash = rows.length > 0 ? (rows[0].commitHash ?? null) : null;
    } catch {
      lastHash = null;
    }

    if (lastHash) {
      try {
        execSync(`git cat-file -t ${lastHash}`, { cwd: repoRoot, encoding: 'utf-8', timeout: 3000 });
      } catch {
        lastHash = null;
      }
    }

    let raw = '';
    try {
      if (lastHash) {
        const headHash = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8', timeout: 3000 }).trim();
        if (headHash === lastHash) {
          return {
            topic: 'Обновление игры',
            body: 'С момента последней новости новых изменений не найдено. Попробуйте сгенерировать после следующего обновления.',
          };
        }
        raw = execSync(
          `git log ${lastHash}..HEAD --pretty=format:"%s" --no-merges`,
          { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 },
        ).trim();
      } else {
        raw = execSync(
          `git log --pretty=format:"%s" --no-merges`,
          { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 },
        ).trim();
      }
    } catch {
      try {
        raw = execSync(
          `git log -30 --pretty=format:"%s" --no-merges`,
          { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 },
        ).trim();
      } catch {
        return { topic: 'Обновление игры', body: 'Не удалось получить историю изменений.' };
      }
    }

    if (!raw) {
      return {
        topic: 'Обновление игры',
        body: 'С момента последней новости новых изменений не найдено. Попробуйте сгенерировать после следующего обновления.',
      };
    }

    const commits = raw.split('\n').filter(Boolean);

    const features: string[] = [];
    const fixes: string[] = [];
    const styles: string[] = [];

    for (const msg of commits) {
      if (shouldSkip(msg)) continue;

      const clean = msg
        .replace(/^(feat|fix|style|chore|refactor|perf|docs|test|ci|build)(\(.+?\))?:\s*/i, '')
        .trim();
      if (!clean) continue;

      const humanMsg = humanize(clean);
      if (!humanMsg || humanMsg.length < 5) continue;

      const first = humanMsg.charAt(0).toUpperCase() + humanMsg.slice(1);
      const line = first.endsWith('.') ? first : first + '.';

      if (/^feat/i.test(msg)) features.push(line);
      else if (/^fix/i.test(msg)) fixes.push(line);
      else if (/^style/i.test(msg)) styles.push(line);
      else features.push(line);
    }

    if (!features.length && !fixes.length && !styles.length) {
      return {
        topic: 'Обновление игры',
        body: 'С момента последней новости новых изменений не найдено. Попробуйте сгенерировать после следующего обновления.',
      };
    }

    const today = new Date();
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const dateStr = `${today.getDate()} ${months[today.getMonth()]}`;

    const topic = `Обновление игры — ${dateStr}`;

    const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const intro = pick(INTROS);
    const outro = pick(OUTROS);

    const sections: string[] = [];
    sections.push(intro);

    if (features.length) {
      sections.push('Что нового:\n' + features.map((f) => `• ${f}`).join('\n'));
    }
    if (fixes.length) {
      sections.push('Стало лучше:\n' + fixes.map((f) => `• ${f}`).join('\n'));
    }
    if (styles.length) {
      sections.push('Внешний вид:\n' + styles.map((f) => `• ${f}`).join('\n'));
    }

    sections.push(outro);

    const body = sections.join('\n\n');

    return { topic, body };
  }
}
