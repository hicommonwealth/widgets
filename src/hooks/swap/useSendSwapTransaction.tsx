import { BigNumber } from '@ethersproject/bignumber'
import { JsonRpcProvider, TransactionResponse } from '@ethersproject/providers'
import { t, Trans } from '@lingui/macro'
import { DismissableError, UserRejectedRequestError } from 'errors'
import { useMemo } from 'react'
import { InterfaceTrade } from 'state/routing/types'
import { calculateGasMargin } from 'utils/calculateGasMargin'
import isZero from 'utils/isZero'
import { isUserRejection } from 'utils/jsonRpcError'
import { swapErrorToUserReadableMessage } from 'utils/swapErrorToUserReadableMessage'

interface SwapCall {
  address: string
  calldata: string
  value: string
}

interface SwapCallEstimate {
  call: SwapCall
}

interface SuccessfulCall extends SwapCallEstimate {
  call: SwapCall
  gasEstimate: BigNumber
}

interface FailedCall extends SwapCallEstimate {
  call: SwapCall
  error: Error
}

// returns a function that will execute a swap, if the parameters are all valid
export default function useSendSwapTransaction(
  account: string | null | undefined,
  chainId: number | undefined,
  provider: JsonRpcProvider | undefined,
  trade: InterfaceTrade | undefined,
  swapCalls: SwapCall[]
): { callback: null | (() => Promise<TransactionResponse>) } {
  return useMemo(() => {
    if (!trade || !provider || !account || !chainId) {
      return { callback: null }
    }
    return {
      callback: async function onSwap(): Promise<TransactionResponse> {
        if (swapCalls.length === 0) {
          console.error('No swap calls provided', { chainId, account, trade: trade?.inputAmount?.toExact() })
          throw new Error(
            t`No swap calls available. This may indicate the router address is not configured for this chain.`
          )
        }

        console.log(
          'Attempting swap with calls:',
          swapCalls.map((c) => ({ address: c.address, hasData: !!c.calldata }))
        )

        const estimatedCalls: SwapCallEstimate[] = await Promise.all(
          swapCalls.map((call) => {
            const { address, calldata, value } = call

            const tx =
              !value || isZero(value)
                ? { from: account, to: address, data: calldata }
                : {
                    from: account,
                    to: address,
                    data: calldata,
                    value,
                  }

            return provider
              .estimateGas(tx)
              .then((gasEstimate) => {
                return {
                  call,
                  gasEstimate,
                }
              })
              .catch((gasError) => {
                console.debug('Gas estimate failed, trying eth_call to extract error', {
                  call,
                  gasError: gasError?.message || gasError,
                  chainId,
                })

                return provider
                  .call(tx)
                  .then((result) => {
                    console.debug('Unexpected successful call after failed estimate gas', call, gasError, result)
                    return { call, error: <Trans>Unexpected issue with estimating the gas. Please try again.</Trans> }
                  })
                  .catch((callError) => {
                    console.debug('Call threw error', call, callError)

                    // Try to extract the revert reason from various possible error structures
                    let revertReason: string | undefined

                    // Check common error locations
                    const possibleReasons = [
                      callError?.reason,
                      callError?.message,
                      callError?.error?.reason,
                      callError?.error?.message,
                      callError?.data?.message,
                      callError?.data?.reason,
                    ]

                    for (const possibleReason of possibleReasons) {
                      if (typeof possibleReason === 'string') {
                        // Look for "execution reverted" pattern
                        if (possibleReason.includes('execution reverted')) {
                          revertReason = possibleReason
                          break
                        }
                        // Also check for just the revert reason without prefix
                        if (possibleReason && possibleReason.length > 0) {
                          revertReason = possibleReason
                        }
                      }
                    }

                    // If we have RPC error data, try to decode it
                    if (!revertReason && callError?.data) {
                      revertReason = `RPC error data: ${JSON.stringify(callError.data)}`
                    }

                    // Fallback to string representation
                    if (!revertReason) {
                      revertReason = String(callError)
                    }

                    // Extract user-friendly message
                    const errorMessage = swapErrorToUserReadableMessage(callError)

                    console.error('Swap call error details:', {
                      chainId,
                      routerAddress: call.address,
                      calldataLength: call.calldata?.length,
                      value: call.value,
                      error: callError,
                      message: callError?.message,
                      reason: callError?.reason,
                      code: callError?.code,
                      data: callError?.data,
                      revertReason,
                      fullError: JSON.stringify(callError, Object.getOwnPropertyNames(callError)),
                    })

                    // Include the revert reason prominently in the error message
                    const enhancedError = new Error(
                      `${errorMessage}\n\nRevert reason: ${revertReason}\n\nThis usually means the transaction would fail if executed. Common causes:\n- Token approval needed\n- Insufficient balance\n- Slippage tolerance too low\n- Router contract not deployed at this address`
                    )
                    return { call, error: enhancedError }
                  })
              })
          })
        )

        // a successful estimation is a bignumber gas estimate and the next call is also a bignumber gas estimate
        let bestCallOption: SuccessfulCall | SwapCallEstimate | undefined = estimatedCalls.find(
          (el, ix, list): el is SuccessfulCall =>
            'gasEstimate' in el && (ix === list.length - 1 || 'gasEstimate' in list[ix + 1])
        )

        // check if any calls errored with a recognizable error
        if (!bestCallOption) {
          const errorCalls = estimatedCalls.filter((call): call is FailedCall => 'error' in call)
          if (errorCalls.length > 0) {
            // Log all errors for debugging
            const errorMessages = errorCalls.map((c, idx) => {
              const errorMsg = c.error instanceof Error ? c.error.message : String(c.error)
              return `Call ${idx} (${c.call.address}): ${errorMsg}`
            })
            console.error('All swap calls failed with errors:', errorMessages)
            // Throw the last error, but include all error messages
            const lastError = errorCalls[errorCalls.length - 1].error
            if (lastError instanceof Error) {
              throw new Error(`${lastError.message}\n\nAll call errors:\n${errorMessages.join('\n')}`)
            }
            throw lastError
          }
          const firstNoErrorCall = estimatedCalls.find<SwapCallEstimate>(
            (call): call is SwapCallEstimate => !('error' in call)
          )
          if (!firstNoErrorCall) {
            const errorDetails = estimatedCalls
              .map((call, idx) => {
                if ('error' in call) {
                  const err = (call as FailedCall).error
                  return `Call ${idx}: ${err instanceof Error ? err.message : String(err)}`
                }
                if ('gasEstimate' in call) {
                  return `Call ${idx}: Has gas estimate (unexpected state)`
                }
                return `Call ${idx}: Unknown state (no error, no gas estimate)`
              })
              .join('\n')
            console.error('No valid swap calls found. Estimated calls:', estimatedCalls)
            throw new Error(
              t`Unexpected error. Could not estimate gas for the swap.\n\nError details:\n${
                errorDetails ||
                'No error details available. This may indicate the router contract is not deployed or configured correctly for this chain.'
              }`
            )
          }
          bestCallOption = firstNoErrorCall
        }

        const {
          call: { address, calldata, value },
        } = bestCallOption

        return provider
          .getSigner()
          .sendTransaction({
            from: account,
            to: address, // SwapRouter contract address
            data: calldata,
            // let the wallet try if we can't estimate the gas
            ...('gasEstimate' in bestCallOption ? { gasLimit: calculateGasMargin(bestCallOption.gasEstimate) } : {}),
            ...(value && !isZero(value) ? { value } : {}),
          })
          .then((response) => {
            return response
          })
          .catch((error) => {
            // if the user rejected the tx, pass this along
            if (isUserRejection(error)) {
              throw new UserRejectedRequestError()
            } else {
              // otherwise, the error was unexpected and we need to convey that
              console.error(`Swap failed`, error, calldata, value)
              throw new DismissableError({
                message: t`Swap failed: ${swapErrorToUserReadableMessage(error)}`,
              })
            }
          })
      },
    }
  }, [account, chainId, provider, swapCalls, trade])
}
