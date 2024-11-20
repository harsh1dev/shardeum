import { ShardeumFlags } from '../../shardeum/shardeumFlags'
import {
  AccountType,
  NetworkAccount,
  NodeAccount2,
  StakeCoinsTX,
  UnstakeCoinsTX,
  WrappedEVMAccount,
  WrappedStates,
} from '../../shardeum/shardeumTypes'
import * as AccountsStorage from '../../storage/accountStorage'
import { _base16BNParser, scaleByStabilityFactor } from '../../utils'
import { Address } from '@ethereumjs/util'
import { networkAccount as globalAccount } from '../../shardeum/shardeumConstants'
import { logFlags, shardusConfig } from '../..'
import { toShardusAddress } from '../../shardeum/evmAddress'
import { nestedCountersInstance, Shardus } from '@shardus/core'
import * as TicketManager from "../../setup/ticket-manager"

export function verifyStakeTx(
  appData: any,
  senderAddress: Address,
  wrappedStates: WrappedStates
): { success: boolean; reason: string } {
  nestedCountersInstance.countEvent('shardeum-staking', 'verifyStakeTx: validating stake coins tx fields')

  let success = true
  let reason = ''
  if (ShardeumFlags.VerboseLogs) console.log('verifyStakeTx: Validating stake tx fields', appData)
  const stakeCoinsTx = appData as StakeCoinsTX
  // eslint-disable-next-line security/detect-object-injection
  const networkAccount: NetworkAccount = wrappedStates[globalAccount].data
  const minStakeAmountUsd = networkAccount.current.stakeRequiredUsd
  const minStakeAmount = scaleByStabilityFactor(minStakeAmountUsd, networkAccount)
  const nomineeAccount = wrappedStates[stakeCoinsTx.nominee].data as NodeAccount2
  if (typeof stakeCoinsTx.stake === 'object') stakeCoinsTx.stake = BigInt(stakeCoinsTx.stake)

  /* prettier-ignore */ if (logFlags.debug) console.log(`[verifyStake][verifyStakeTx] shardusConfig: ${JSON.stringify(shardusConfig)}`)
  // Check if Silver Tickets feature is enabled in the shardus configuration
  const ticketTypes = shardusConfig?.features?.tickets?.ticketTypes
  /* prettier-ignore */ if (logFlags.debug) console.log(`[verifyStake][verifyStakeTx] ticketTypes: ${JSON.stringify(ticketTypes)}`)
  const isSilverTicketsEnabled = ticketTypes?.find((tt) => tt.type === TicketManager.TicketTypes.SILVER)?.enabled
  /* prettier-ignore */ if (logFlags.debug) console.log(`[verifyStake][verifyStakeTx] isSilverTicketsEnabled: ${isSilverTicketsEnabled}`)
  if (isSilverTicketsEnabled) {
    let silverTicketForNominee: TicketManager.Ticket | undefined;
    // Retrieve all Silver Tickets using the TicketManager
    const silverTickets: TicketManager.Ticket[] = TicketManager.getTicketsByType(TicketManager.TicketTypes.SILVER);
    /* prettier-ignore */ if (logFlags.debug) console.log(`[verifyStake][verifyStakeTx] silverTickets: ${JSON.stringify(silverTickets)}`)
    if (silverTickets.length > 0) {
      const operatorShardusAddress = toShardusAddress(stakeCoinsTx.nominator, AccountType.Account)
      /* prettier-ignore */ if (logFlags.debug) console.log(`[verifyStake][verifyStakeTx] nominee: ${stakeCoinsTx?.nominee}, operatorShardusAddress: ${operatorShardusAddress}, senderAddress: ${senderAddress}`)
      // Look for a Silver Ticket that matches the nominee's address (case-insensitive comparison)
      silverTicketForNominee = silverTickets.find((ticket) => {
        try {
          return senderAddress.equals(Address.fromString(ticket.address))
        } catch (e){
          console.error(`[verifyStake][verifyStakeTx] Error while checking silver ticket address ${ticket.address}`, e)
        }
        return false
      });
      /* prettier-ignore */ if (logFlags.debug) console.log(`[verifyStake][verifyStakeTx] silverTicketForNominee: ${JSON.stringify(silverTicketForNominee)}`)
      // If no matching Silver Ticket is found for the nominee, return a failure response
      if (!silverTicketForNominee) {
        return {
          success: false,
          reason: 'Nominee does not have a Silver Ticket',
        };
      }
    } else {
      // If no Silver Tickets are found at all, return a failure response
      return {
        success: false,
        reason: 'No Silver Tickets found',
      };
    }
  }

  if (stakeCoinsTx.nominator == null || stakeCoinsTx.nominator.toLowerCase() !== senderAddress.toString()) {
    /* prettier-ignore */ if (logFlags.dapp_verbose) console.log(`nominator vs tx signer`, stakeCoinsTx.nominator, senderAddress.toString())
    success = false
    reason = `Invalid nominator address in stake coins tx`
  } else if (stakeCoinsTx.nominee == null) {
    success = false
    reason = `Invalid nominee address in stake coins tx`
  } else if (!/^[A-Fa-f0-9]{64}$/.test(stakeCoinsTx.nominee)) {
    //TODO: NEED to potentially write a custom faster test that avoids regex so we can avoid a regex-dos attack
    success = false
    reason = 'Invalid nominee address in stake coins tx'
  } else if (
    nomineeAccount &&
    nomineeAccount.stakeTimestamp + networkAccount.current.restakeCooldown > Date.now()
  ) {
    success = false
    reason = `This node was staked within the last ${
      networkAccount.current.restakeCooldown / 60000
    } minutes. You can't stake more to this node yet!`
  } else if (stakeCoinsTx.stake < minStakeAmount) {
    success = false
    reason = `Stake amount is less than minimum required stake amount`

    if (ShardeumFlags.fixExtraStakeLessThanMin) {
      const operatorShardusAddress = toShardusAddress(stakeCoinsTx.nominator, AccountType.Account)
      // eslint-disable-next-line security/detect-object-injection
      const wrappedEVMAccount: WrappedEVMAccount = wrappedStates[operatorShardusAddress]
        .data as WrappedEVMAccount

      if (wrappedEVMAccount.operatorAccountInfo) {
        const existingStake =
          typeof wrappedEVMAccount.operatorAccountInfo.stake === 'string'
            ? BigInt(wrappedEVMAccount.operatorAccountInfo.stake)
            : wrappedEVMAccount.operatorAccountInfo.stake

        if (existingStake !== BigInt(0) && stakeCoinsTx.stake > BigInt(0)) {
          success = true
          reason = ''
        }
      }
    }
  }

  if (!success) {
    return {
      success,
      reason,
    }
  }

  const nominatorAccount = wrappedStates[toShardusAddress(stakeCoinsTx.nominator, AccountType.Account)]
    .data as WrappedEVMAccount
  if (nomineeAccount) {
    if (
      nomineeAccount.nominator &&
      nomineeAccount.nominator.toLowerCase() !== stakeCoinsTx.nominator.toLowerCase()
    ) {
      return {
        success: false,
        reason: `This node is already staked by another account!`,
      }
    }
  }
  if (nominatorAccount.operatorAccountInfo) {
    if (nominatorAccount.operatorAccountInfo.nominee) {
      if (nominatorAccount.operatorAccountInfo.nominee.toLowerCase() !== stakeCoinsTx.nominee.toLowerCase())
        return {
          success: false,
          reason: `This account has already staked to a different node.`,
        }
    }
  }

  return {
    success: true,
    reason: '',
  }
}

