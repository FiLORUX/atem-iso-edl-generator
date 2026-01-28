# Contributing to ATEM ISO EDL Generator

Thank you for your interest in contributing! This project welcomes contributions from the broadcast and video production community.

## Getting Started

### Prerequisites

- Node.js 20+
- Access to an ATEM switcher (or use mock mode for development)
- Basic understanding of broadcast workflows and EDL formats

### Development Setup

```bash
# Clone the repository
git clone https://github.com/FiLORUX/atem-iso-edl-generator.git
cd atem-iso-edl-generator

# Install dependencies
npm install

# Copy example configuration
cp config/config.example.yaml config/config.yaml

# Run in development mode
npm run dev
```

## Code Standards

### Style

- Consistent terminology aligned with EBU/SMPTE broadcast standards
- Clear, professional documentation suitable for broadcast engineers

### TypeScript

- Strict mode enabled
- Explicit types for public APIs
- Use Zod schemas for runtime validation

### Commit Messages

Follow conventional commits format:

```
feat: add HyperDeck timecode support
fix: correct drop-frame calculation for 59.94fps
docs: add troubleshooting section for network issues
```

Prefixes: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feat/my-feature`)
3. **Commit** changes with conventional commit messages
4. **Test** your changes thoroughly
5. **Push** to your fork
6. **Open** a pull request with a clear description

### PR Requirements

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] Documentation updated if needed
- [ ] No breaking changes without discussion

## Reporting Issues

### Bug Reports

Include:
- ATEM model and firmware version
- Node.js version
- Configuration (redact IPs/passwords)
- Steps to reproduce
- Expected vs actual behaviour
- Relevant log output

### Feature Requests

Describe:
- Use case and workflow
- Proposed solution
- Alternatives considered
- Impact on existing functionality

## Architecture Notes

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| ATEM Adapter | `src/adapters/atem/` | Switcher communication |
| Event Store | `src/core/events/` | Event types and logging |
| EDL Generator | `src/generators/edl/` | CMX 3600 output |
| Timecode | `src/core/timecode/` | SMPTE timecode handling |

### Design Principles

1. **Reliability over features** — Broadcast environments require stability
2. **Event sourcing** — All state derived from immutable event log
3. **Graceful degradation** — Continue operating if devices disconnect
4. **Zero configuration** — Sensible defaults, minimal required setup

## Licence

By contributing, you agree that your contributions will be licensed under the MIT Licence.

---

Questions? Open an issue or start a discussion.
