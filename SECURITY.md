# Security

docsort stores people's tax, medical and legal paperwork, so security reports are welcome and
taken seriously.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this
repository. Don't open a public issue for anything exploitable.

Include what you found, how to reproduce it, and which version or image tag you tested. You
should hear back within a week.

## Supported versions

Fixes go into the latest release. Use a version tag (e.g. `ghcr.io/kenperkins/docsort:0.1`)
rather than `edge`, and update when a release notes a security fix.

## Scope

In scope: the server, web UI, container image and sync agent in this repository.

Out of scope: your identity provider or reverse proxy configuration, and how Anthropic's API
handles documents sent to it (see Anthropic's own policies).
