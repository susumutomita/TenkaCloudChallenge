FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
# Preserve nginx itself; Alpine 3.21 provides the fixed system trust packages.
RUN apk add --no-cache "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0"
