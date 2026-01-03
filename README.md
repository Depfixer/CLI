# DepFixer CLI

Smart dependency conflict detection for JavaScript/TypeScript projects.

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## Installation

```bash
# Using npx (no install required)
npx depfixer

# Or install globally
npm install -g depfixer
depfixer
```

## Features

- **Dependency Conflict Detection** - Find version mismatches, peer dependency issues, and compatibility problems
- **Framework-Aware Analysis** - Specialized support for Angular, React, and Vue
- **Migration Planning** - Plan framework upgrades with dependency impact analysis
- **One-Click Fixes** - Apply recommended solutions automatically
- **CI/CD Integration** - Exit codes and JSON output for pipelines

## Quick Start

```bash
# Analyze your project
npx depfixer

# Plan a framework migration
npx depfixer migrate

# Apply fixes from previous analysis
npx depfixer fix
```

## Commands

| Command | Description |
|---------|-------------|
| `npx depfixer` | Analyze dependencies and detect conflicts |
| `npx depfixer migrate` | Interactive framework migration planner |
| `npx depfixer fix` | Apply fixes from previous analysis |
| `npx depfixer login` | Authenticate with DepFixer |
| `npx depfixer logout` | Clear stored credentials |
| `npx depfixer whoami` | Show account information |

## Supported Frameworks

- **Angular** 9 - 20
- **React** 16 - 19
- **Vue** 2 - 3

## Documentation

Full documentation available at **[docs.depfixer.com](https://docs.depfixer.com)**

- [Quick Start Guide](https://docs.depfixer.com/quickstart)
- [CLI Commands](https://docs.depfixer.com/cli/overview)
- [CI/CD Integration](https://docs.depfixer.com/guides/ci-integration)
- [Authentication](https://docs.depfixer.com/cli/auth/device-flow)

## Support

- [Report a Bug](https://github.com/depfixer/CLI/issues/new?template=bug_report.md)
- [Request a Feature](https://github.com/depfixer/CLI/issues/new?template=feature_request.md)
- [Discussions](https://github.com/depfixer/CLI/discussions)

## Links

- **Website**: [depfixer.com](https://depfixer.com)
- **Documentation**: [docs.depfixer.com](https://docs.depfixer.com)
- **npm**: [npmjs.com/package/depfixer](https://www.npmjs.com/package/depfixer)

## Requirements

- Node.js 18.0.0 or higher
- npm 8.0.0 or higher

## License

Apache-2.0

---

Built with care for the JavaScript ecosystem.
