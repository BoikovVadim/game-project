import { RawQuestion, shuffle, shuffleOptions } from './types';

type F = [string, string, string[]];

function rephrase(q: string): string {
  if (q.startsWith('Какое ')) return q.replace('Какое ', 'Назовите ');
  if (q.startsWith('Какой ')) return q.replace('Какой ', 'Укажите ');
  if (q.startsWith('Какая ')) return q.replace('Какая ', 'Назовите ');
  if (q.startsWith('Какие ')) return q.replace('Какие ', 'Перечислите ');
  if (q.startsWith('Сколько ')) return 'Какое количество: ' + q.slice(8);
  if (q.startsWith('Кто ')) return q.replace('Кто ', 'Кто из перечисленных ');
  if (q.startsWith('Как ')) return q.replace('Как ', 'Каким образом ');
  if (q.startsWith('Где ')) return q.replace('Где ', 'В каком месте ');
  if (q.startsWith('Что ')) return q.replace('Что ', 'Что именно ');
  if (q.startsWith('В каком ')) return 'Укажите: ' + q.charAt(0).toLowerCase() + q.slice(1);
  if (q.startsWith('У какого ')) return q.replace('У какого ', 'У которого из перечисленных ');
  if (q.startsWith('На каком ')) return 'Укажите: ' + q.charAt(0).toLowerCase() + q.slice(1);
  return 'Ответьте: ' + q.charAt(0).toLowerCase() + q.slice(1);
}

const LABELS: Record<string, string> = {
  animals: 'Животные',
  birds: 'Птицы',
  sea_creatures: 'Морские обитатели',
  insects_reptiles: 'Насекомые и рептилии',
  dinosaurs: 'Динозавры',
  plants_flowers: 'Растения и цветы',
  trees: 'Деревья',
  cars: 'Автомобили',
  trains: 'Поезда',
  aviation: 'Авиация',
  ships: 'Корабли',
  it_programming: 'IT и программирование',
  ai_robotics: 'ИИ и робототехника',
  internet: 'Интернет',
  social_media: 'Соцсети',
  gadgets_brands: 'Гаджеты и бренды',
  religions: 'Религии',
  space: 'Космос',
  space_missions: 'Космические миссии',
  astronomy: 'Астрономия',
  psychology: 'Психология',
  cooking: 'Кулинария',
  weather: 'Погода и климат',
  minerals: 'Минералы',
  world_records: 'Мировые рекорды',
};

function expand(topic: string, facts: F[]): RawQuestion[] {
  const label = LABELS[topic] ?? topic;
  const out: RawQuestion[] = [];
  for (const [q, c, w] of facts) {
    out.push(shuffleOptions(topic, q, c, w));
    out.push(shuffleOptions(topic, rephrase(q), c, w));
    out.push(shuffleOptions(topic, `Тема «${label}». ${q}`, c, w));
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// 1. ANIMALS
// ═══════════════════════════════════════════════════════════════
const ANIMALS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 2. BIRDS
// ═══════════════════════════════════════════════════════════════
const BIRDS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 3. SEA CREATURES
// ═══════════════════════════════════════════════════════════════
const SEA_CREATURES: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 4. INSECTS & REPTILES
// ═══════════════════════════════════════════════════════════════
const INSECTS_REPTILES: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 5. DINOSAURS
// ═══════════════════════════════════════════════════════════════
const DINOSAURS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 6. PLANTS & FLOWERS
// ═══════════════════════════════════════════════════════════════
const PLANTS_FLOWERS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 7. TREES
// ═══════════════════════════════════════════════════════════════
const TREES: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 8. CARS
// ═══════════════════════════════════════════════════════════════
const CARS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 9. TRAINS
// ═══════════════════════════════════════════════════════════════
const TRAINS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 10. AVIATION
// ═══════════════════════════════════════════════════════════════
const AVIATION: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 11. SHIPS
// ═══════════════════════════════════════════════════════════════
const SHIPS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 12. IT & PROGRAMMING
// ═══════════════════════════════════════════════════════════════
const IT_PROGRAMMING: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 13. AI & ROBOTICS
// ═══════════════════════════════════════════════════════════════
const AI_ROBOTICS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 14. INTERNET
// ═══════════════════════════════════════════════════════════════
const INTERNET: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 15. SOCIAL MEDIA
// ═══════════════════════════════════════════════════════════════
const SOCIAL_MEDIA: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 16. GADGETS & BRANDS
// ═══════════════════════════════════════════════════════════════
const GADGETS_BRANDS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 17. RELIGIONS
// ═══════════════════════════════════════════════════════════════
const RELIGIONS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 18. SPACE
// ═══════════════════════════════════════════════════════════════
const SPACE: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 19. SPACE MISSIONS
// ═══════════════════════════════════════════════════════════════
const SPACE_MISSIONS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 20. ASTRONOMY
// ═══════════════════════════════════════════════════════════════
const ASTRONOMY: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 21. PSYCHOLOGY
// ═══════════════════════════════════════════════════════════════
const PSYCHOLOGY: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 22. COOKING
// ═══════════════════════════════════════════════════════════════
const COOKING: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 23. WEATHER
// ═══════════════════════════════════════════════════════════════
const WEATHER: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 24. MINERALS
// ═══════════════════════════════════════════════════════════════
const MINERALS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// 25. WORLD RECORDS
// ═══════════════════════════════════════════════════════════════
const WORLD_RECORDS: F[] = [];

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════
export function generateNatureTech500(): RawQuestion[] {
  return [
    ...expand('animals', ANIMALS),
    ...expand('birds', BIRDS),
    ...expand('sea_creatures', SEA_CREATURES),
    ...expand('insects_reptiles', INSECTS_REPTILES),
    ...expand('dinosaurs', DINOSAURS),
    ...expand('plants_flowers', PLANTS_FLOWERS),
    ...expand('trees', TREES),
    ...expand('cars', CARS),
    ...expand('trains', TRAINS),
    ...expand('aviation', AVIATION),
    ...expand('ships', SHIPS),
    ...expand('it_programming', IT_PROGRAMMING),
    ...expand('ai_robotics', AI_ROBOTICS),
    ...expand('internet', INTERNET),
    ...expand('social_media', SOCIAL_MEDIA),
    ...expand('gadgets_brands', GADGETS_BRANDS),
    ...expand('religions', RELIGIONS),
    ...expand('space', SPACE),
    ...expand('space_missions', SPACE_MISSIONS),
    ...expand('astronomy', ASTRONOMY),
    ...expand('psychology', PSYCHOLOGY),
    ...expand('cooking', COOKING),
    ...expand('weather', WEATHER),
    ...expand('minerals', MINERALS),
    ...expand('world_records', WORLD_RECORDS),
  ];
}
