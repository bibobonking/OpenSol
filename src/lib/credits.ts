import type { Message, ModelInfo, Usage } from '../types'

/**
 * Credits for one reply. Providers that report their own cost win; otherwise the cost is
 * tokens × the model's published price (USD per 1M tokens). Unknown or free models give
 * undefined, so nothing is shown for them.
 */
export function messageCost(
  usage: Usage | undefined,
  model: Pick<ModelInfo, 'pricing'> | null | undefined,
): number | undefined {
  if (!usage) return undefined
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost > 0) return usage.cost
  const pricing = model?.pricing
  if (!pricing) return undefined
  const cost = ((usage.input ?? 0) * pricing.input + (usage.output ?? 0) * pricing.output) / 1_000_000
  return cost > 0 ? cost : undefined
}

export function sumCost(messages: Message[]): number {
  let total = 0
  for (const message of messages) {
    if (message.role === 'assistant' && typeof message.cost === 'number') total += message.cost
  }
  return total
}

export function formatCredits(value: number): string {
  if (value <= 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}