export function verifyUnstakeTx(
  appData: any,
  senderAddress: Address,
  wrappedStates: WrappedStates,
  shardus: Shardus
): { success: boolean; reason: string } {
  nestedCountersInstance.countEvent('shardeum-unstaking', 'validating unstake coins tx fields')
  let success = true
  let reason = ''
  if (ShardeumFlags.VerboseLogs) console.log('verifyUnstake: Validating unstake coins tx fields', appData)
  const unstakeCoinsTX = appData as UnstakeCoinsTX
  if (
    unstakeCoinsTX.nominator == null ||
    unstakeCoinsTX.nominator.toLowerCase() !== senderAddress.toString()
  ) {
    /* prettier-ignore */ nestedCountersInstance.countEvent( 'shardeum-unstaking', 'invalid nominator address in stake coins tx' )
    /* prettier-ignore */ if (ShardeumFlags.VerboseLogs) console.log( `nominator vs tx signer`, unstakeCoinsTX.nominator, senderAddress.toString() )
    success = false
    reason = `Invalid nominator address in stake coins tx`
  } else if (unstakeCoinsTX.nominee == null) {
    /* prettier-ignore */ nestedCountersInstance.countEvent( 'shardeum-unstaking', 'invalid nominee address in stake coins tx' )
    success = false
    reason = `Invalid nominee address in stake coins tx`
  }
  const nomineeAccount = wrappedStates[unstakeCoinsTX.nominee].data as NodeAccount2
  const nominatorAccount = wrappedStates[toShardusAddress(unstakeCoinsTX.nominator, AccountType.Account)]
    .data as WrappedEVMAccount
  if (!nominatorAccount) {
    success = false
    reason = `This sender account is not found!`
  } else if (nomineeAccount) {
    if (!nomineeAccount.nominator) {
      success = false
      reason = `No one has staked to this account!`
    } else if (_base16BNParser(nomineeAccount.stakeLock) === BigInt(0)) {
      success = false
      reason = `There is no staked amount in this node!`
    } else if (nomineeAccount.nominator.toLowerCase() !== unstakeCoinsTX.nominator.toLowerCase()) {
      success = false
      reason = `This node is staked by another account. You can't unstake it!`
    } else if (shardus.isOnStandbyList(nomineeAccount.id) === true) {
      success = false
      reason = `This node is in the network's Standby list. You can unstake only after the node leaves the Standby list!`
    } else if (shardus.isNodeActiveByPubKey(nomineeAccount.id) === true) {
      success = false
      reason = `This node is still active in the network. You can unstake only after the node leaves the network!`
    } else if (
      nomineeAccount.rewardEndTime === 0 &&
      nomineeAccount.rewardStartTime > 0 &&
      !(unstakeCoinsTX.force && ShardeumFlags.allowForceUnstake)
    ) {
      //note that if both end time and start time are 0 it is ok to unstake
      success = false
      reason = `No reward endTime set, can't unstake node yet`
    }
  } else {
    success = false
    reason = `This nominee node is not found!`
  }

  // eslint-disable-next-line security/detect-object-injection
  if (
    !isStakeUnlocked(nominatorAccount, nomineeAccount, shardus, wrappedStates[globalAccount].data).unlocked
  ) {
    success = false
    reason = `The stake is not unlocked yet!`
  }

  return { success, reason }
}

