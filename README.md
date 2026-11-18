# Food Delivery Microservices

Two Express.js services (Order on 3000, Restaurant on 3001) talking over HTTP, run with Docker Compose.

## Run

```bash
docker compose up --build
```

## Stop

```bash
docker compose down
```

## API

Restaurant Service: `GET /restaurants`, `GET /restaurants/:id`, `GET /health`

Order Service: `POST /orders` (header `Idempotency-Key` required), `GET /orders`, `GET /orders/:id`, `GET /health`

## Failure handling

- Restaurant down -> Order returns 503
- Restaurant slow (over 2s) -> 504
- Unknown restaurant -> 404 (not retried)
- Retries: max 3 attempts with backoff, only for network/5xx errors
