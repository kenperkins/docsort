# docsort

Self-hosted filing for scanned paperwork. Drop PDFs in a folder (or upload them); a vision
model (Claude by default, or one you run yourself) reads the first pages, works out what each document is, when it's from and who it's about, renames it,
and files it into a folder tree you can browse. A web UI lets you search, fix metadata and
review anything it wasn't sure about.

```
scans/2026-10-31_0915.pdf  →  documents/financial/loans/mortgage/2025/2025-12-31_1098-Mortgage-Interest.pdf
```

> **Where your documents go depends on the classifier.** With the default (`CLASSIFIER=anthropic`),
> page images of the first few pages (`MAX_PAGES`) are sent to Anthropic's API, at about $0.02
> per document. With a model you host (`CLASSIFIER=openai-compatible`), nothing leaves your
> network. Either way the files, the index and the UI stay on your machine.

## How it works

1. **Intake:** a watcher picks up PDFs in `/data/incoming`; web uploads and the
   [sync agent](#sync-agent) feed the same queue.
2. **Classify:** the first pages are rendered to images and sent to the [classifier](#classifier)
   with a fixed list of tags (`src/lib/trusted-tags.json`, about 70 household categories). The
   model returns 1-3 tags, a confidence, the document's own date, and metadata (company, person,
   institution...), constrained to a schema and checked again before anything is filed.
3. **File:** the first tag becomes the folder (`/financial/banking` → `documents/financial/banking/<year>/`)
   and the file is renamed `YYYY-MM-DD_Short-Description.pdf`. Below `CONFIDENCE_THRESHOLD`,
   or when no tag fits, it goes to `needs-review` instead.
4. **Index:** everything lands in SQLite with full-text search, tags, people and dates.
   Exact duplicates (same file hash) are detected.

People named in documents are matched against known people and their name variants, so
"Alexandra J. Rivera", "A. J. Rivera" and "Alex Rivera" are one person.

## Quick start (Docker Compose)

```bash
curl -O https://raw.githubusercontent.com/kenperkins/docsort/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/kenperkins/docsort/main/.env.example
# edit .env: ANTHROPIC_API_KEY, APP_URL and your login provider
mkdir -p data scans && sudo chown 1000:1000 data scans
docker compose up -d
```

docsort listens on `127.0.0.1:3000`; put your usual TLS reverse proxy in front of it.

## Authentication

docsort holds tax, medical and legal paperwork, so **it refuses to start until `AUTH_MODE` is
set.** There is no open-by-default mode.

| `AUTH_MODE` | How you log in | Settings |
|---|---|---|
| `oidc` (recommended) | docsort sends you to your OpenID Connect provider (Authelia, Authentik, Keycloak, Google...) and keeps its own session | `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (or `OIDC_CLIENT_SECRET_FILE`), optional `SESSION_TTL_HOURS` (12) |
| `proxy` | An authenticating reverse proxy sets `Remote-User` / `Remote-Groups` | `APP_URL`, `TRUSTED_PROXIES`: the proxy's CIDRs. Headers from any other address are ignored. |
| `none-i-understand-the-risk` | No login; docsort only listens on 127.0.0.1 | Local development only |

For `oidc`, register a confidential client with redirect URI `<APP_URL>/auth/callback`, scopes
`openid profile email groups`, and the authorization-code flow. PKCE is always used. Sessions
are stored in SQLite as hashes of the cookie value.

**Who gets in** is decided by groups: `AUTH_ADMIN_GROUP` (default `admins`) has full access,
`AUTH_READER_GROUP` (unset by default) is read-only, and everyone else is refused.
`AUTH_LOGOUT_URL` is where Log out sends you afterwards (e.g. your provider's logout page).
Groups are read at login and kept for the session, so removing someone from a group takes
effect when their session expires (`SESSION_TTL_HOURS`) or they log out.

State-changing requests from other origins are refused, including sibling apps on the same
parent domain.

## Classifier

docsort doesn't depend on a particular model or server. It talks to one of two kinds of endpoint:

| `CLASSIFIER` | Talks to | Settings |
|---|---|---|
| `anthropic` (default) | Claude through Anthropic's API | `ANTHROPIC_API_KEY`; optional `CLAUDE_MODEL` (`claude-sonnet-5-5`), `CLAUDE_EFFORT` (`low`) |
| `openai-compatible` | Anything serving OpenAI-style `/v1/chat/completions` with image input: Ollama, llama.cpp server, vLLM, LM Studio, LocalAI, or a gateway such as LiteLLM | `CLASSIFIER_BASE_URL` (e.g. `http://ollama:11434/v1`), `CLASSIFIER_MODEL` (e.g. `qwen2.5vl:7b`); optional `CLASSIFIER_API_KEY` or `CLASSIFIER_API_KEY_FILE`, `CLASSIFIER_JSON_MODE`, `CLASSIFIER_TIMEOUT_SECONDS` (120) |

With `CLASSIFIER_JSON_MODE=schema` (default), the server is asked to constrain its output to
docsort's JSON Schema (`response_format: json_schema`). If your server or model doesn't support
that, use `prompt`: the schema is described in the prompt and the JSON is taken from the reply.
Either way the answer is validated, and anything outside the tag list goes to review.

Pick a vision model; smaller ones (7-8B) handle bills and statements well but are weaker on
dates and names, so expect more in the review queue, and consider raising
`CONFIDENCE_THRESHOLD` if a model is overconfident.

**When the endpoint is down** (refused, timed out, 429 or 5xx), documents stay queued and are
retried with backoff from 30 seconds up to 10 minutes; they don't go to review. Anything the
model answers but can't classify does.

## Configuration

| Variable | Default | |
|---|---|---|
| `CLASSIFIER` | `anthropic` | See [Classifier](#classifier) for it and its settings |
| `MAX_PAGES` | `3` | Pages sent per document |
| `CONFIDENCE_THRESHOLD` | `0.7` | Below this, documents go to needs-review |
| `TAGS_FILE` | built-in list | JSON object of `"/tag/path": "what belongs here"`; replaces the built-in tags |
| `PEOPLE_FILE` | none | JSON list of people to load on first start; see `people.example.json` |
| `API_KEYS` | none | Comma-separated keys for the sync agent, at least 32 characters each (`openssl rand -hex 32`); they only allow uploads |
| `INCOMING_DIR` | `/data/incoming` | Watched for new PDFs |
| `OUTPUT_DIR` | `/data/documents` | Filed documents |
| `REVIEW_DIR` | `/data/documents/needs-review` | |
| `UPLOAD_DIR` | `/data/uploads` | Web and API uploads waiting in the queue |
| `GRAVEYARD_DIR` | `/data/graveyard` | Deleted documents, kept for recovery (see below) |
| `LOG_DIR` | `/data/documents/processed-log` | |
| `DB_PATH` | `/data/docsort.db` | SQLite index |
| `PORT` | `3000` | |

Health endpoints for probes: `/api/health/live`, `/api/health/ready` (public). Detailed health
and migration status need a login.

## Things to know

- **Deleting doesn't erase.** Deleting a document in the UI moves the file to `GRAVEYARD_DIR`
  so mistakes can be undone. Nothing ever empties it; remove files there yourself when you
  want them gone, and include it when you think about backups and retention.
- **Documents can try to steer the classifier.** A page can contain text written to influence
  Claude. The prompt tells it to ignore instructions in documents, and the response is
  constrained to a schema with tags from your list, so the worst outcome is a misfiled document,
  wrong metadata, or a falsely high confidence. It can't make docsort write outside the
  documents folder or run anything. Check the review queue now and then.
- **Refusals.** If the model declines to read a document, it goes to needs-review. With
  `CLASSIFIER=anthropic` on the default model, Anthropic's server-side fallback first retries on
  a fallback model; that retry is billed at the fallback model's rates.

## Sync agent

`sync-agent/` is a small Node script that watches folders on another machine (say,
`~/Downloads`) and uploads new PDFs to `POST /api/upload/submit` with an API key. The
endpoint takes the PDF itself as base64; it never fetches URLs.

```bash
cd sync-agent && npm install
API_URL=https://docsort.example.com/api/upload/submit API_KEY=... WATCH_PATHS=~/Downloads node index.js
```

## Development

Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev:clean      # creates /tmp/docsort/*
ANTHROPIC_API_KEY=sk-ant-... pnpm dev      # no auth, 127.0.0.1:3000
pnpm --filter docsort-frontend dev         # Vite dev server for the UI
pnpm test
```

Images (amd64 and arm64) at `ghcr.io/kenperkins/docsort`:

| Tag | Published by |
|---|---|
| `0.1`, `0.1.3`, `latest` | a GitHub release (`v0.1.3`); the compose file follows `0.1` |
| `edge`, `sha-<sha>`, `main-<UTC timestamp>-<sha>` | every push to `main` |

Security reports: see [SECURITY.md](SECURITY.md).

## License

MIT
