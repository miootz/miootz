# Deploy with GitHub Actions

The deployment workflows send the selected Git commit to a Linux server over SSH, build it with Docker Compose, and check the running services. Production and the public demo use different Compose projects and separate data. Existing server environment files and databases are not transferred back to GitHub.

Publishing a stable release tag such as `v1.2.3` deploys the demo. Use **Actions → Deploy demo → Run workflow** or **Actions → Deploy production → Run workflow** to deploy a stable tag manually. Production is never deployed automatically. Select the protected default branch as the workflow branch and enter the tag to deploy. Protect release tags against unauthorized changes and configure required reviewers for the production environment.

## Before using an existing production installation

Back up the existing databases, Pocket ID data, encryption key, `.env`, and Traefik's ACME volume before changing how the stack runs. Stop the API before copying SQLite databases. **Do not switch database paths or recreate the old API container until you have located and copied its actual databases.** Older settings may store them inside the container at `/app/data` instead of the persistent `/data` mount. Follow the database recovery and migration steps in the [README](../README.md) first.

This workflow uses Compose project `miootz`, production data at `~/miootz/production/data`, and ACME volume `miootz_traefik_acme`. If your existing project or volume has a different name, plan and verify its migration before enabling deployment. Never use `docker compose down -v` on a production stack.

## Server and GitHub setup

Install Docker Engine, the Compose plugin, Git, `flock` (from util-linux), and an SSH server. The deploy account must be able to use Docker without an interactive password. Docker access is effectively root-level access, so use a dedicated account and key and protect the account accordingly. The server must be able to build the images and reach the container registries and package registries. The two environments may use different servers or the same server and account.

Create GitHub Actions environments named `demo` and `production`. Add these **environment secrets** to each environment, using the appropriate values for its server:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | Server DNS name or IP address, without a username or port |
| `SSH_USER` | Deploy account on that server |
| `SSH_PRIVATE_KEY` | Dedicated private key accepted by the server |
| `SSH_KNOWN_HOSTS` | Complete `known_hosts` entry for the server's SSH host key |
| `DEPLOY_ENV` | Optional multiline environment file used only for first-time provisioning |

If `DEPLOY_ENV` is set and the target's host `.env` does not exist, the workflow creates it with mode `0600`. It never prints the secret or overwrites an existing `.env`. If the secret is absent, the host file must already exist. After provisioning, edit the host file securely and back it up; changing the GitHub secret does not update an existing installation. Preserve its Pocket ID encryption key, static API key, database paths, and other persistent settings across updates. Do not delete the host file merely to apply a new secret.

For a new production installation, `DEPLOY_ENV` can contain the following, with all example values replaced:

```dotenv
APP_DOMAIN=app.example.com
API_DOMAIN=api.example.com
AUTH_DOMAIN=auth.example.com
ACME_EMAIL=contact@example.com
ENCRYPTION_KEY=replace-with-a-persistent-random-hex-key
POCKET_ID_STATIC_API_KEY=replace-with-a-persistent-random-api-key
DATABASE_URL=sqlite+aiosqlite:////data/miootz.db
AUDIT_DATABASE_URL=sqlite+aiosqlite:////data/audit.db
PUBLIC_APP_URL=https://app.example.com
TRUSTED_HOSTS=app.example.com,api.example.com,auth.example.com
```

Use separately generated random values for the two keys; see [.env.example](../.env.example) for generation commands and optional settings. Set values as ordinary `KEY=value` lines compatible with both Docker Compose and the bootstrap script; do not use shell commands or untrusted input. Include any required Web Push settings and other custom values. Put demo values in the `demo` environment's separate `DEPLOY_ENV`, not in the production secret.

The workflow connects on SSH port 22 and requires a matching pinned host key. Obtain the host key fingerprint through a trusted channel, compare it with the output of `ssh-keygen -lf` for the entry, and only then save the complete entry as `SSH_KNOWN_HOSTS`. Do not trust a key merely because `ssh-keyscan` returned it. When a host key changes, verify the replacement and update the secret.

Restrict the environments to trusted workflow branches and release tags in GitHub. Require reviewers for `production`. For a manual run, GitHub evaluates the selected workflow branch against the environment's deployment rules; the tag entered in the form chooses the source to deploy. Only people who may run workflows and change trusted tags should have these permissions.

## First production setup

Point the three production DNS names to the server. Open TCP ports 80 and 443 so Traefik can serve HTTPS and complete Let's Encrypt HTTP-01 challenges. Clone this repository as the deploy account into `~/miootz/production`, using the version you intend to run. Then prepare the persistent files:

```sh
cd ~/miootz/production
mkdir -p data
cp .env.example .env
chmod 600 .env
```

