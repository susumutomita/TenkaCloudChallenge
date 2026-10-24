FROM nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951
# The upstream index includes older architecture variants. Require the CA fix
# on every build, even if that platform's base was not rebuilt after the incident.
RUN apk add --no-cache "ca-certificates>=20261020-r0" "ca-certificates-bundle>=20261020-r0"
