import { ErrorCode } from 'constants/eip1193'

export function getReason(error: any): string | undefined {
  let reason: string | undefined
  let currentError: any = error
  
  while (Boolean(currentError)) {
    // Check for reason or message
    reason = currentError.reason ?? currentError.message ?? reason
    
    // Check for nested error structures
    currentError = currentError.error ?? currentError.data?.originalError
    
    // If we have a generic "execution reverted" but no specific reason,
    // try to extract from error data
    if (reason === 'execution reverted' || reason === 'Internal JSON-RPC error') {
      const errorData = currentError?.data || error?.data || error?.body?.error?.data
      if (errorData) {
        // If it's a hex string, try to extract readable info
        if (typeof errorData === 'string' && errorData.startsWith('0x')) {
          // Universal Router errors might be encoded - try to extract selector
          // Common Universal Router error selectors (first 4 bytes):
          // We can't decode without ABI, but we can show the data
          if (errorData.length > 10) {
            reason = `execution reverted (error data: ${errorData.substring(0, 74)}...)`
          }
        } else if (typeof errorData === 'string') {
          reason = errorData
        }
      }
      
      // Check for RPC error message
      if ((!reason || reason === 'execution reverted') && error?.body?.error?.message) {
        reason = error.body.error.message
      }
    }
  }
  
  return reason
}

export function isUserRejection(error: any): boolean {
  const reason = getReason(error)
  if (
    // EIP-1193
    error?.code === ErrorCode.USER_REJECTED_REQUEST ||
    // Ethers v5 (https://github.com/ethers-io/ethers.js/commit/d9897e0fdb5f9ca34822929c95a478634cc2a460)
    error?.code === 'ACTION_REJECTED' ||
    // These error messages have been observed in the listed wallets:
    (reason?.match(/request/i) && reason?.match(/reject/i)) || // Rainbow
    reason?.match(/declined/i) || // Frame
    reason?.match(/cancell?ed by user/i) || // SafePal
    reason?.match(/user cancell?ed/i) || // Trust
    reason?.match(/user denied/i) || // Coinbase
    reason?.match(/user rejected/i) // Fireblocks
  ) {
    return true
  }
  return false
}
