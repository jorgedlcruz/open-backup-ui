# Container Deployment Guide

This guide covers building and running Veeam Single-UI as a container using Podman or Docker.

## Prerequisites

- Podman or Docker installed
- Access to Veeam product REST APIs
- Network connectivity to Veeam servers

## Build the Container

```bash
podman build -t veeam-single-ui:latest .
```

Or with Docker:
```bash
docker build -t veeam-single-ui:latest .
```

## Run the Container

### Minimal Run (VBR Only)

```bash
podman run -d \
  --name veeam-single-ui --replace \
  -p 3000:3000 \
  -e VEEAM_API_URL="https://your-vbr-server:9419" \
  -e VEEAM_USERNAME="your-username" \
  -e VEEAM_PASSWORD="your-password" \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
  veeam-single-ui:latest
```

### Full Run with All Products

```bash
podman run -d \
  --name veeam-single-ui --replace \
  -p 3000:3000 \
  -e VEEAM_API_URL="https://your-vbr-server:9419" \
  -e VEEAM_USERNAME="your-username" \
  -e VEEAM_PASSWORD="your-password" \
  -e VRO_API_URL="https://your-vro-server:9898" \
  -e VRO_USERNAME="your-vro-username" \
  -e VRO_PASSWORD="your-vro-password" \
  -e VBM_API_URL="https://your-vbm-server:4443" \
  -e VBM_USERNAME="your-vbm-username" \
  -e VBM_PASSWORD="your-vbm-password" \
  -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
  veeam-single-ui:latest
```

## Environment Variables

### Required Variables

#### Veeam Backup & Replication (VBR)
- `VEEAM_API_URL` - Base URL of your VBR REST API (e.g., `https://vbr-server:9419`)
- `VEEAM_USERNAME` - Username for VBR authentication
- `VEEAM_PASSWORD` - Password for VBR authentication

### Optional Variables

#### Veeam Recovery Orchestrator (VRO)
- `VRO_API_URL` - Base URL of your VRO REST API (e.g., `https://vro-server:9898`)
- `VRO_USERNAME` - Username for VRO authentication (may include domain: `domain\username`)
- `VRO_PASSWORD` - Password for VRO authentication

#### Veeam Backup for Microsoft 365 (VBM)
- `VBM_API_URL` - Base URL of your VBM REST API (e.g., `https://vbm-server:4443`)
- `VBM_USERNAME` - Username for VBM authentication
- `VBM_PASSWORD` - Password for VBM authentication

### General Settings
- `NODE_TLS_REJECT_UNAUTHORIZED=0` - Allow self-signed certificates (for lab/development environments only)

**Note**: At minimum, VBR credentials must be provided. VRO and VBM are optional and their pages will show errors if not configured.


## Using Environment File

Create a `.env.local` file:
```env
# Veeam Backup & Replication (Required)
VEEAM_API_URL=https://your-vbr-server:9419
VEEAM_USERNAME=your-username
VEEAM_PASSWORD=your-password

# Veeam Recovery Orchestrator (Optional)
VRO_API_URL=https://your-vro-server:9898
VRO_USERNAME=your-vro-username
VRO_PASSWORD=your-vro-password

# Veeam Backup for Microsoft 365 (Optional)
VBM_API_URL=https://your-vbm-server:4443
VBM_USERNAME=your-vbm-username
VBM_PASSWORD=your-vbm-password

# General Settings
NODE_TLS_REJECT_UNAUTHORIZED=0
```

Run with environment file:
```bash
podman run -d \
  --name veeam-single-ui --replace \
  -p 3000:3000 \
  --env-file .env.local \
  veeam-single-ui:latest
```

With Docker:
```bash
docker run -d \
  --name veeam-single-ui --rm \
  -p 3000:3000 \
  --env-file .env.local \
  veeam-single-ui:latest
```

**Important Notes:**
- The `.env.local` file should not be committed to version control
- For production deployments, consider using secrets management solutions
- VRO usernames may require domain prefix (e.g., `DOMAIN\username`)

## Container Management

### View logs
```bash
podman logs veeam-single-ui
```

### Stop container
```bash
podman stop veeam-single-ui
```

### Start container
```bash
podman start veeam-single-ui
```

### Remove container
```bash
podman rm veeam-single-ui
```

## Access the Application

Once running, access the application at:
- http://localhost:3000

## Security Scanning

Scan the container image for vulnerabilities using Trivy:

```bash
# Export image and scan (workaround for podman socket issues)
podman save localhost/veeam-single-ui:latest -o /tmp/veeam-single-ui.tar
trivy image --input /tmp/veeam-single-ui.tar

# Alternative: Scan directly if podman socket is available
trivy image localhost/veeam-single-ui:latest
```

To scan only for vulnerabilities (faster):
```bash
trivy image --scanners vuln --input /tmp/veeam-single-ui.tar
```

## Image Details

- **Base Image**: `node:20-alpine`
- **Approximate Size**: ~294 MB
- **Exposed Port**: 3000
- **User**: `nextjs` (non-root for security)
- **Build Tool**: Next.js 15 with Turbopack

## Troubleshooting

### Container won't start
1. Check logs: `podman logs veeam-single-ui`
2. Verify environment variables are set correctly
3. Ensure VBR API URL is accessible from container
4. Check if required environment variables (VEEAM_*) are present

### API connection errors
1. Verify network connectivity:
   ```bash
   podman exec veeam-single-ui ping your-vbr-server
   ```
2. Check if `NODE_TLS_REJECT_UNAUTHORIZED=0` is set for self-signed certificates
3. Verify credentials are correct and have appropriate permissions
4. Test API endpoint directly:
   ```bash
   curl -k https://your-vbr-server:9419/api/v1/about
   ```
5. Check firewall rules allow traffic on port 9419 (VBR), 9898 (VRO), 4443 (VBM)

### Port conflicts
If port 3000 is already in use, map to a different port:
```bash
podman run -d --name veeam-single-ui --replace -p 8080:3000 ... veeam-single-ui:latest
```
Then access at http://localhost:8080

### 403 Forbidden errors
1. Verify user has correct permissions in Veeam products
2. Check if user account is locked or password expired
3. Review Veeam server logs for authentication issues
4. For VRO, ensure domain prefix is correct (e.g., `DOMAIN\username`)

### Build failures
1. Ensure you're in the `veeam-single-ui` directory
2. Check Docker/Podman daemon is running
3. Verify internet connectivity for npm package downloads
4. Clear build cache:
   ```bash
   podman build --no-cache -t veeam-single-ui:latest .
   ```

### Performance issues
1. Check container resource limits:
   ```bash
   podman stats veeam-single-ui
   ```
2. Allocate more resources if needed:
   ```bash
   podman run -d --name veeam-single-ui --memory=2g --cpus=2 ...
   ```
3. Monitor Veeam API response times
4. Consider adjusting auto-refresh intervals in the application

For more troubleshooting information, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
