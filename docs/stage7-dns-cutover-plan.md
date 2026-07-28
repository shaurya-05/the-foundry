# Stage 7 — Domain Cutover: DNS Record Inventory & Plan

## Why this document exists

`found3ry.com` currently sits on GoDaddy nameservers (`ns07/ns08.domaincontrol.com`) and has **live Microsoft 365 email** alongside the website — DMARC is set to `p=quarantine`. Changing nameservers to Cloudflare makes Cloudflare authoritative for *everything* on the domain, not just web traffic. Every record below must exist in the Cloudflare zone, verified correct, **before** the nameserver switch — otherwise email breaks silently (quarantine, not bounce, so it may not be obvious immediately).

## Complete current record inventory (queried directly, 2026-07-27)

| Type | Name | Value | Priority |
|---|---|---|---|
| A | `found3ry.com` | `216.198.79.1` | — |
| CNAME | `www` | `bd617d336a0a69f8.vercel-dns-017.com` | — |
| CNAME | `api` | `6me9agnt.up.railway.app` | — |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | — |
| CNAME | `lyncdiscover` | `webdir.online.lync.com` | — |
| CNAME | `sip` | `sipdir.online.lync.com` | — |
| CNAME | `msoid` | `clientconfig.microsoftonline-p.net` | — |
| MX | `found3ry.com` | `found3ry-com.mail.protection.outlook.com` | 0 |
| TXT | `found3ry.com` | `NETORGFT20585510.onmicrosoft.com` | — |
| TXT | `found3ry.com` | `v=spf1 include:secureserver.net -all` | — |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | — |
| SRV | `_sip._tls` | `sipdir.online.lync.com` — port 443, priority 100, weight 1 | — |
| SRV | `_sipfederationtls._tcp` | `sipfed.online.lync.com` — port 5061, priority 100, weight 1 | — |

Checked and confirmed **absent** (do not add): `enterpriseregistration`, `enterpriseenrollment` (Intune device management was never configured — adding these would be introducing something new, not mirroring).

## Recommended cutover scope (risk-minimized)

Change **only** `api.found3ry.com`'s target today — from Railway to the Cloudflare Tunnel. Leave `found3ry.com` (apex) and `www` pointing at Vercel exactly as they are now, unchanged.

Why: the backend already has a working, stable named tunnel (`found3ry-local`, created in Stage 5). The frontend's own public reachability is still blocked by a Cloudflare quick-tunnel throttle (Stage 6) — cutting the *website* over before that's resolved would mean either downtime or serving the site through an unstable path. Vercel was never broken; there's no urgency to touch it today. This also keeps the blast radius of this stage to exactly the one thing that's actually ready.

## Steps (require the Cloudflare + GoDaddy dashboards directly — see note below)

1. In the Cloudflare dashboard, under the `found3ry.com` zone → DNS, add every record above **exactly as listed**, all as **DNS only** (grey cloud, not proxied).
2. Update the tunnel's ingress in `~/.cloudflared/config.yml` to route `api.found3ry.com` → `http://localhost:8000` (replacing the current `local-test.found3ry.com` test entry), and run `cloudflared tunnel route dns found3ry-local api.found3ry.com`.
3. Verify every mirrored record resolves correctly *before* touching nameservers — Cloudflare will not be authoritative yet, so this just confirms the zone is configured right.
4. At GoDaddy, change `found3ry.com`'s nameservers to the two Cloudflare-assigned ones (shown in the Cloudflare dashboard's zone setup).
5. Wait for propagation (verify via `nslookup -type=NS found3ry.com 1.1.1.1` — don't assume the moment you change it is the moment it's live).
6. Once NS shows Cloudflare, confirm `api.found3ry.com` reaches the local backend from a genuinely external network (not just this PC/LAN).

## Why I'm not doing steps 1, 2 (partially), and 4 myself

- Creating Cloudflare DNS records needs a Cloudflare API token or dashboard access I don't have (only tunnel-scoped `cloudflared` login).
- Changing nameservers at the registrar (GoDaddy) is an account-level, live-email-affecting action on real infrastructure — this is squarely something to do directly, not hand credentials over for.

I'll handle the `cloudflared tunnel route dns` command (step 2, tunnel-side) and all verification (steps 3, 5, 6) once the Cloudflare-side records are in place.
