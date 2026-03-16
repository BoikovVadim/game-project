import { Injectable } from '@nestjs/common';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';

export type ProjectCostHistoryEntry = {
  timestamp: string | null;
  date: string;
  time: string | null;
  amountChange: number;
  afterAmount: number;
  duration: string;
  description: string;
  breakdown: string[];
};

export type ProjectCostDashboardDto = {
  currentTotal: number;
  todayTotal: number;
  updatedAt: string | null;
  totalDurationMinutes: number;
  totalDurationLabel: string;
  history: ProjectCostHistoryEntry[];
};

type RawProjectCostEntry = {
  sourceIndex: number;
  sortTimestamp: string;
  timestamp: string | null;
  date: string;
  time: string | null;
  amountChange: number;
  duration: string;
  description: string;
  breakdown: string[];
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseRubles(value: string | null | undefined): number {
  const normalized = String(value ?? '')
    .replace(/[₽\s]/g, '')
    .replace(',', '.')
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeProjectCostDescription(value: string): string {
  return value
    .replace(/\s*\([^()]*\)\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeProjectCostDescriptionBlock(lines: string[]): string {
  const normalized = lines
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized
    .split('\n')
    .map((line, index) =>
      index === 0 ? sanitizeProjectCostDescription(line) : line.trimEnd(),
    )
    .join('\n')
    .trim();
}

function parseProjectCostDisplayContent(lines: string[]): {
  description: string;
  breakdown: string[];
} {
  const descriptionLines: string[] = [];
  const breakdown: string[] = [];
  let section: 'description' | 'breakdown' | 'hidden' = 'description';

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      const lastDescriptionLine =
        descriptionLines.length > 0
          ? descriptionLines[descriptionLines.length - 1]
          : null;
      if (section === 'description' && lastDescriptionLine !== '') {
        descriptionLines.push('');
      }
      continue;
    }
    if (trimmed === 'Разбивка:') {
      section = 'breakdown';
      continue;
    }
    if (trimmed === 'Ретроспектива:') {
      section = 'hidden';
      continue;
    }
    if (section === 'description') {
      descriptionLines.push(line);
      continue;
    }
    if (section === 'breakdown') {
      if (/^-+\s*/.test(trimmed)) {
        breakdown.push(trimmed.replace(/^-+\s*/, '').trim());
      } else {
        breakdown.push(trimmed);
      }
    }
  }

  const description =
    normalizeProjectCostDescriptionBlock(descriptionLines).trim();
  const filteredBreakdown = breakdown.filter(
    (item) =>
      item &&
      !/^Поэтапная детализация/i.test(item) &&
      !/^Базовое время по записи:/i.test(item),
  );

  return {
    description,
    breakdown: filteredBreakdown,
  };
}

function parseProjectCostBaseAmount(lines: string[]): number {
  for (const line of lines) {
    const match = line.match(
      /^Начальная стоимость проекта \(не выводить в историю\):\s*(.+)$/i,
    );
    if (!match) continue;
    return roundMoney(parseRubles(match[1]));
  }
  return 0;
}

function parseDurationToMinutes(value: string | null | undefined): number {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const hours = text.match(/(\d+(?:[.,]\d+)?)\s*ч/);
  const minutes = text.match(/(\d+(?:[.,]\d+)?)\s*мин/);
  return parseRubles(hours?.[1] ?? '0') * 60 + parseRubles(minutes?.[1] ?? '0');
}

function formatDurationLabel(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours} ч ${minutes} мин`;
  if (hours > 0) return `${hours} ч`;
  return `${minutes} мин`;
}

function getEmptyProjectCostDashboard(): ProjectCostDashboardDto {
  return {
    currentTotal: 0,
    todayTotal: 0,
    updatedAt: null,
    totalDurationMinutes: 0,
    totalDurationLabel: '0 мин',
    history: [],
  };
}

async function readProjectCostTrackingFile(): Promise<{
  content: string;
  filePath: string;
} | null> {
  const candidates = [
    path.resolve(process.cwd(), '.cursor', 'project-cost-tracking.md'),
    path.resolve(process.cwd(), '..', '.cursor', 'project-cost-tracking.md'),
    path.resolve(__dirname, '../../.cursor/project-cost-tracking.md'),
    path.resolve(__dirname, '../../../.cursor/project-cost-tracking.md'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = await fs.readFile(candidate, 'utf8');
    return { content, filePath: candidate };
  }

  return null;
}

export function parseProjectCostDashboardContent(
  content: string,
): ProjectCostDashboardDto {
  const sourceLines = content.split(/\r?\n/);
  const metadataLines = sourceLines.map((line) => line.trim()).filter(Boolean);

  const baseProjectCost = parseProjectCostBaseAmount(sourceLines);
  const todayTotal = parseRubles(
    metadataLines[1]?.match(/:\s*(.+)$/)?.[1] ?? '0',
  );
  const rawHistory: RawProjectCostEntry[] = [];
  const entryBlocks: Array<{ sourceIndex: number; lines: string[] }> = [];
  let activeBlock: { sourceIndex: number; lines: string[] } | null = null;

  for (const [sourceIndex, rawLine] of sourceLines.entries()) {
    const line = rawLine.trimEnd();
    if (
      /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\s+\|/.test(line.trim())
    ) {
      if (activeBlock) entryBlocks.push(activeBlock);
      activeBlock = { sourceIndex, lines: [line.trim()] };
      continue;
    }
    if (activeBlock) {
      activeBlock.lines.push(line);
    }
  }
  if (activeBlock) entryBlocks.push(activeBlock);

  for (const block of entryBlocks) {
    const [headerLine, ...bodyLines] = block.lines;
    const parts = headerLine.split('|').map((part) => part.trim());
    if (parts.length < 4) continue;

    const [dateTimePart, amountPart, durationPart, ...descriptionParts] = parts;
    const dateTimeMatch = dateTimePart.match(
      /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?$/,
    );
    if (!dateTimeMatch) continue;

    const date = dateTimeMatch[1];
    const time = dateTimeMatch[2] ?? null;
    const sortTimestamp = new Date(
      `${date}T${time ?? '00:00'}:00+03:00`,
    ).toISOString();
    const parsedContent = parseProjectCostDisplayContent([
      descriptionParts.join(' | '),
      ...bodyLines,
    ]);
    rawHistory.push({
      sourceIndex: block.sourceIndex,
      sortTimestamp,
      timestamp: time ? sortTimestamp : null,
      date,
      time,
      amountChange: roundMoney(parseRubles(amountPart)),
      duration: durationPart,
      description: parsedContent.description,
      breakdown: parsedContent.breakdown,
    });
  }

  const totalChanges = rawHistory.reduce(
    (sum, entry) => sum + entry.amountChange,
    0,
  );
  const totalDurationMinutes = rawHistory.reduce(
    (sum, entry) => sum + parseDurationToMinutes(entry.duration),
    0,
  );
  const sortedHistory = [...rawHistory].sort((a, b) => {
    if (a.sortTimestamp !== b.sortTimestamp) {
      return a.sortTimestamp.localeCompare(b.sortTimestamp);
    }
    return a.sourceIndex - b.sourceIndex;
  });
  const currentTotal = roundMoney(baseProjectCost + totalChanges);
  let runningTotal = roundMoney(baseProjectCost);
  const historyAscending = sortedHistory.map((entry) => {
    runningTotal = roundMoney(runningTotal + entry.amountChange);
    return {
      timestamp: entry.timestamp,
      date: entry.date,
      time: entry.time,
      amountChange: entry.amountChange,
      duration: entry.duration,
      description: entry.description,
      breakdown: entry.breakdown,
      afterAmount: runningTotal,
      sortTimestamp: entry.sortTimestamp,
    };
  });
  const latestEntry = historyAscending[historyAscending.length - 1] ?? null;

  return {
    currentTotal,
    todayTotal: roundMoney(todayTotal),
    updatedAt: latestEntry?.sortTimestamp ?? null,
    totalDurationMinutes,
    totalDurationLabel: formatDurationLabel(totalDurationMinutes),
    history: historyAscending.reverse().map((entry) => ({
      timestamp: entry.timestamp,
      date: entry.date,
      time: entry.time,
      amountChange: entry.amountChange,
      afterAmount: entry.afterAmount,
      duration: entry.duration,
      description: entry.description,
      breakdown: entry.breakdown,
    })),
  };
}

@Injectable()
export class ProjectCostDashboardService {
  async getProjectCostDashboard(): Promise<ProjectCostDashboardDto> {
    try {
      const file = await readProjectCostTrackingFile();
      if (!file) {
        return getEmptyProjectCostDashboard();
      }
      return parseProjectCostDashboardContent(file.content);
    } catch (error) {
      console.error(
        '[ProjectCostDashboardService.getProjectCostDashboard]',
        error,
      );
      return getEmptyProjectCostDashboard();
    }
  }
}
