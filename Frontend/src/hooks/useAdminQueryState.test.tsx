import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAdminQueryState } from './useAdminQueryState';

function Probe() {
  const { state, patchQuery } = useAdminQueryState();

  return (
    <div>
      <div data-testid="section">{state.section}</div>
      <div data-testid="status">{state.withdrawalStatus || 'empty'}</div>
      <div data-testid="supportTicket">{state.supportTicket ?? 'none'}</div>
      <div data-testid="statsTab">{state.statsTab}</div>
      <button
        type="button"
        onClick={() =>
          patchQuery({
            tab: 'support',
            status: '',
            supportTicket: '42',
            statsTab: 'transactions',
          })
        }
      >
        patch
      </button>
    </div>
  );
}

function WithdrawalSyncProbe() {
  const { state, patchQuery } = useAdminQueryState();
  const [section, setSection] = React.useState(state.section);
  const [status, setStatus] = React.useState(state.withdrawalStatus);

  React.useEffect(() => {
    setSection(state.section);
    setStatus(state.withdrawalStatus);
  }, [state.section, state.withdrawalStatus]);

  React.useEffect(() => {
    if (section !== 'withdrawals') return;
    patchQuery({
      tab: 'withdrawals',
      status,
    });
  }, [section, status, patchQuery]);

  return (
    <div>
      <div data-testid="sync-section">{section}</div>
      <div data-testid="sync-status">{status || 'empty'}</div>
      <button type="button" onClick={() => setStatus('approved')}>
        approved
      </button>
      <button type="button" onClick={() => setStatus('')}>
        all
      </button>
    </div>
  );
}

test('restores admin query state from URL', () => {
  render(
    <MemoryRouter initialEntries={['/admin?tab=support&status=approved&supportTicket=17&statsTab=project-cost']}>
      <Probe />
    </MemoryRouter>,
  );

  expect(screen.getByTestId('section').textContent).toBe('support');
  expect(screen.getByTestId('status').textContent).toBe('approved');
  expect(screen.getByTestId('supportTicket').textContent).toBe('17');
  expect(screen.getByTestId('statsTab').textContent).toBe('project-cost');
});

test('restores withdrawals section from explicit tab in URL', () => {
  render(
    <MemoryRouter initialEntries={['/admin?tab=withdrawals&status=rejected']}>
      <Probe />
    </MemoryRouter>,
  );

  expect(screen.getByTestId('section').textContent).toBe('withdrawals');
  expect(screen.getByTestId('status').textContent).toBe('rejected');
});

test('keeps legacy withdrawal URLs on withdrawals section', () => {
  render(
    <MemoryRouter initialEntries={['/admin?status=approved']}>
      <Probe />
    </MemoryRouter>,
  );

  expect(screen.getByTestId('section').textContent).toBe('withdrawals');
  expect(screen.getByTestId('status').textContent).toBe('approved');
});

test('patchQuery keeps search-param state canonical', () => {
  render(
    <MemoryRouter initialEntries={['/admin?tab=statistics&status=pending']}>
      <Probe />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByText('patch'));

  expect(screen.getByTestId('section').textContent).toBe('support');
  expect(screen.getByTestId('status').textContent).toBe('empty');
  expect(screen.getByTestId('supportTicket').textContent).toBe('42');
  expect(screen.getByTestId('statsTab').textContent).toBe('transactions');
});

test('changing withdrawal status keeps withdrawals section in URL state', () => {
  render(
    <MemoryRouter initialEntries={['/admin?tab=withdrawals&status=pending']}>
      <WithdrawalSyncProbe />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByText('approved'));
  expect(screen.getByTestId('sync-section').textContent).toBe('withdrawals');
  expect(screen.getByTestId('sync-status').textContent).toBe('approved');

  fireEvent.click(screen.getByText('all'));
  expect(screen.getByTestId('sync-section').textContent).toBe('withdrawals');
  expect(screen.getByTestId('sync-status').textContent).toBe('empty');
});
