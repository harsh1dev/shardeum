import { DevSecurityLevel, ShardusTypes } from '@shardus/core'
import config from '../../config'
import { logFlags, shardusConfig } from '../../index'
import axios from 'axios'
import { getFinalArchiverList } from '@shardus/archiver-discovery'
import { getRandom } from '../../utils'
import { verifyMultiSigs } from '../helpers'
import { Archiver } from '@shardus/archiver-discovery/dist/src/types'

export interface Ticket {
  address: string
}

export interface TicketType {
  type: string
  data: Ticket[]
  sign: ShardusTypes.Sign[]
}

export enum TicketTypes {
  SILVER = 'silver'
}

const ticketTypeMap = new Map<string, TicketType>()

export function updateTicketMapAndScheduleNextUpdate(): void {
  updateTicketMap().catch((error) => {
    console.error(`[tickets][updateTicketMapAndScheduleNextUpdate] ERROR:`, error)
  }).finally(() => {
    scheduleUpdateTicketMap()
  })
}

function getArchiverToRetrieveTicketType(): Archiver {
  const archiverList = getFinalArchiverList()
  if (archiverList.length > 0) {
    return getRandom(archiverList, 1)[0]
  }
  return undefined
}

async function getTicketTypesFromArchiver(archiver: Archiver): Promise<TicketType[]> {
  // try {
  //   const url = `http://${archiver.ip}:${archiver.port}/tickets`
  //   const res = await axios.get(url)
  //   if (res.status >= 200 && res.status < 300) {
  //     return res.data
  //   }
  // } catch (error){
  //   console.error(`[tickets][getTicketTypesFromArchiver] Error getting ticket list`, error)
  // }
  // return []

  return [{"type":"silver","data":[{"address": "0xd79eFA2f9bB9C780e4Ce05D6b8a15541915e4636"}],"sign": [{"owner": "0x1e5e12568b7103E8B22cd680A6fa6256DD66ED76","sig": "0xf3e7f8ccc763a8b832ad933b35bb181962d9d94316407e49142cd182d090559d66904856ea2811d44ee11c000678cf9d10134636cd8e4aaa26e78baca19a896f1c"}]}]
}

export async function updateTicketMap(): Promise<void> {
  const archiver: Archiver = getArchiverToRetrieveTicketType()
  /* prettier-ignore */ if (logFlags.debug) console.log(JSON.stringify({script: 'tickets',method: 'updateTicketMap',data: { archiver: archiver },}))
  if (archiver){
    const ticketTypes: TicketType[] = await getTicketTypesFromArchiver(archiver)
    ticketTypeMap.clear()

    const devPublicKeys = shardusConfig?.debug?.multisigKeys || {}
    const requiredSigs = Math.max(1, shardusConfig?.debug?.minMultiSigRequiredForGlobalTxs || 1)

    ticketTypes.forEach((ticketType: TicketType, i: number) => {
      const { sign, ...ticketTypeWithoutSign } = ticketType
      /* prettier-ignore */ if (logFlags.debug) console.log(JSON.stringify({script: 'tickets',method: 'updateTicketMap',data: { sign, ticketTypeWithoutSign, devPublicKeys, requiredSigs },}))
      const isValidSig = verifyMultiSigs(
        ticketTypeWithoutSign,
        sign,
        devPublicKeys,
        requiredSigs,
        DevSecurityLevel.High
      )
      /* prettier-ignore */ if (logFlags.debug) console.log(JSON.stringify({script: 'tickets',method: 'updateTicketMap',data: { index: i, ticketType, isValidSig },}))
      if (isValidSig) {
        ticketTypeMap.set(ticketType.type, ticketType)
      } else {
        console.warn(`[tickets][updateTicketMap] Invalid signature for ticket ${JSON.stringify(ticketType)}`)
      }
    })
  } else {
    console.warn(`[tickets][updateTicketMap] No archivers found`)
  }
}

function scheduleUpdateTicketMap(): void {
  const delayInMs = config.server.features.tickets.updateTicketListTimeInMs || config.server.p2p.cycleDuration * 1000
  /* prettier-ignore */ if (logFlags.debug) console.log(JSON.stringify({script: 'tickets',method: 'scheduleUpdateTicketMap',data: { delayInMs },}))
  setTimeout(async () => {
    await updateTicketMap()
  }, delayInMs)
}

export function getTicketsByType(type: string): Ticket[] {
  if (ticketTypeMap.has(type)) {
    return ticketTypeMap.get(type).data
  }
  return []
}
