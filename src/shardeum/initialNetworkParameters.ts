import { BN } from 'ethereumjs-util'
import { NetworkParameters } from './shardeumTypes'
import { ONE_HOUR, oneSHM, ONE_DAY } from './shardeumConstants'

// INITIAL NETWORK PARAMETERS FOR Shardeum

//It is important to follow the release guidelines when updating these parameters

export const initialNetworkParamters: NetworkParameters = {
  title: 'Initial parameters',
  description: 'These are the initial network parameters Shardeum started with',
  nodeRewardInterval: ONE_HOUR,
  nodeRewardAmountUsd: oneSHM,
  nodePenaltyUsd: oneSHM * BigInt(10),
  stakeRequiredUsd: oneSHM * BigInt(10),
  maintenanceInterval: ONE_DAY,
  maintenanceFee: 0,
  minVersion: '1.9.5',
  activeVersion: '1.9.4',
  latestVersion: '1.9.6',
  archiver: {
    minVersion: '3.4.2',
    activeVersion: '3.4.2',
    latestVersion: '3.4.2',
  },
  stabilityScaleMul: 1000,
  stabilityScaleDiv: 1000,
  txPause: false,
  certCycleDuration: 30,
}
