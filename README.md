# Footy Legends

## Development Setup (Local)

### Backend

1. Install dependencies (ensure you have Python 3.11+ installed).
2. Run the API server:
  ```bash
   uv run uvicorn app.api.main:app --reload
  ```
3. Run tests:
  ```bash
   uv run pytest
  ```

### Frontend

1. Navigate to the frontend directory:
  ```bash
   cd frontend
  ```
2. Install dependencies:
  ```bash
   npm install
  ```
3. Start the development server:
  ```bash
   npm run dev
  ```
4. Run linting or tests:
  ```bash
   npm run lint
   npm run test
  ```

## Infrastructure

### Docker Development

To run the full infrastructure stack locally (including Traefik, Authelia, Gotify, and Mailhog):

```bash
docker-compose -f docker-compose.dev.yml up -d
```

- **Mailhog Web UI**: `http://mail.footylegends.local` or `http://localhost:8025`
- **SMTP Server**: `localhost:1025`

The project is dockerized. Configuration for Traefik, Authelia, and Gotify can be found in the `docker/` directory.