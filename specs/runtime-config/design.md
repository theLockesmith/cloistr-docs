# Runtime service configuration in this app — design

Mechanism and justification: with the shared package. Here is what changes in
this repo.

## Changes

1. **The serving config becomes a template** and gains the configuration
   location, exact-match and uncacheable. `nginx.conf` moves to
   `nginx.conf.template`, copied into the base image's template directory.

2. **The signer proxy stops being hardcoded.** Both the upstream and the Host
   header are substituted. For this app that is the whole conversion, because
   the app reaches the signer only through this proxy.

   Substitution happens before nginx parses the file, so the result is a
   literal. That matters: `proxy_pass` to an nginx *runtime* variable requires a
   resolver directive and changes the DNS behaviour, while a substituted literal
   behaves exactly as the hardcoded host did.

3. **The entry page loads the configuration before the bundle**, as a script tag
   rather than a fetch, because app modules capture URLs at import time.

4. **The serving stage carries production defaults** and restricts the
   substitution filter to our own prefix. The defaults make an empty environment
   resolve to production. The filter matters because the substitution tool
   replaces any `$NAME` it recognises, and this config contains nginx's own
   `$uri`, `$remote_addr`, `$proxy_add_x_forwarded_for` and `$scheme`. Without
   the filter, an unrelated environment variable could rewrite the proxy
   headers, which would be a genuinely confusing failure.

5. **The file host is read through the shared reader** rather than from a
   literal.

## What is deliberately not changed

The relay already came through the shared reader; it needed nothing.

The app keeps `signerUrl="/signer"`, because the same-origin proxy is there to
avoid a CORS failure on one signer endpoint. Pointing the app directly at a
signer URL would reintroduce that, so the proxy stays and the proxy's target
moves instead.

The build arguments stay, as they are what makes the no-environment case resolve
to production.