export function isStakeUnlocked(
  nominatorAccount: WrappedEVMAccount,
  nomineeAccount: NodeAccount2,
  shardus: Shardus,
  networkAccount: NetworkAccount
): { unlocked: boolean; reason: string; remainingTime: number } {
  const stakeLockTime = networkAccount.current.stakeLockTime
  const currentTime = shardus.shardusGetTime()

  // SLT from time of last staking or unstaking
  const timeSinceLastStake = currentTime - nominatorAccount.operatorAccountInfo.lastStakeTimestamp
  if (timeSinceLastStake < stakeLockTime) {
    return {
      unlocked: false,
      reason: 'Stake lock period active from last staking/unstaking action.',
      remainingTime: stakeLockTime - timeSinceLastStake,
    }
  }

  // SLT from when node was selected to go active (started syncing)
  const node = shardus.getNodeByPubKey(nomineeAccount.id)
  if (node) {
    const timeSinceSyncing = currentTime - node.syncingTimestamp * 1000
    if (timeSinceSyncing < stakeLockTime) {
      return {
        unlocked: false,
        reason: 'Stake lock period active from node starting to sync.',
        remainingTime: stakeLockTime - timeSinceSyncing,
      }
    }
  }

  const timeSinceActive = currentTime - nomineeAccount.rewardStartTime * 1000
  if (timeSinceActive < stakeLockTime) {
    return {
      unlocked: false,
      reason: 'Stake lock period active from last active state.',
      remainingTime: stakeLockTime - timeSinceActive,
    }
  }

  // SLT from time of last went active
  const timeSinceInactive = currentTime - nomineeAccount.rewardEndTime * 1000
  if (timeSinceInactive < stakeLockTime) {
    return {
      unlocked: false,
      reason: 'Stake lock period active from last inactive/exit state.',
      remainingTime: stakeLockTime - timeSinceInactive,
    }
  }

  // SLT from time of last went inactive/exit
  return {
    unlocked: true,
    reason: '',
    remainingTime: 0,
  }
}
