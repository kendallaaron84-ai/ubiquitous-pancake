# Production Service Baseline Equivalence

Imported before ADR-002 Phase 4 behavior changes.

## Source locations

- Worker: `C:\KOBA-I Projects\Jubilee Dashboard\Content Engine Prod\main.py`
- Worker dependencies: `C:\KOBA-I Projects\Jubilee Dashboard\Content Engine Prod\requirements.txt`
- Gateway: `C:\KOBA-I Projects\Jubilee Cloud Run\index.js` and its runtime/package files.

## Comparison result

Every imported runtime file is text-equivalent to its production-directory source after normalizing CRLF/LF line endings and ignoring only the final newline. No executable statements, dependency declarations, routes, or runtime values changed during import.

| Imported file | Source SHA-256 | Imported SHA-256 | Normalized content |
| --- | --- | --- | --- |
| `content-engine-worker/main.py` | `a82029bbf8937f94cf4b05f7cd9b30c599091cf4ed3030fd08ee459f70e1d806` | `f92ab9f75b63a50ab5b73e6de18a874b0daf9f76d51fec19c48dbdf399105079` | Match |
| `content-engine-worker/requirements.txt` | `5428830bf0e3a0a821e3828b2e56a5ec9c7ea40320fb19353a47a6089279403c` | `25cc21c2c312a146b1cfa6dfd71fd44c08728c3e549187d1cbf3234f997082b6` | Match |
| `wordpress-egress-gateway/index.js` | `ecf4cb6fd5fcf8ad8d3caa8d72c0c46b85535cb35416715a210ed76586be9b4a` | `00f0f701fa5c39ed4e99ccb54c748265ca727074532d1e0ddc0910f212ab8549` | Match |
| `wordpress-egress-gateway/package.json` | `1abbe243efa470f0e7ed940c55442cb49b25e58bc6016bbd0f5e1e8ed663fde8` | `50c8f17d6a660ac88a036d6d93958acf8e15d4da2707364193482d7c24672410` | Match |
| `wordpress-egress-gateway/pnpm-lock.yaml` | `6394a665dda92e3cb65d363e736e1dc643675764ba1aa635cfa4051603e4f96f` | `34271740b3739bafc22363a5f7010b3f5995e261874626f8cbb228960dfd70bd` | Match |
| `wordpress-egress-gateway/pnpm-workspace.yaml` | `df106d89dfde712a55a12b292df68f9fb35c021c6e3b7b6b5d01c25cefc231b1` | `c70c6abdb6d05262f15f4e4f4c879651e04a8135f86b0c16465ab1eb87c522b9` | Match |
| `wordpress-egress-gateway/Procfile` | `762d191fbe8eda12524eeaff8aecf7acad1d94d74c46fb66df092f4b1c51c712` | `7fee2f380f1e3b63ec019aab14b9801747e0b1193e451f3394525d1a4ef1d5a2` | Match |
| `wordpress-egress-gateway/.gcloudignore` | `de85aab5b6ac0bac1899e651a752b8a8b6365c09aafaf694492bde46ebcd7476` | `ddbda047863fe5fd1da7aefaef48da3438ea9c2961250550bcfc1075ad5dda7b` | Match |

The raw SHA-256 values differ only because the patching workflow normalized line endings. The normalized character content, measured independently for every file, is identical.

