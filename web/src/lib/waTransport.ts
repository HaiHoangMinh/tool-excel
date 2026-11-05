import { checkWaExtension } from './waExtension'

export type WaTransportState = {
  ready: boolean
}

export async function detectWaTransport(): Promise<WaTransportState> {
  const ok = await checkWaExtension()
  return { ready: ok }
}
