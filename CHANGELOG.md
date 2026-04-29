# Changelog

All notable changes to this project will be documented in this file.

## [0.1.4] - 2026-04-29

### Fixed
- **CLI**: Fixed scan command hanging after completion by properly releasing stream reader lock
- **TypeScript**: Fixed `exactOptionalPropertyTypes` errors across web app and adapters
- **Dashboard**: Cache column now sorts by actual cost instead of raw token count
- **Dashboard**: Sort arrows stay on same line with column headers

### Changed
- **Dashboard**: Status column now shows orange/green dot indicator (savings potential vs optimized) instead of text labels
- **Dashboard**: Stat strip is now centered with larger font size for better visibility
- **Dashboard**: Removed unused `subagentCount` prop from SessionRow component

### Added
- **Web**: Added `.npmignore` file to exclude dev files from package

## [0.1.3] - 2026-04-07

### Added
- Claude Code adapter for ingesting local conversation logs
- Dashboard UI for Claude Code traces with model breakdown visualization
- Cache cost tracking and display for Claude Code sessions
- Project filtering and grouping for Claude Code traces
- Subagent rollup for parent trace totals

## [0.1.2] - 2026-03-21

### Added
- Initial OpenClaw adapter
- Cost analyzer and waste detector
- CLI commands: scan, report, status, dashboard
- React dashboard with trace explorer
- SQLite storage with Drizzle ORM
