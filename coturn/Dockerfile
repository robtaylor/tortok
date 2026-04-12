FROM coturn/coturn:alpine

# Copy entrypoint that generates config from env vars
COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
