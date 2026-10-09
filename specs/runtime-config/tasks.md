# Runtime service configuration in this app — tasks

- [x] Test the service-address resolution first, red before green. (verified: suite failed to resolve the module before it existed, 11/11 after)
- [x] One service-address module, delegating to the shared reader. (verified: src/lib/serviceAddresses.ts)
- [x] File host read from it instead of a literal. (verified: Editor.tsx diff)
- [x] Signer proxy upstream substituted; Host derived from it ($proxy_host) so the two cannot disagree. (verified: staging container renders proxy_pass https://signer.staging.cloistr.xyz/, no-env renders production; nginx -t ok)
- [x] Shared package dependency raised to the version carrying the runtime tier. (verified: collab-common 0.4.0, plus auth ^1.4.1 and ui 0.42.2, which it needs; clean npm ci exit 0)
- [x] Serving config becomes a template, with an exact-match configuration
      location that forbids caching. (verified: config.js served no-store in the staging container)
- [x] Entry page loads the configuration before the bundle. (verified: built dist/index.html keeps the config.js tag)
- [x] Serving stage carries production defaults, including the signer URL, and
      restricts the substitution filter. (verified: no-env container served production values)
- [x] Build the image. (verified: docker build exit 0, local image sha256:23f2d4dbcb88)
- [x] No-environment run reports production hosts. (verified: browser check PASS)
- [x] Staging run reports staging hosts and makes NO request to a production
      host, observed in a real browser. (verified: browser check PASS, zero production requests or sockets)
- [ ] Record the image digest for whoever stands this up in staging.
