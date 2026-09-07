# Vendored: @nestjs/throttler 6.5.0

Verbatim npm package with one change: `peerDependencies` widened to accept
NestJS 12 (upstream tops out at ^11, which breaks `npm install` for this repo).
Delete this directory and switch `apps/api` back to the registry package once
@nestjs/throttler publishes a Nest 12 compatible release.
