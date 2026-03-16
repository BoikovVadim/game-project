import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseProjectCostDashboardContent } from './project-cost-dashboard.service';

function parseRubles(value: string): number {
  const normalized = value.replace(/[₽\s]/g, '').replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTrackingFilePath(): string {
  const candidates = [
    path.resolve(process.cwd(), '.cursor', 'project-cost-tracking.md'),
    path.resolve(process.cwd(), '..', '.cursor', 'project-cost-tracking.md'),
    path.resolve(__dirname, '../../../.cursor/project-cost-tracking.md'),
    path.resolve(__dirname, '../../../../.cursor/project-cost-tracking.md'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('project-cost-tracking.md not found');
}

test('project cost metadata matches canonical history totals', () => {
  const content = readFileSync(getTrackingFilePath(), 'utf8');
  const lines = content.split(/\r?\n/);
  const currentTotalLine = lines[0]?.trim() ?? '';
  const todayLine = lines[1]?.trim() ?? '';

  const metadataCurrentTotal = Number(currentTotalLine);
  assert.ok(
    Number.isFinite(metadataCurrentTotal),
    'first line must contain numeric current total',
  );

  const todayMatch = todayLine.match(
    /^За сегодня \((\d{4}-\d{2}-\d{2})\):\s*(.+)$/,
  );
  assert.ok(todayMatch, 'second line must contain dated today total');

  const metadataDate = todayMatch[1];
  const metadataTodayTotal = parseRubles(todayMatch[2] ?? '');
  const metadataNow = new Date(`${metadataDate}T12:00:00+03:00`);
  const dashboard = parseProjectCostDashboardContent(content, metadataNow);
  const latestEntryDate = dashboard.history[0]?.date ?? null;

  assert.equal(
    latestEntryDate,
    metadataDate,
    'today metadata date must match latest history entry date',
  );
  assert.equal(
    Number(metadataCurrentTotal.toFixed(2)),
    dashboard.currentTotal,
    'current total metadata must match canonical total',
  );
  assert.equal(
    Number(metadataTodayTotal.toFixed(2)),
    dashboard.todayTotal,
    'today metadata must match canonical per-date total',
  );
});
