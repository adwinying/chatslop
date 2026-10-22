// No server imports, so the composer resolves levels the same way as Send.

/**
 * The remembered Reasoning level if the Model supports it, else `medium`,
 * else its lowest. Undefined for a Model without levels.
 */
export function reasoningLevelFor(levels: string[], remembered?: string) {
  if (remembered && levels.includes(remembered)) return remembered
  return levels.includes('medium') ? 'medium' : levels[0]
}