Edit `.env`: set `APP_DOMAIN`, `API_DOMAIN`, `AUTH_DOMAIN`, `ACME_EMAIL`, `PUBLIC_APP_URL`, and `TRUSTED_HOSTS` to match your DNS. For a **new** installation, use `DATABASE_URL=sqlite+aiosqlite:////data/miootz.db` and `AUDIT_DATABASE_URL=sqlite+aiosqlite:////data/audit.db`. Keep the generated Pocket ID encryption key and static API key in this file. Back them up securely.

Run bootstrap and follow its prompts to create the first Pocket ID user and add that user to the admin group:

```sh
export COMPOSE_PROJECT_NAME=miootz
export MIOOTZ_DATA_DIR="$HOME/miootz/production/data"
./scripts/bootstrap.sh
# After creating the Pocket ID user at /login/setup:
./scripts/bootstrap.sh --add-to-admins your-username
```

See [initial setup](../INITIAL_SETUP.md) for the account setup. The production container's `/data` mount uses the persistent directory above. The cloned checkout is only for first-time setup; deployments use separate release directories. Keep the deploy account's `~/miootz/production/.env` and `data/` in place.

Alternatively, provide the production `DEPLOY_ENV` secret before the first manual production deployment and create `~/miootz/production/data` on the host. The workflow creates `.env` if absent. After the deployment succeeds, run the same bootstrap commands from `~/miootz/production/current` to configure Pocket ID and the first admin. Bootstrap updates the host `.env` with the discovered group ID; retain that updated file.

## First demo setup

The public demo uses fictional accounts and a shared, temporary SQLite
database. Visitors can sign in and test live features together between resets.
The API resets the shared game data every hour from startup. Any scenario
selected in the demo menu takes effect at the next reset. An API restart
starts a fresh database using `DEMO_SCENARIO`. Production data and Pocket ID
are separate from the demo. Only Traefik and the demo frontend share the
demo ingress network.

Create `~/miootz/demo/.env` on the demo server, or set the demo environment's `DEPLOY_ENV` secret before its first deployment, with values for your domain:

```dotenv
APP_DOMAIN=app.example.com
DEMO_SUBDOMAIN=demo
```

The demo address is `https://${DEMO_SUBDOMAIN}.${APP_DOMAIN}`; the default subdomain is `demo`, so this example uses `https://demo.app.example.com`. Create the corresponding DNS record. Open the demo at `/api/demo` to choose a sample account. `DEMO_SCENARIO` may be set to `open`, `full`, `broadcast`, `random`, `live`, or `kickoff`; the default is `full`.

The demo expects Traefik with the Docker provider, a `websecure` entrypoint, a Let's Encrypt resolver named `letsencrypt`, and a Docker network named `miootz_demo_web`. The production Compose stack creates that network and attaches its Traefik service to it, so a demo on the same host needs no second proxy or port bindings. If you use a different network name, set the same `DEMO_INGRESS_NETWORK` in both environments.

On a separate demo-only host, provide an equivalent Traefik ingress. One option is to clone the repository into `~/miootz/ingress`, configure its `.env` with `ACME_EMAIL` and valid domain placeholders, and start **only** Traefik:

```sh
cd ~/miootz/ingress
docker compose --project-name miootz --env-file .env -f docker-compose.yml up -d traefik
```

This creates the ingress network and ACME volume without starting production services. The demo host also needs public ports 80 and 443 and DNS pointing to it for certificate issuance. An independently managed Traefik installation can be used instead if it meets the same entrypoint, resolver, and network requirements.

## Deploy and check

Publish a stable release to deploy the demo, or run the appropriate workflow manually and select a stable tag. GitHub uses separate concurrency groups for demo and production: a running deployment is not canceled, while a newer pending run can replace an older pending run. A host-side lock also rejects overlapping deployments to the same target. Each job has a 60-minute limit. The selected commit is archived from Git, so local untracked files, `.env`, and databases are not included.

Each target stores source under `~/miootz/<target>/releases/`; `current` points to the last release that passed the internal health checks. The checks cover the API and frontend and, for production, Pocket ID. They do not check public DNS, certificates, or a full browser sign-in. After deployment, open the HTTPS site and verify the account flow; for the demo also verify `/api/demo`. Inspect Traefik logs if TLS fails.

A failed health check can leave the new containers running while `current` still points to the last healthy release. Inspect the containers and logs before retrying. To roll back, run the workflow with an earlier stable tag after checking that it supports the current database schema; application migrations and user data are not automatically reversed. Old release directories are kept for inspection and can consume disk space; remove only releases that are no longer needed after verifying they are not in use.
