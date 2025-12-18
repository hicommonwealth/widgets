import { UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk'
import { SupportedChainId } from 'constants/chains'

// Universal Router 2.0 addresses from https://api-docs.uniswap.org/guides/supported_chains
// These are for chains not yet supported in @uniswap/universal-router-sdk
const UNIVERSAL_ROUTER_2_ADDRESSES: { [chainId: number]: string } = {
  [SupportedChainId.SONEIUM]: '0x0e2850543f69f678257266e0907ff9a58b3f13de',
}

/**
 * Gets the Universal Router address for a given chain ID.
 * Falls back to custom addresses for chains not yet in the SDK, then to the SDK function.
 */
export function getUniversalRouterAddress(chainId: number): string {
  // Check custom addresses first (for chains not yet in the SDK)
  if (UNIVERSAL_ROUTER_2_ADDRESSES[chainId]) {
    return UNIVERSAL_ROUTER_2_ADDRESSES[chainId]
  }
  // Fall back to SDK function
  return UNIVERSAL_ROUTER_ADDRESS(chainId)
}

/**
 * Gets the Universal Router address for a given chain ID, or undefined if not available.
 * Used for checking if Universal Router is available on a chain.
 */
export function getUniversalRouterAddressOrUndefined(chainId: number | undefined): string | undefined {
  if (!chainId) return undefined
  // Check custom addresses first (for chains not yet in the SDK)
  if (UNIVERSAL_ROUTER_2_ADDRESSES[chainId]) {
    return UNIVERSAL_ROUTER_2_ADDRESSES[chainId]
  }
  // Fall back to SDK function
  try {
    return UNIVERSAL_ROUTER_ADDRESS(chainId)
  } catch {
    return undefined
  }
}
