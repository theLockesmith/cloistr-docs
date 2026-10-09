import { getServiceConfig, type ServiceConfig } from '@cloistr/collab-common/config'

/**
 * Where this app's services live.
 *
 * Resolution order, highest first: configuration the container wrote at
 * startup, then the value compiled in at build time, then the shared default.
 * With no runtime configuration this returns exactly what the build args set,
 * which is why adopting this changed nothing for production.
 *
 * One named home for the decision, with a test, so the file host cannot drift
 * back to a literal in Editor.tsx unnoticed. The signer is NOT resolved here
 * for this app: it reaches the signer only through the serving config's
 * /signer/ proxy, whose upstream is substituted at container start.
 */
export function resolveServiceAddresses(): ServiceConfig {
  return getServiceConfig()
}
