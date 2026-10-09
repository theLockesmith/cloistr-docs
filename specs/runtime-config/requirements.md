# Runtime service configuration in this app — requirements

The mechanism, the reasoning and the rejected alternatives live with the shared
package, in its `specs/runtime-config/` and `docs/runtime-config-adoption.md`.
This file records only what is required here.

## Why this app needs changing

Measured before the change:

- The relay already came through the shared reader, so that half was fine.
- The file host was a literal in `src/components/Editor.tsx`, frozen into the
  bundle at build time.
- **The signer host was hardcoded in `nginx.conf`**, in the proxy this app
  routes all signer traffic through. This is the important one: the app passes
  `signerUrl="/signer"` and so reaches the signer *only* through that proxy. No
  amount of app-side configuration could have redirected it.

Consequence: a staging deployment of this image would have reached the
production signer and the production file host, and a staging signup would have
created a real production account.

## Required here

1. The same built image serves production and staging, differing only in the
   environment given at container start.
2. With no environment given, behaviour is what it is today.
3. The signer proxy's upstream host and Host header are both substituted. Doing
   one and not the other sends the request to the right place with the wrong
   name, which some upstreams accept and some do not, so it must be both.
4. The file host is redirectable.
5. The configuration is readable before the bundle executes and is not cached;
   this app hard-caches every file whose name ends in the script extension for a
   year, so the configuration needs an exact-match location to outrank it.

## Done criteria, as set by the orchestrator

- Production unchanged: the no-environment run reports production hosts.
- The staging run reports staging hosts **and makes no request to a production
  host**. The second half is what is actually checked, because a stray fetch to
  the production file host would satisfy the first half on its own.
