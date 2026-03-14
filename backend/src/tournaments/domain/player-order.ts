export function parsePlayerOrder(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
  }
  if (typeof raw === 'string' && raw !== 'null' && raw !== '') {
    try {
      return parsePlayerOrder(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

export function getOpponentSlot(playerSlot: number, playerCount: number): number | null {
  if (playerSlot < 0) return null;
  const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
  return opponentSlot >= 0 && opponentSlot < playerCount ? opponentSlot : null;
}

export function getSemiPairIndexBySlot(playerSlot: number): 0 | 1 | null {
  if (playerSlot < 0) return null;
  return playerSlot < 2 ? 0 : 1;
}

export function getSemiPairUserIds(
  order: number[] | null | undefined,
  pairIndex: 0 | 1,
): [number, number] {
  const slotA = pairIndex === 0 ? 0 : 2;
  const slotB = slotA + 1;
  return [
    slotA < (order?.length ?? 0) ? Number(order?.[slotA] ?? -1) : -1,
    slotB < (order?.length ?? 0) ? Number(order?.[slotB] ?? -1) : -1,
  ];
}
