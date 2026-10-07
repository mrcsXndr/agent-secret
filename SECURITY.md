# Security policy

Report vulnerabilities privately through GitHub: [open a security advisory](https://github.com/mrcsXndr/agent-secret/security/advisories/new). Please do not open a public issue for anything that could put someone's secret at risk.

Include what you found, how to reproduce it and what an attacker gains. You will get an acknowledgement, then a fix or a written answer on scope. Credit in the advisory is yours if you want it.

In scope: the Worker (`src/worker/`), the page served at `/` and the hosted instance at agent-secret.xndr.io. The limits listed under "Threat model" in the README (link-holder can claim, best-effort single use, preview bots, trusting the served page) are known and documented, but a practical attack that makes one of them worse is very welcome.

Please do not run load tests or automated scanning against the hosted instance; run your own copy instead (see "Self-host" in the README).
