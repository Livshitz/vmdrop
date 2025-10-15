# Changelog

All notable changes to vmdrop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Help system** (`--help`, `-h`, `-?` flags)
  - Comprehensive usage information
  - Lists all commands with descriptions
  - Shows all available flags
  - Includes usage examples
  - Displays supported distributions
  - Automatically shown when no arguments provided

- **Verbose mode** (`--verbose` or `-v` flag) for detailed progress logging
  - Shows local dependency checks
  - Displays SSH connection details
  - Reports file sync operations and exclusions
  - Shows environment variable counts
  - Logs service existence checks
  - Provides detailed step-by-step progress

## [0.2.0] - 2025-10-15

### 🎉 Major Features

#### Multi-Distribution Linux Support
- **Auto-detects package manager** - Automatically detects and uses the appropriate package manager (apt, dnf, yum, apk)
- **Supports all major Linux distributions:**
  - Ubuntu/Debian (apt)
  - Amazon Linux 2023, Rocky Linux, AlmaLinux, CentOS, Fedora (dnf/yum)
  - Alpine Linux (apk)
- **Smart Caddy installation** - Automatically installs Caddy using the best method for each distro
- **Firewall detection** - Supports both UFW (Debian-based) and firewalld (RHEL-based)

### ✨ Enhancements

#### New Configuration Options
- **`packages:` section** - New OS-agnostic package configuration
  - `packages.manager` - Specify package manager or use `auto` (default)
  - `packages.list` - List of packages to install
  - Backward compatible with existing `apt:` section

#### Systemd Service Customization
- **`service.restart`** - Configure restart policy (no, always, on-success, on-failure, etc.)
- **`service.restartSec`** - Set restart delay in seconds (default: 2)
- **`service.environmentFile`** - Customize environment file path
- **`service.killSignal`** - Configure stop signal (default: SIGINT)

#### Better Error Handling
- **Helpful error messages** with context and troubleshooting hints
- **Auto-detection failures** provide clear explanations
- **SSH/connection errors** include specific remediation steps
- **Package manager errors** suggest updating to latest version

#### Service Management Improvements
- **Smart service restart** - Checks if service exists before restarting
- **First-time deployment** - Uses `systemctl start` on first deployment
- **Subsequent deployments** - Uses `systemctl restart` for updates
- **Clear user feedback** - Shows meaningful status messages (🚀 Starting vs ♻️ Restarting)

### 📚 Documentation

- **Deployment flow documentation** - Clear explanation of what happens during each command
- **Multi-distro examples** - Updated README with distro compatibility info
- **Configuration reference** - Comprehensive config documentation with all new options
- **Migration guide** - Backward compatibility notes for existing users

### 🔧 Breaking Changes

None! All changes are backward compatible:
- Existing `apt:` sections continue to work
- Default behavior unchanged for existing configs
- Old configs will work without modification

### 🐛 Bug Fixes

- Fixed service restart timing issue on first deployment
- Improved package manager lock handling
- Better Caddy installation on non-Debian systems

### 📦 Internal Changes

- Refactored provisioning script generation
- Improved SSH command execution with quiet mode option
- Enhanced config schema with Zod validation for new fields

---

## [0.1.1] - Previous Release

Initial stable release with Ubuntu/Debian support.

### Features
- Basic VM provisioning
- Bun and Caddy installation
- HTTPS support with automatic SSL
- Environment variable management
- Systemd service creation
- rsync-based deployment

[0.2.0]: https://github.com/Livshitz/vmdrop/releases/tag/v0.2.0
[0.1.1]: https://github.com/Livshitz/vmdrop/releases/tag/v0.1.1

