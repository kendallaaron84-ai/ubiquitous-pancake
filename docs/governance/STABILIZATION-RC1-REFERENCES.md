# Stabilization RC1 immutable references

These references identify the existing engineering candidate. Governance changes are committed separately and do not rewrite these commits.

## Source commits

- Dashboard/gateway production baseline: `a229e164d2d6b29661aee4d7ba92adc6d4790104`
- Dashboard/gateway stabilization RC1: `ab8f833e56f6aada2610fb8ce226b7e0fcdefc17`
- Plugin pilot parent: `50c49d717c2652adc1ad2240ccdef12fff89da2c`
- Plugin stabilization RC1: `d08ec56ad0fe49e02db686420c50dede1a5dfb2b`
- Plugin fleet updater baseline: `v6.1.0` at `2bd29d5`

## Local review artifacts

Artifact directory: `release-candidates/koba-i-stabilization-rc1/`

| Artifact | SHA-256 |
|---|---|
| `dashboard-gateway-a229e16-to-ab8f833.patch` | `27d02f67bb0236728cdb9f867bdf66a9bf03bcc2d105b3f6ba9cdf0b199c9c04` |
| `dashboard-gateway-stabilization-ab8f833-source.zip` | `e0f5ee5b018ab703eba988349a4c49e12aa0191b13877646ce3beb7e36516ee1` |
| `koba-i-audio-6.2.0-stabilization-rc1.zip` | `023d0354665f8e7289551fc9bd76e968a200455b73af610137acb999dc5f61de` |
| `plugin-50c49d7-to-d08ec56.patch` | `fbbf642fce00624e352ca45ee74be24e6e45b80606b2d3966ebd8eca041a7628` |

Reviewers must verify these hashes before relying on the artifacts. A later governance commit is not a substitute for either RC1 source commit.
