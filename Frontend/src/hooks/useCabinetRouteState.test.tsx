import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useCabinetRouteState } from './useCabinetRouteState';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

function Probe() {
  const {
    section,
    statsMode,
    selectedLeague,
    setStatsMode,
    setSelectedLeague,
  } = useCabinetRouteState('news');

  return (
    <div>
      <div data-testid="section">{section}</div>
      <div data-testid="statsMode">{statsMode}</div>
      <div data-testid="league">{selectedLeague ?? 'none'}</div>
      <button type="button" onClick={() => setStatsMode('personal')}>personal</button>
      <button type="button" onClick={() => setSelectedLeague(50)}>league50</button>
    </div>
  );
}

test('restores stats mode and selected league from URL', () => {
  render(
    <MemoryRouter
      initialEntries={['/profile?section=statistics&statsMode=general&league=20']}
      future={routerFuture}
    >
      <Probe />
    </MemoryRouter>,
  );

  expect(screen.getByTestId('section').textContent).toBe('statistics');
  expect(screen.getByTestId('statsMode').textContent).toBe('general');
  expect(screen.getByTestId('league').textContent).toBe('20');
});

test('updates search-param-backed state through hook setters', () => {
  render(
    <MemoryRouter
      initialEntries={['/profile?section=statistics&statsMode=general&league=20']}
      future={routerFuture}
    >
      <Probe />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByText('personal'));
  fireEvent.click(screen.getByText('league50'));

  expect(screen.getByTestId('statsMode').textContent).toBe('personal');
  expect(screen.getByTestId('league').textContent).toBe('50');
});
