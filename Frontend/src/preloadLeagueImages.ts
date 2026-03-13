/**
 * Ранняя предзагрузка картинок лиг — вызывается при появлении токена (App)
 * и при монтировании Profile, чтобы к моменту открытия карусели картинки уже были в кэше.
 */
const LEAGUE_IMAGE_URLS: string[] = [
  '/leagues/league-amber.jpg',
  '/leagues/league-coral.jpg',
  '/leagues/league-jade.jpg',
  '/leagues/league-agate.jpg',
  '/leagues/league-amethyst.jpg',
  '/leagues/league-topaz.jpg',
  '/leagues/league-garnet.jpg',
  '/leagues/league-emerald.jpg',
  '/leagues/league-ruby.jpg',
  '/leagues/league-sapphire.jpg',
  '/leagues/league-opal.jpg',
  '/leagues/league-pearl.jpg',
  '/leagues/league-alexandrite.jpg',
  '/leagues/league-diamond.jpg',
  '/leagues/league-lapis.jpg',
  '/leagues/league-blackopal.jpg',
  '/leagues/league-almaz.jpg',
];

let preloadStarted = false;

export function preloadAllLeagueImages(): void {
  if (typeof window === 'undefined' || preloadStarted) return;
  preloadStarted = true;

  LEAGUE_IMAGE_URLS.forEach((href) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = href;
    document.head.appendChild(link);

    const img = new Image();
    img.src = href;
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {});
    }
  });
}
