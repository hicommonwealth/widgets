/**
 * Universal Router error selectors (first 4 bytes of error data)
 * These are keccak256 hashes of the error signature
 * 
 * Common Universal Router errors:
 * - STF (SwapTooFew): Insufficient output amount due to price movement
 * - TF (TransferFailed): Token transfer failed
 * 
 * Selector 0x24856bc3 appears to be a slippage/price movement related error
 * based on the encoded parameters in the error data.
 */
const UNIVERSAL_ROUTER_ERROR_SELECTORS: { [selector: string]: string } = {
  // Common Universal Router errors
  '0x24856bc3': 'STF', // Likely SwapTooFew or similar slippage error (insufficient output amount)
  '0x5c702b98': 'TF', // TransferFailed
  // Note: These selectors are identified from error patterns
  // The exact mapping may need to be verified against Universal Router source
}

/**
 * Attempts to decode a Universal Router error from encoded error data
 * @param errorData Hex-encoded error data (starting with 0x)
 * @returns The error name if recognized, or undefined
 */
export function decodeUniversalRouterError(errorData: string): string | undefined {
  if (!errorData || typeof errorData !== 'string' || !errorData.startsWith('0x')) {
    return undefined
  }

  // Extract the error selector (first 4 bytes = 8 hex characters)
  const selector = errorData.substring(0, 10).toLowerCase()
  return UNIVERSAL_ROUTER_ERROR_SELECTORS[selector]
}

/**
 * Checks if error data looks like a Universal Router error
 * Universal Router errors are typically long hex strings with structured data
 */
export function isUniversalRouterError(errorData: string): boolean {
  if (!errorData || typeof errorData !== 'string' || !errorData.startsWith('0x')) {
    return false
  }

  // Universal Router errors are typically > 100 characters
  // and start with a 4-byte selector
  return errorData.length > 100 && errorData.length % 2 === 0
}

