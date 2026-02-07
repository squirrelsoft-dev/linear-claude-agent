FROM alpine:3.21

RUN apk add --no-cache curl jq bash util-linux

COPY refresh.sh /usr/local/bin/refresh.sh
RUN chmod +x /usr/local/bin/refresh.sh

ENTRYPOINT ["/usr/local/bin/refresh.sh"]
