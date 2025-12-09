import { BigNumber } from '@ethersproject/bignumber'
import { t } from '@lingui/macro'
import { sendTransaction } from '@uniswap/conedison/provider/index'
import { Percent } from '@uniswap/sdk-core'
import { SwapRouter, UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk'
import { FeeOptions, toHex } from '@uniswap/v3-sdk'
import { useWeb3React } from '@web3-react/core'
import { SupportedChainId } from 'constants/chains'
import { TX_GAS_MARGIN } from 'constants/misc'
import { DismissableError, UserRejectedRequestError, WidgetPromise } from 'errors'
import { useCallback, useMemo } from 'react'
import { InterfaceTrade } from 'state/routing/types'
import { SwapTransactionInfo, TransactionType } from 'state/transactions'
import isZero from 'utils/isZero'
import { isUserRejection } from 'utils/jsonRpcError'
import { swapErrorToUserReadableMessage } from 'utils/swapErrorToUserReadableMessage'

import { getUniversalRouterAddress } from 'utils/getUniversalRouterAddress'

import { usePerfEventHandler } from './usePerfEventHandler'
import { PermitSignature } from './usePermitAllowance'

interface SwapOptions {
  slippageTolerance: Percent
  deadline?: BigNumber
  permit?: PermitSignature
  feeOptions?: FeeOptions
}

/**
 * Returns a callback to submit a transaction to the universal router.
 *
 * The callback returns the TransactionResponse if the transaction was submitted,
 * or undefined if the user rejected the transaction.
 **/
export function useUniversalRouterSwapCallback(trade: InterfaceTrade | undefined, options: SwapOptions) {
  const { account, chainId, provider } = useWeb3React()

  const swapCallback = useCallback(
    () =>
      WidgetPromise.from(
        async () => {
          if (!account) throw new Error('missing account')
          if (!chainId) throw new Error('missing chainId')
          if (!provider) throw new Error('missing provider')
          if (!trade) throw new Error('missing trade')

          const { calldata: data, value } = SwapRouter.swapERC20CallParameters(trade, {
            slippageTolerance: options.slippageTolerance,
            deadlineOrPreviousBlockhash: options.deadline?.toString(),
            inputTokenPermit: options.permit,
            fee: options.feeOptions,
          })
          const tx = {
            from: account,
            to: getUniversalRouterAddress(chainId),
            data,
            // TODO: universal-router-sdk returns a non-hexlified value.
            ...(value && !isZero(value) ? { value: toHex(value) } : {}),
          }

          // Pre-flight simulation to catch revert reasons before sending
          // This helps diagnose "execution reverted" errors without specific reasons
          try {
            await provider.call(tx)
          } catch (simulationError: any) {
            // If simulation fails, extract the revert reason
            const simulationReason = 
              simulationError?.reason ||
              simulationError?.message ||
              simulationError?.error?.reason ||
              simulationError?.error?.message ||
              simulationError?.data?.message ||
              simulationError?.data?.reason
            
            // If we got a specific revert reason, throw it now with better context
            if (simulationReason && simulationReason !== 'execution reverted' && !simulationReason.includes('Internal JSON-RPC')) {
              throw new DismissableError({
                message: swapErrorToUserReadableMessage(simulationError),
                error: simulationError,
              })
            }
            // Otherwise, continue to try sending - some RPC nodes don't support simulation well
            console.warn('Transaction simulation failed, but attempting to send anyway:', simulationReason)
          }

          const response = await sendTransaction(provider, tx, TX_GAS_MARGIN)
          if (tx.data !== response.data) {
            throw new DismissableError({
              message: t`Your swap was modified through your wallet. If this was a mistake, please cancel immediately or risk losing your funds.`,
              error: 'Swap was modified in wallet.',
            })
          }

          return {
            type: TransactionType.SWAP,
            response,
            tradeType: trade.tradeType,
            trade,
            slippageTolerance: options.slippageTolerance,
          } as SwapTransactionInfo
        },
        null,
        (error) => {
          if (error instanceof DismissableError) throw error
          if (isUserRejection(error)) throw new UserRejectedRequestError()
          
          // Extract detailed error information for debugging
          const errorMessage = swapErrorToUserReadableMessage(error)
          
          // Try to extract revert reason from various error structures
          // This handles different error formats from different RPC providers
          const extractRevertReason = (err: any): string | undefined => {
            // Check common error locations
            const possibleReasons = [
              err?.reason,
              err?.message,
              err?.error?.reason,
              err?.error?.message,
              err?.data?.message,
              err?.data?.reason,
              err?.body?.error?.message,
              err?.body?.error?.data,
              err?.transaction?.data,
            ]
            
            for (const possibleReason of possibleReasons) {
              if (typeof possibleReason === 'string' && possibleReason.length > 0) {
                // Skip generic errors
                if (possibleReason !== 'execution reverted' && 
                    !possibleReason.includes('Internal JSON-RPC') &&
                    possibleReason.length > 20) {
                  return possibleReason
                }
              }
            }
            
            // Check for error data that might contain encoded revert reason
            const errorData = err?.data || err?.error?.data || err?.body?.error?.data
            if (errorData && typeof errorData === 'string' && errorData.startsWith('0x') && errorData.length > 10) {
              return `execution reverted (encoded: ${errorData.substring(0, 74)}...)`
            }
            
            return undefined
          }
          
          const revertReason = extractRevertReason(error)
          const detailedError = revertReason || error?.reason || error?.message || String(error)
          
          console.error('Universal Router swap error:', {
            chainId,
            routerAddress: chainId ? getUniversalRouterAddress(chainId) : undefined,
            error,
            message: error?.message,
            reason: error?.reason,
            code: error?.code,
            data: error?.data,
            body: error?.body,
            transaction: error?.transaction,
            revertReason,
            detailedError,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          })
          
          // If we found a specific revert reason, include it prominently
          const enhancedMessage = revertReason && revertReason !== errorMessage
            ? `${errorMessage}\n\nRevert reason: ${revertReason}`
            : errorMessage
          
          throw new DismissableError({ message: enhancedMessage, error })
        }
      ),
    [account, chainId, options.deadline, options.feeOptions, options.permit, options.slippageTolerance, provider, trade]
  )

  const args = useMemo(() => trade && { trade }, [trade])
  return usePerfEventHandler('onSwapSend', args, swapCallback)
}
