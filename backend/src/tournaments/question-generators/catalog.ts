import { generateCulture500 } from './expand-culture-500';
import { generateGeo500 } from './expand-geo-500';
import { generateHistory500 } from './expand-history-500';
import { generateNatureTech500 } from './expand-nature-tech-500';
import { generateEnglish } from './english-words';
import { generateGeoSpace } from './geo-space';
import { generateHistoryScience } from './history-science';
import { generateLiterature } from './literature';
import { generateLogic } from './logic';
import { generateMath } from './math';
import { generateMusicFilm } from './music-film';
import { generateNatureTechCulture } from './nature-tech-culture';
import type { RawQuestion } from './types';

export type QuestionGeneratorGroup = {
  name: string;
  generate: () => RawQuestion[];
};

export function getQuestionGeneratorGroups(): QuestionGeneratorGroup[] {
  return [
    { name: 'Math', generate: generateMath },
    { name: 'Logic', generate: generateLogic },
    { name: 'GeoSpace', generate: generateGeoSpace },
    { name: 'English', generate: generateEnglish },
    { name: 'Literature', generate: generateLiterature },
    { name: 'MusicFilm', generate: generateMusicFilm },
    { name: 'HistoryScience', generate: generateHistoryScience },
    { name: 'NatureTechCulture', generate: generateNatureTechCulture },
    { name: 'Geo500', generate: generateGeo500 },
    { name: 'Culture500', generate: generateCulture500 },
    { name: 'History500', generate: generateHistory500 },
    { name: 'NatureTech500', generate: generateNatureTech500 },
  ];
}

export function generateQuestionCatalog(): RawQuestion[] {
  return getQuestionGeneratorGroups().flatMap((group) => group.generate());
}
