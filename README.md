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

## Privacy & Architecture

DepFixer is a **cloud-powered analysis engine**. The CLI acts as a local client that:
1. Scans your `package.json` locally.
2. Sends an anonymized dependency graph to our secure API.
3. Receives the deterministic resolution and displays it.

**We never upload your source code.** Only the dependency tree (names and versions) is analyzed.

### Telemetry

The CLI collects anonymous usage data (e.g., OS version, Node version, command duration) to help us improve performance.

**Opt-out:**

You can disable telemetry completely by setting an environment variable:

```bash
export DEPFIXER_DISABLE_ANALYTICS=true
```

> **Note:** This disables usage tracking events. Functional API calls (audits, auth) are still required for the tool to operate.

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

## Development

```bash
# Clone the repository
git clone https://github.com/nicob88/depfixer-cli.git
cd depfixer-cli

# Install dependencies
npm install

# Build
npm run build

# Run locally
npm run dev
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

Apache-2.0 - see [LICENSE](LICENSE) for details.

---

Built with care for the JavaScript ecosystem.
