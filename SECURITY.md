# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in DepFixer CLI, please report it responsibly.

### How to Report

**Email**: security@depfixer.com

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 5 business days
- **Resolution Timeline**: Depends on severity, typically 7-30 days

### What We Ask

- **Do not** disclose the vulnerability publicly until we've had a chance to address it
- **Do not** exploit the vulnerability beyond what's necessary to demonstrate it
- **Do** provide sufficient detail for us to understand and reproduce the issue

## Scope

This security policy covers:
- The `depfixer` npm package
- The DepFixer CLI application
- Related infrastructure (API, authentication)

## Security Practices

### What the CLI Accesses

- **Reads**: Your project's `package.json` file only
- **Does NOT read**: Your source code, environment variables, or other files
- **Sends**: Package names and versions to our API for analysis
- **Stores locally**: Authentication tokens in `~/.depfixer/`

### Data Privacy

- We analyze dependency metadata only, never source code
- Analysis data is used to improve recommendations
- See our [Privacy Policy](https://depfixer.com/privacy) for details

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < 1.0.0 | No        |

We recommend always using the latest version for security updates.

## Updates

Security updates are released as soon as possible after a fix is ready. Update regularly:

```bash
npm update -g depfixer
```

---

Thank you for helping keep DepFixer secure!
